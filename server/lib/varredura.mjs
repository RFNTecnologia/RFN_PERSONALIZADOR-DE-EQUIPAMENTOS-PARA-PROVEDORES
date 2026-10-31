/**
 * Varredura de rede para localizar CPEs reais do provedor.
 *
 * O painel roda no navegador e nao enxerga a LAN do provedor: quem varre e o
 * servidor (que fica na mesma rede dos equipamentos). Aqui usamos apenas
 * modulos nativos do Node:
 *
 *   1. sonda TCP nas portas tipicas de CPE (web, TR-069/CWMP, ssh, telnet);
 *   2. identifica o equipamento pela pagina HTTP (titulo, cabecalho Server);
 *   3. quando a porta TR-069 responde, consulta o CPE via CWMP com as credenciais
 *      do ACS e le serial, DeviceId (MAC), modelo, fabricante e firmware;
 *   4. cruza com a tabela ARP do sistema (Linux) para trazer o MAC do host.
 *
 * Nenhuma dependencia externa e nenhuma alteracao no equipamento: a varredura
 * e somente leitura.
 */

import crypto from 'node:crypto'
import dgram from 'node:dgram'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { DATA_DIR, garantirDir } from './config.mjs'

/** Historico de varreduras gravado em disco (sobrevive a reinicio do servidor). */
const ARQUIVO_HISTORICO = path.join(DATA_DIR, 'varreduras.json')
const LIMITE_HISTORICO = 20

/** Portas sondadas por padrao: web do CPE, TR-069 e acesso administrativo. */
export const PORTAS_PADRAO = [80, 443, 8080, 8443, 7547, 23, 22]

/** Portas onde costuma rodar o CWMP (TR-069). */
const PORTAS_CWMP = [7547, 8080, 80, 8443, 443]

/** Caminhos tentados no CPE para a sessao CWMP. */
const CAMINHOS_CWMP = ['/acs/tr069', '/']

// ------------------------------------------------------------------- interfaces

function mascaraParaPrefixo(mascara) {
  return String(mascara)
    .split('.')
    .reduce((total, parte) => total + (Number(parte).toString(2).match(/1/g)?.length ?? 0), 0)
}

/**
 * Redes IPv4 que o servidor alcanca. A varredura parte daqui: o servidor
 * normalmente fica na mesma faixa dos CPEs do provedor.
 */
export function redesLocais() {
  const saida = []
  for (const [nome, lista] of Object.entries(os.networkInterfaces())) {
    for (const iface of lista || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue
      const mascara = iface.netmask || '255.255.255.0'
      saida.push({
        interface: nome,
        endereco: iface.address,
        mascara,
        cidr: `${iface.address}/${mascaraParaPrefixo(mascara)}`,
      })
    }
  }
  return saida
}

// ---------------------------------------------------------------------- faixa

function ipParaNumero(ip) {
  return ip.split('.').reduce((total, parte) => total * 256 + Number(parte), 0)
}

function numeroParaIp(numero) {
  return [24, 16, 8, 0].map((deslocamento) => (numero >>> deslocamento) & 255).join('.')
}

/** Expande um CIDR em uma lista de IPs hosts (sem rede nem broadcast). */
export function IPsDaFaixa(cidr, limite = 4096) {
  const [base, tamanho] = String(cidr || '').split('/')
  const prefixo = Number(tamanho ?? 24)
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(base) || Number.isNaN(prefixo) || prefixo < 16 || prefixo > 30) {
    throw new Error(`faixa invalida: ${cidr}`)
  }
  const tamanhoMascara = prefixo === 0 ? 0 : (0xffffffff << (32 - prefixo)) >>> 0
  const enderecoRede = (ipParaNumero(base) & tamanhoMascara) >>> 0
  const total = 2 ** (32 - prefixo)
  const listados = []
  for (let i = 1; i < total - 1 && listados.length < limite; i += 1) {
    listados.push(numeroParaIp((enderecoRede + i) >>> 0))
  }
  return listados
}

// ------------------------------------------------------------------- sondagem

/** Testa se a porta TCP responde no host. */
function portaAberta(ip, porta, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let resolvido = false
    const finalizar = (aberta) => {
      if (resolvido) return
      resolvido = true
      socket.destroy()
      resolve(aberta)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finalizar(true))
    socket.once('timeout', () => finalizar(false))
    socket.once('error', () => finalizar(false))
    socket.connect(porta, ip)
  })
}

/** Le a pagina inicial do CPE para identificar modelo pelo titulo/Server. */
function sondarHttp(ip, porta, timeoutMs) {
  return new Promise((resolve) => {
    let corpo = ''
    const req = http.request(
      {
        host: ip,
        port: porta,
        path: '/',
        method: 'GET',
        timeout: timeoutMs,
        headers: { 'user-agent': 'rfn-discovery/1.0' },
      },
      (res) => {
        res.setEncoding('utf8')
        res.on('data', (pedaco) => {
          if (corpo.length < 16384) corpo += pedaco
        })
        res.on('end', () => {
          const titulo = (corpo.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
            .replace(/\s+/g, ' ')
            .trim()
          resolve({
            status: res.statusCode ?? 0,
            server: String(res.headers.server || ''),
            titulo,
          })
        })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.on('error', () => resolve(null))
    req.end()
  })
}

// ------------------------------------------------------------------ TR-069

function md5(valor) {
  return crypto.createHash('md5').update(valor).digest('hex')
}

/** Le os campos de um desafio Digest (nonce, realm, qop...). */
function camposDigest(cabecalho) {
  const campos = {}
  for (const parte of String(cabecalho || '').replace(/^Digest\s+/i, '').split(',')) {
    const [chave, ...resto] = parte.trim().split('=')
    if (!chave) continue
    campos[chave] = resto.join('=').replace(/^"|"$/g, '')
  }
  return campos
}

/** Monta o header Authorization Digest a partir do desafio do CPE. */
function headerDigest(cabecalho, metodo, uri, usuario, senha) {
  const campos = camposDigest(cabecalho)
  const realm = campos.realm || 'CWMP'
  const nonce = campos.nonce || ''
  const qop = (campos.qop || '').split(',')[0].trim()
  const ha1 = md5(`${usuario}:${realm}:${senha}`)
  const ha2 = md5(`${metodo}:${uri}`)
  const cnonce = crypto.randomBytes(8).toString('hex')
  const nc = '00000001'
  const resposta = qop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`)
  const partes = [
    `username="${usuario}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${resposta}"`,
  ]
  if (qop) partes.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`)
  if (campos.opaque) partes.push(`opaque="${campos.opaque}"`)
  return `Digest ${partes.join(', ')}`
}

const PARAMETROS_CWMP = [
  'Device.DeviceInfo.SerialNumber',
  'Device.DeviceInfo.ModelName',
  'Device.DeviceInfo.Manufacturer',
  'Device.DeviceInfo.SoftwareVersion',
  'Device.DeviceInfo.ProductClass',
]

function envelopeGet(caminhos) {
  const structs = caminhos
    .map((c) => `<cwmp:ParameterValueStruct><cwmp:Name>${c}</cwmp:Name></cwmp:ParameterValueStruct>`)
    .join('')
  const id = crypto.randomBytes(8).toString('hex')
  return {
    id,
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soap:Header><cwmp:ID soap:mustUnderstand="1">${id}</cwmp:ID></soap:Header>
  <soap:Body><cwmp:GetParameterValues><cwmp:ParameterList>${structs}</cwmp:ParameterList></cwmp:GetParameterValues></soap:Body>
</soap:Envelope>`,
  }
}

/** Extrai Name/Value da resposta GetParameterValues. */
function lerParametros(xml) {
  const mapa = {}
  const regex = /<(?:[A-Za-z0-9_.-]+:)?ParameterValueStruct>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?ParameterValueStruct>/g
  let achado
  while ((achado = regex.exec(xml)) !== null) {
    const bloco = achado[1]
    const nome = bloco.match(/<(?:[A-Za-z0-9_.-]+:)?Name[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?Name>/)?.[1] || ''
    const valor = bloco.match(/<(?:[A-Za-z0-9_.-]+:)?Value[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?Value>/)?.[1] || ''
    const limpar = (texto) =>
      String(texto)
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .trim()
    if (nome) mapa[limpar(nome)] = limpar(valor)
  }
  return mapa
}

function postSoap(ip, porta, caminho, xml, cabecalhos) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: ip,
        port: porta,
        path: caminho,
        method: 'POST',
        timeout: 4000,
        headers: {
          'content-type': 'text/xml; charset=utf-8',
          soapaction: '"urn:dslforum-org:cwmp-1-0#GetParameterValues"',
          ...cabecalhos,
        },
      },
      (res) => {
        let corpo = ''
        res.setEncoding('utf8')
        res.on('data', (pedaco) => {
          if (corpo.length < 65536) corpo += pedaco
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, corpo }))
      },
    )
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.on('error', () => resolve(null))
    req.end(xml)
  })
}

/**
 * Consulta o CPE por CWMP usando as credenciais do ACS. Quando o CPE aceita a
 * sessao, devolve serial, DeviceId (MAC), modelo, fabricante e firmware.
 */
async function consultarCwmp(ip, porta, usuario, senha) {
  if (!usuario || !senha) return null
  for (const caminho of CAMINHOS_CWMP) {
    const { xml } = envelopeGet(PARAMETROS_CWMP)
    const semAuth = await postSoap(ip, porta, caminho, xml)
    if (!semAuth) continue
    let corpo = semAuth.corpo
    let status = semAuth.status
    const desafio = semAuth.headers['www-authenticate']
    if ((status === 401 || status === 403) && desafio) {
      const comAuth = await postSoap(ip, porta, caminho, xml, {
        authorization: headerDigest(desafio, 'POST', caminho, usuario, senha),
      })
      if (!comAuth) continue
      status = comAuth.status
      corpo = comAuth.corpo
    }
    if (status !== 200 || !corpo.includes('ParameterValueStruct')) continue
    const valores = lerParametros(corpo)
    if (!Object.keys(valores).length) continue
    const deviceId =
      valores['Device.DeviceInfo.SerialNumber'] || valores['Device.DeviceInfo.DeviceId'] || ''
    return {
      serial: valores['Device.DeviceInfo.SerialNumber'] || '',
      modelo: valores['Device.DeviceInfo.ModelName'] || '',
      fabricante: valores['Device.DeviceInfo.Manufacturer'] || '',
      firmware: valores['Device.DeviceInfo.SoftwareVersion'] || '',
      classe: valores['Device.DeviceInfo.ProductClass'] || '',
      deviceId,
      via: 'TR-069',
    }
  }
  return null
}

// ------------------------------------------------------------------- ARP/MAC

let cacheArp = null

/** Tabela ARP do sistema (Linux): resolve IP -> MAC dos hosts vizinhos. */
function tabelaArp(forcar = false) {
  if (!forcar && cacheArp && Date.now() - cacheArp.em < 5000) return cacheArp.mapa
  const mapa = new Map()
  try {
    const conteudo = fs.readFileSync('/proc/net/arp', 'utf8')
    for (const linha of conteudo.split('\n').slice(1)) {
      const campos = linha.trim().split(/\s+/)
      if (campos.length < 4) continue
      const [ip, , , mac, , flags] = campos
      if (!mac || mac === '00:00:00:00:00:00' || flags === '0x0') continue
      mapa.set(ip, mac.toUpperCase())
    }
  } catch {
    /* sem tabela ARP (Windows/macOS): segue sem MAC */
  }
  // "ip neigh" traz as entradas mais recentes (e cobre redes /24 maiores).
  try {
    const saida = execFileSync('ip', ['neigh'], { encoding: 'utf8', timeout: 3000 })
    for (const linha of saida.split('\n')) {
      const campos = linha.trim().split(/\s+/)
      if (campos.length < 2) continue
      const ip = campos[0]
      const mac = (campos.find((c) => /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(c)) || '').toUpperCase()
      if (ip && mac) mapa.set(ip, mac)
    }
  } catch {
    /* comando indisponivel: segue com o que tem */
  }
  cacheArp = { em: Date.now(), mapa }
  return mapa
}

/** Le o MAC de um IP recem-descoberto (a sondagem ja forca a resolucao ARP). */
function macDe(ip) {
  return tabelaArp().get(ip) || tabelaArp(true).get(ip) || ''
}

// ------------------------------------------------------------------- UPnP/SSDP

/**
 * Descoberta passiva por UPnP/SSDP. Muitos CPEs anunciam a si mesmos na
 * rede (sem porta aberta para o mundo), entao essa busca acha equipamentos
 * que a sondagem TCP nao encontra - e nao altera nada no equipamento.
 */
export function buscarSsdp({ timeoutMs = 3500 } = {}) {
  return new Promise((resolve) => {
    const encontrados = new Map()
    let socket
    try {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    } catch {
      resolve([])
      return
    }

    const finalizar = () => {
      try {
        socket.close()
      } catch {
        /* socket ja fechado */
      }
      resolve([...encontrados.values()])
    }

    socket.on('message', (mensagem, rinfo) => {
      const texto = mensagem.toString('utf8')
      if (!/^HTTP\/1\.\d 200/i.test(texto.trim())) return
      const cabecalhos = {}
      for (const linha of texto.split(/\r?\n/).slice(1)) {
        const separador = linha.indexOf(':')
        if (separador < 1) continue
        cabecalhos[linha.slice(0, separador).trim().toLowerCase()] = linha.slice(separador + 1).trim()
      }
      const chave = cabecalhos.usn || cabecalhos.location || rinfo.address
      if (encontrados.has(chave)) return
      encontrados.set(chave, {
        ip: rinfo.address,
        location: cabecalhos.location || '',
        server: cabecalhos.server || '',
        usn: cabecalhos.usn || '',
        st: cabecalhos['st'] || cabecalhos['nt'] || '',
      })
    })

    socket.on('error', () => finalizar())

    try {
      socket.bind(() => {
        try {
          socket.setBroadcast(true)
          socket.setMulticastTTL(2)
        } catch {
          /* opcoes de multicast indisponiveis: envia assim mesmo */
        }
        const consulta = [
          'M-SEARCH * HTTP/1.1',
          'HOST: 239.255.255.250:1900',
          'MAN: "ssdp:discover"',
          'MX: 2',
          'ST: ssdp:all',
          'USER-AGENT: rfn-discovery/1.0',
          '',
          '',
        ].join('\r\n')
        socket.send(Buffer.from(consulta), 1900, '239.255.255.250', (erro) => {
          if (erro) finalizar()
        })
        setTimeout(finalizar, timeoutMs)
      })
    } catch {
      finalizar()
    }
  })
}

/** Le a descricao do dispositivo (rootDesc.xml) para pegar marca e modelo. */
function descreverDispositivo(localizacao) {
  return new Promise((resolve) => {
    let url
    try {
      url = new URL(localizacao)
    } catch {
      resolve(null)
      return
    }
    const transporte = url.protocol === 'https:' ? https : http
    const req = transporte.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        timeout: 2500,
        headers: { 'user-agent': 'rfn-discovery/1.0' },
      },
      (res) => {
        let corpo = ''
        res.setEncoding('utf8')
        res.on('data', (pedaco) => {
          if (corpo.length < 65536) corpo += pedaco
        })
        res.on('end', () => {
          const campo = (tag) => {
            const achado = corpo.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))?.[1] || ''
            return achado.replace(/\s+/g, ' ').trim()
          }
          resolve({
            friendlyName: campo('friendlyName'),
            fabricante: campo('manufacturer'),
            modelo: campo('modelName') || campo('modelNumber') || campo('modelDescription'),
            serial: campo('serialNumber'),
          })
        })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.on('error', () => resolve(null))
    req.end()
  })
}

/**
 * Descobre equipamentos na rede por UPnP/SSDP e devolve a lista no mesmo
 * formato da varredura TCP, para o painel tratar tudo em uma tabela so.
 */
export async function descobrirRede(opcoes = {}) {
  const respostas = await buscarSsdp({ timeoutMs: Number(opcoes.timeoutMs) || 3500 })
  const hosts = []
  for (const resposta of respostas) {
    const descricao = resposta.location ? await descreverDispositivo(resposta.location) : null
    hosts.push({
      ip: resposta.ip,
      mac: macDe(resposta.ip),
      portas: [],
      modelo: descricao?.modelo || resposta.server || '',
      fabricante: descricao?.fabricante || '',
      firmware: '',
      serial: descricao?.serial || '',
      deviceId: '',
      servidor: resposta.server || '',
      titulo: descricao?.friendlyName || '',
      via: 'UPnP/SSDP',
      localizacao: resposta.location || '',
    })
  }
  return hosts
}

// ------------------------------------------------------------------ historico

function carregarHistorico() {
  try {
    const bruto = fs.readFileSync(ARQUIVO_HISTORICO, 'utf8')
    const lista = JSON.parse(bruto)
    return Array.isArray(lista) ? lista : []
  } catch {
    return []
  }
}

function salvarHistorico(lista) {
  try {
    garantirDir(DATA_DIR)
    fs.writeFileSync(ARQUIVO_HISTORICO, JSON.stringify(lista, null, 2))
  } catch {
    /* disco indisponivel: o historico fica so em memoria */
  }
}

/** Grava (ou atualiza) o resultado de uma varredura no historico em disco. */
function registrarNoHistorico(trabalho) {
  const registro = {
    id: trabalho.id,
    cidr: trabalho.cidr,
    portas: trabalho.portas,
    estado: trabalho.estado,
    total: trabalho.total,
    percorridos: trabalho.percorridos,
    encontrados: trabalho.encontrados,
    inicio: trabalho.inicio,
    fim: trabalho.fim,
    mensagem: trabalho.mensagem,
    hosts: trabalho.hosts,
    cancelado: trabalho.cancelado,
  }
  const lista = carregarHistorico().filter((v) => v.id !== registro.id)
  lista.unshift(registro)
  salvarHistorico(lista.slice(0, LIMITE_HISTORICO))
}

// -------------------------------------------------------------------- Motors

/** Descobre os equipamentos de um host (portas abertas + identificacao). */
async function inspecionarHost(ip, portas, timeoutMs, credenciais) {
  const abertos = []
  for (const porta of portas) {
    if (await portaAberta(ip, porta, timeoutMs)) abertos.push(porta)
  }
  if (!abertos.length) return null

  const resultado = {
    ip,
    mac: '',
    portas: abertos,
    modelo: '',
    fabricante: '',
    firmware: '',
    serial: '',
    deviceId: '',
    servidor: '',
    titulo: '',
    via: '',
  }

  // Pagina HTTP: muitos CPEs identificam o modelo no titulo ou no Server.
  for (const porta of abertos) {
    if (![80, 443, 8080, 8443].includes(porta)) continue
    const http1 = await sondarHttp(ip, porta, timeoutMs + 800)
    if (!http1) continue
    resultado.servidor = http1.server || resultado.servidor
    resultado.titulo = http1.titulo || resultado.titulo
    const texto = `${http1.titulo} ${http1.server}`.toLowerCase()
    if (!resultado.fabricante) {
      const fabricantes = [
        ['technicolor', 'Technicolor'],
        ['zte', 'ZTE'],
        ['huawei', 'Huawei'],
        ['nokia', 'Nokia'],
        ['sagem', 'Sagemcom'],
        ['nvidia', 'Nvidia'],
        ['arris', 'Arris'],
        ['motorola', 'Motorola'],
        ['intelbras', 'Intelbras'],
        ['dasan', 'Dasan'],
        ['comtrend', 'Comtrend'],
        ['realtek', 'Realtek'],
      ]
      const achado = fabricantes.find(([chave]) => texto.includes(chave))
      if (achado) resultado.fabricante = achado[1]
    }
    if (!resultado.modelo && http1.titulo) resultado.modelo = http1.titulo.slice(0, 80)
    break
  }

  // TR-069: leitura direta do equipamento quando ele aceita a sessao do ACS.
  for (const porta of PORTAS_CWMP) {
    if (!abertos.includes(porta)) continue
    const cwmp = await consultarCwmp(ip, porta, credenciais.usuario, credenciais.senha)
    if (cwmp) {
      Object.assign(resultado, cwmp)
      break
    }
  }

  if (!resultado.via) resultado.via = 'varredura TCP'
  // O MAC e lido depois da sondagem: e a sondagem que provoca a resolucao ARP.
  resultado.mac = macDe(ip)
  return resultado
}

// ------------------------------------------------------------------- Jobs

const varreduras = new Map()

/**
 * Inicia uma varredura. A execucao acontece em segundo plano: o painel
 * acompanha o progresso consultando o status do trabalho.
 */
export function iniciarVarredura(opcoes = {}) {
  const cidr = String(opcoes.cidr || '').trim()
  const portas = Array.isArray(opcoes.portas) && opcoes.portas.length
    ? opcoes.portas.map(Number).filter((p) => Number.isInteger(p) && p > 0 && p < 65536)
    : PORTAS_PADRAO
  const timeoutMs = Math.min(Math.max(Number(opcoes.timeoutMs) || 400, 100), 5000)
  const limite = Math.min(Math.max(Number(opcoes.limite) || 1024, 16), 4096)

  let alvos
  try {
    alvos = IPsDaFaixa(cidr, limite)
  } catch (erro) {
    return { erro: erro.message }
  }

  const id = `v${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`
  const trabalho = {
    id,
    cidr,
    portas,
    timeoutMs,
    estado: 'rodando',
    total: alvos.length,
    percorridos: 0,
    encontrados: 0,
    inicio: new Date().toISOString(),
    fim: null,
    mensagem: 'Varredura em andamento',
    hosts: [],
    cancelado: false,
  }
  varreduras.set(id, trabalho)
  registrarNoHistorico(trabalho)

  const credenciais = {
    usuario: opcoes.acsUsuario || '',
    senha: opcoes.acsSenha || '',
  }

  ;(async () => {
    // Descoberta UPnP/SSDP: roda antes da sondagem e enriquece o resultado
    // com equipamentos que se anunciam (e que nao abrem porta para a varredura).
    if (opcoes.ssdp !== false) {
      try {
        const achados = await descobrirRede({ timeoutMs: 3000 })
        for (const achado of achados) {
          if (trabalho.cancelado) break
          if (!trabalho.hosts.some((h) => h.ip === achado.ip)) {
            trabalho.hosts.push(achado)
            trabalho.encontrados = trabalho.hosts.length
          }
        }
      } catch {
        /* descoberta e opcional: a varredura TCP continua */
      }
    }
    const fila = [...alvos]
    const concorrencia = Math.min(Math.max(Number(opcoes.concorrencia) || 32, 4), 128)
    const trabalhadores = Array.from({ length: concorrencia }, async () => {
      while (fila.length && !trabalho.cancelado) {
        const ip = fila.shift()
        if (!ip) break
        try {
          const host = await inspecionarHost(ip, portas, timeoutMs, credenciais)
          if (host) {
            const existente = trabalho.hosts.find((h) => h.ip === host.ip)
            if (existente) {
              // O mesmo equipamento pode ter sido achado pelo UPnP/SSDP:
              // completa os campos que faltam sem duplicar a linha.
              if (!existente.portas.length) existente.portas = host.portas
              if (!existente.modelo) existente.modelo = host.modelo
              if (!existente.fabricante) existente.fabricante = host.fabricante
              if (!existente.firmware) existente.firmware = host.firmware
              if (!existente.serial) existente.serial = host.serial
              if (!existente.deviceId) existente.deviceId = host.deviceId
              if (!existente.titulo) existente.titulo = host.titulo
              if (!existente.servidor) existente.servidor = host.servidor
            } else {
              trabalho.hosts.push(host)
            }
            trabalho.encontrados = trabalho.hosts.length
          }
        } catch {
          /* host inacessivel: segue a varredura */
        }
        trabalho.percorridos += 1
      }
    })
    await Promise.all(trabalhadores)
    trabalho.estado = trabalho.cancelado ? 'cancelada' : 'concluida'
    trabalho.fim = new Date().toISOString()
    trabalho.mensagem = trabalho.cancelado
      ? 'Varredura cancelada'
      : `Varredura concluida: ${trabalho.encontrados} host(s) com servicos de CPE em ${trabalho.total} enderecos`
    registrarNoHistorico(trabalho)
  })().catch((erro) => {
    trabalho.estado = 'erro'
    trabalho.fim = new Date().toISOString()
    trabalho.mensagem = erro.message
    registrarNoHistorico(trabalho)
  })

  return trabalho
}

export function obterVarredura(id) {
  const emMemoria = varreduras.get(id)
  if (emMemoria) return emMemoria
  // Varredura antiga: recupera do historico gravado em disco.
  return carregarHistorico().find((v) => v.id === id) || null
}

export function cancelarVarredura(id) {
  const trabalho = varreduras.get(id)
  if (!trabalho) return null
  trabalho.cancelado = true
  trabalho.estado = 'cancelada'
  trabalho.mensagem = 'Varredura cancelada'
  trabalho.fim = new Date().toISOString()
  registrarNoHistorico(trabalho)
  return trabalho
}

/**
 * Registra o resultado de uma descoberta UPnP/SSDP como um trabalho de
 * varredura, para o painel tratar (e importar) igual aos demais.
 */
export function registrarDescoberta(hosts) {
  const id = `d${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`
  const agora = new Date().toISOString()
  const trabalho = {
    id,
    cidr: 'descoberta UPnP/SSDP',
    portas: [],
    estado: 'concluida',
    total: hosts.length,
    percorridos: hosts.length,
    encontrados: hosts.length,
    inicio: agora,
    fim: agora,
    mensagem: `Descoberta UPnP/SSDP concluida: ${hosts.length} equipamento(s) anunciado(s) na rede local`,
    hosts,
    cancelado: false,
  }
  varreduras.set(id, trabalho)
  registrarNoHistorico(trabalho)
  return trabalho
}

/** Ultimas varreduras (memoria + historico em disco), da mais nova para a mais antiga. */
export function listarVarreduras(limite = LIMITE_HISTORICO) {
  const unidas = new Map()
  for (const v of carregarHistorico()) unidas.set(v.id, v)
  for (const v of varreduras.values()) unidas.set(v.id, v)
  return [...unidas.values()]
    .sort((a, b) => (a.inicio < b.inicio ? 1 : -1))
    .slice(0, limite)
}
