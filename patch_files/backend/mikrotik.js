import net from 'node:net';

const host = () => String(process.env.MIKROTIK_HOST || '').trim();
const username = () => String(process.env.MIKROTIK_USERNAME || '').trim();
const password = () => String(process.env.MIKROTIK_PASSWORD || '');
const port = () => Number(process.env.MIKROTIK_PORT || 8728);
const timeoutMs = () => Math.max(1500, Math.min(Number(process.env.MIKROTIK_TIMEOUT_MS || 7000), 20000));

export function isRouterOSConfigured() {
  return Boolean(host() && username() && password() && Number.isInteger(port()) && port() > 0 && port() <= 65535);
}

function encodeLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x4000) return Buffer.from([(length >> 8) | 0x80, length & 0xff]);
  if (length < 0x200000) return Buffer.from([(length >> 16) | 0xc0, (length >> 8) & 0xff, length & 0xff]);
  if (length < 0x10000000) return Buffer.from([(length >> 24) | 0xe0, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
  return Buffer.from([0xf0, (length >> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
}

function decodeLength(buffer, offset) {
  if (offset >= buffer.length) return null;
  const first = buffer[offset];
  if ((first & 0x80) === 0) return { length: first, bytes: 1 };
  if ((first & 0xc0) === 0x80) {
    if (offset + 2 > buffer.length) return null;
    return { length: ((first & 0x3f) << 8) + buffer[offset + 1], bytes: 2 };
  }
  if ((first & 0xe0) === 0xc0) {
    if (offset + 3 > buffer.length) return null;
    return { length: ((first & 0x1f) << 16) + (buffer[offset + 1] << 8) + buffer[offset + 2], bytes: 3 };
  }
  if ((first & 0xf0) === 0xe0) {
    if (offset + 4 > buffer.length) return null;
    return { length: ((first & 0x0f) * 0x1000000) + (buffer[offset + 1] << 16) + (buffer[offset + 2] << 8) + buffer[offset + 3], bytes: 4 };
  }
  if (first === 0xf0) {
    if (offset + 5 > buffer.length) return null;
    return { length: (buffer[offset + 1] * 0x1000000) + (buffer[offset + 2] << 16) + (buffer[offset + 3] << 8) + buffer[offset + 4], bytes: 5 };
  }
  throw new Error('Resposta RouterOS com tamanho de palavra inválido.');
}

function parseWord(word) {
  if (!word.startsWith('=')) return [word, ''];
  const split = word.indexOf('=', 1);
  if (split < 0) return [word.slice(1), ''];
  return [word.slice(1, split), word.slice(split + 1)];
}

class RouterOSClient {
  constructor() {
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.sentences = [];
    this.waiters = [];
    this.closedError = null;
  }

  async connect() {
    this.socket = net.createConnection({ host: host(), port: port() });
    this.socket.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.parseAvailable();
    });
    this.socket.on('error', error => {
      this.closedError = new Error(`Falha de conexão com MikroTik: ${error.message}`);
      this.rejectWaiters(this.closedError);
    });
    this.socket.on('close', () => {
      this.closedError ||= new Error('Conexão com MikroTik encerrada.');
      this.rejectWaiters(this.closedError);
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Tempo esgotado ao conectar ao MikroTik.')), timeoutMs());
      this.socket.once('connect', () => { clearTimeout(timer); resolve(); });
      this.socket.once('error', error => { clearTimeout(timer); reject(new Error(`Não foi possível conectar ao MikroTik: ${error.message}`)); });
    });
    await this.command(['/login', `=name=${username()}`, `=password=${password()}`]);
  }

  parseAvailable() {
    while (this.buffer.length) {
      const words = [];
      let offset = 0;
      let complete = false;
      while (offset < this.buffer.length) {
        const decoded = decodeLength(this.buffer, offset);
        if (!decoded) return;
        offset += decoded.bytes;
        if (decoded.length === 0) { complete = true; break; }
        if (offset + decoded.length > this.buffer.length) return;
        words.push(this.buffer.subarray(offset, offset + decoded.length).toString('utf8'));
        offset += decoded.length;
      }
      if (!complete) return;
      this.buffer = this.buffer.subarray(offset);
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(words);
      else this.sentences.push(words);
    }
  }

  rejectWaiters(error) {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  nextSentence() {
    if (this.sentences.length) return Promise.resolve(this.sentences.shift());
    if (this.closedError) return Promise.reject(this.closedError);
    return new Promise((resolve, reject) => {
      const waiter = { resolve: sentence => { clearTimeout(waiter.timer); resolve(sentence); }, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error('Tempo esgotado aguardando resposta do MikroTik.'));
      }, timeoutMs());
      this.waiters.push(waiter);
    }).then(sentence => sentence);
  }

  async command(words) {
    const payload = [];
    for (const word of words) {
      const bytes = Buffer.from(String(word), 'utf8');
      payload.push(encodeLength(bytes.length), bytes);
    }
    payload.push(Buffer.from([0]));
    this.socket.write(Buffer.concat(payload));
    const rows = [];
    let commandError = null;
    while (true) {
      const sentence = await this.nextSentence();
      if (!sentence.length) continue;
      const type = sentence[0];
      const row = {};
      for (const word of sentence.slice(1)) {
        const [key, value] = parseWord(word);
        row[key] = value;
      }
      if (type === '!re') rows.push(row);
      else if (type === '!trap' || type === '!fatal') commandError ||= new Error(row.message || row.category || 'O MikroTik recusou o comando.');
      else if (type === '!done') {
        if (commandError) throw commandError;
        return rows;
      }
    }
  }

  close() {
    try { this.socket?.end(); } catch { /* ignore */ }
    try { this.socket?.destroy(); } catch { /* ignore */ }
  }
}

async function withRouterOS(work) {
  if (!isRouterOSConfigured()) throw new Error('Integração MikroTik ainda não configurada. Preencha MIKROTIK_HOST, MIKROTIK_USERNAME e MIKROTIK_PASSWORD no arquivo .env.');
  const client = new RouterOSClient();
  try {
    await client.connect();
    return await work(client);
  } finally {
    client.close();
  }
}

export async function routerOSConnectionTest() {
  return withRouterOS(async client => {
    const rows = await client.command(['/system/identity/print', '=.proplist=name']);
    return { connected: true, identity: rows[0]?.name || 'MikroTik', host: host(), port: port() };
  });
}

export async function routerOSServiceAction(pppoeUsername, action) {
  const name = String(pppoeUsername || '').trim();
  if (!name || name.length > 180) throw new Error('O cadastro do cliente não tem um usuário PPPoE válido.');
  if (!['block', 'unblock'].includes(action)) throw new Error('Ação de serviço inválida.');

  return withRouterOS(async client => {
    const secrets = await client.command([
      '/ppp/secret/print', `?name=${name}`, '=.proplist=.id,name,service,disabled'
    ]);
    const exact = secrets.filter(secret => secret.name === name);
    if (exact.length === 0) throw new Error(`A conta PPPoE "${name}" não foi encontrada no MikroTik. Nenhuma alteração foi feita.`);
    if (exact.length !== 1) throw new Error(`Foram encontradas várias contas PPPoE com o nome "${name}". Nenhuma alteração foi feita.`);
    const secret = exact[0];
    const service = String(secret.service || 'any').toLowerCase();
    if (!['pppoe', 'any'].includes(service)) throw new Error(`A conta "${name}" não está configurada para PPPoE (serviço encontrado: ${service}). Nenhuma alteração foi feita.`);

    if (action === 'block') {
      if (secret.disabled !== 'true') await client.command(['/ppp/secret/disable', `=.id=${secret['.id']}`]);
      // Disable future authentications first, then disconnect every active session for this exact username.
      try {
        const active = await client.command(['/ppp/active/print', `?name=${name}`, '=.proplist=.id,name,address,service']);
        const sessions = active.filter(session => session.name === name);
        for (const session of sessions) await client.command(['/ppp/active/remove', `=.id=${session['.id']}`]);
        return { action, username: name, sessionsDisconnected: sessions.length, secretDisabled: true };
      } catch (error) {
        error.partial = true;
        error.message = `A conta PPPoE foi desabilitada, mas não foi possível confirmar a desconexão da sessão ativa: ${error.message}`;
        throw error;
      }
    }

    if (secret.disabled === 'true') await client.command(['/ppp/secret/enable', `=.id=${secret['.id']}`]);
    return { action, username: name, secretEnabled: true, note: 'A conta está habilitada. Se não houver sessão ativa, o roteador do cliente deverá reconectar o PPPoE automaticamente.' };
  });
}
