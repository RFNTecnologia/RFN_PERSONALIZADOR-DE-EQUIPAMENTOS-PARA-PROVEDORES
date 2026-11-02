const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
let equipment = [], customers = [], profiles = [], acs = [], providerSettings = null, mikrotikIntegration = { configured: false };
let currentProvisionValues = [];
let currentDeviceModal = { id: null, acsId: '', tab: 'info' };

function showStatus(msg, ok = true) {
  $('status').textContent = msg;
  $('status').className = `status show ${ok ? 'ok' : 'err'}`;
  setTimeout(() => $('status').className = 'status', 3500);
}
function showPage(name, btn) {
  document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
  $('page-' + name).classList.add('active');
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  btn?.classList.add('active');
  if (name === 'equipment') renderEquipment();
  if (name === 'customers') renderCustomers();
  if (name === 'profiles') renderProfiles();
  if (name === 'isp') loadProviderSettings();
  if (name === 'acs') loadACS();
  if (name === 'compatibility') renderCompatibilityCatalog($('compatSearch')?.value || '');
  if (name === 'dashboard') renderOperationsDashboard();
}
async function api(url, opt = {}) {
  if (authSession?.access_token && !url.startsWith('/api/auth/')) { await ensureFreshSession(); await syncAuthCookie(authSession); }
  const request = () => fetch(url, {
    ...opt,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(opt.headers || {}) }
  });
  let r = await request();
  if (r.status === 401 && !url.startsWith('/api/auth/')) {
    await requestLogin();
    if (authSession?.access_token) await syncAuthCookie(authSession);
    r = await request();
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Erro');
  return d;
}

let authSession = null;
try { authSession = JSON.parse(localStorage.getItem('rfn_supabase_session') || 'null'); } catch { authSession = null; }

async function ensureFreshSession() {
  if (!authSession?.refresh_token) return;
  const expiresAt = Number(authSession.expires_at || 0);
  if (expiresAt && expiresAt > Math.floor(Date.now() / 1000) + 60) return;
  const data = await supabaseAuth('token?grant_type=refresh_token', { refresh_token: authSession.refresh_token });
  authSession = { ...data, expires_at: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600) };
  localStorage.setItem('rfn_supabase_session', JSON.stringify(authSession));
  await syncAuthCookie(authSession);
}

async function syncAuthCookie(session) {
  const response = await fetch('/api/auth/session', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ access_token: session?.access_token || '' })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Não foi possível validar a sessão.');
  }
}

async function supabaseAuth(path, body) {
  const response = await fetch(`${window.RFN_SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: window.RFN_SUPABASE_PUBLISHABLE_KEY },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.msg || data.message || data.error_description || data.error || 'Falha na autenticação.');
  return data;
}

async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    if (authSession?.access_token) {
      await fetch(`${window.RFN_SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST', headers: { apikey: window.RFN_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${authSession.access_token}` }
      });
    }
  } finally { localStorage.removeItem('rfn_supabase_session'); authSession = null; window.location.reload(); }
}
let loginPromise = null;
let resolveLogin = null;

function requestLogin() {
  if (!loginPromise) {
    loginPromise = new Promise(resolve => { resolveLogin = resolve; });
    $('loginOverlay').classList.add('open');
    $('loginError').textContent = '';
    $('loginUsername').focus();
  }
  return loginPromise;
}

$('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('loginError').textContent = '';
  try {
    const data = await supabaseAuth('token?grant_type=password', {
      email: $('loginUsername').value.trim(), password: $('loginPassword').value
    });
    authSession = { ...data, expires_at: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600) };
    localStorage.setItem('rfn_supabase_session', JSON.stringify(authSession));
    await syncAuthCookie(authSession);
    $('loginPassword').value = '';
    $('loginOverlay').classList.remove('open');
    const resolve = resolveLogin;
    loginPromise = null;
    resolveLogin = null;
    resolve?.(true);
    window.location.reload();
  } catch (error) {
    $('loginError').textContent = error.message;
  }
});

async function loadAll() {
  try {
    const [d, e, c, p, s, m] = await Promise.all([api('/api/dashboard'), api('/api/equipment'), api('/api/customers'), api('/api/profiles'), api('/api/provider-settings'), api('/api/mikrotik/status')]);
    equipment = e; customers = c; profiles = p; providerSettings = s; mikrotikIntegration = m; renderProviderSettings();
    $('cCustomers').textContent = d.customers ?? customers.length;
    $('cEquipment').textContent = d.equipment;
    $('cOnline').textContent = d.online_equipment;
    $('cProfiles').textContent = d.profiles;
    renderEquipment(); renderCustomers(); renderProfiles(); renderOperationsDashboard(); checkACS();
  } catch (e) { showStatus(e.message, false); }
}

function renderOperationsDashboard() {
  const host = $('operationsDashboard');
  if (!host) return;
  const q = String($('operationsSearch')?.value || '').trim().toLocaleLowerCase('pt-BR');
  const offline = equipment.filter(e => e.status !== 'online').length;
  const unassigned = equipment.filter(e => !e.customer_id).length;
  const noProfile = equipment.filter(e => !e.profile_id).length;
  const noAcs = equipment.filter(e => !e.acs_device_id).length;
  const alerts = [
    { label: 'Equipamentos sem cliente', count: unassigned, hint: 'Associe o titular em Equipamentos → Abrir.' },
    { label: 'Equipamentos sem perfil', count: noProfile, hint: 'Associe um perfil compatível antes de provisionar.' },
    { label: 'Sem vínculo GenieACS', count: noAcs, hint: 'Confira o ACS ID e sincronize o CPE.' },
    { label: 'Não reportados online', count: offline, hint: 'Confira o último contato; estado desconhecido não significa necessariamente defeito.' }
  ].filter(x => x.count > 0);
  const visible = equipment.filter(e => !q || [e.manufacturer,e.model,e.serial_number,e.mac,e.customer_name,e.profile_name,e.acs_device_id].some(v => String(v || '').toLocaleLowerCase('pt-BR').includes(q)));
  const alertHtml = alerts.length ? `<div class="grid ops-alerts">${alerts.map(a => `<div class="card ops-alert"><div class="ops-alert-count">${a.count}</div><div><b>${esc(a.label)}</b><div class="hint">${esc(a.hint)}</div></div></div>`).join('')}</div>` : '<div class="hint-block">Nenhuma pendência cadastral identificada no inventário atual.</div>';
  const rows = visible.map(e => {
    const status = e.status === 'online' ? '<span class="badge online">Online</span>' : '<span class="badge unknown">Verificar</span>';
    const pending = [];
    if (!e.customer_id) pending.push('sem cliente');
    if (!e.profile_id) pending.push('sem perfil');
    if (!e.acs_device_id) pending.push('sem ACS');
    const readiness = pending.length ? `<span class="badge unknown">${esc(pending.join(' · '))}</span>` : '<span class="badge online">Cadastro completo</span>';
    return `<tr><td><b>${esc(e.manufacturer)} ${esc(e.model)}</b><div class="hint mono">${esc(e.serial_number)}</div></td><td>${esc(e.customer_name || 'Não associado')}</td><td>${esc(e.profile_name || 'Sem perfil')}</td><td>${status}</td><td>${readiness}</td><td><button class="secondary" onclick="equipmentActions(${Number(e.id)},'${esc(e.acs_device_id || '')}')">Abrir operação</button></td></tr>`;
  }).join('') || '<tr><td colspan="6" class="empty">Nenhum equipamento corresponde à busca.</td></tr>';
  host.innerHTML = `${alertHtml}<div class="table-wrap"><table><thead><tr><th>Equipamento</th><th>Cliente</th><th>Perfil</th><th>Inventário</th><th>Pendências</th><th>Ação</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
async function refreshOperationsDashboard() {
  await loadAll();
  showStatus('Painel operacional atualizado.');
}

function renderEquipment() {
  const tb = $('equipmentTable');
  const notice = $('mikrotikNotice');
  if (notice) {
    notice.innerHTML = mikrotikIntegration.configured
      ? `<b>Integração MikroTik configurada.</b> Host: <span class="mono">${esc(mikrotikIntegration.host)}</span>:${esc(mikrotikIntegration.port)}. <button class="secondary" onclick="testMikrotikConnection()">Testar conexão (somente leitura)</button><div class="hint">Bloquear desabilita a conta PPPoE e encerra as sessões ativas desse usuário.</div>`
      : `<b>Integração MikroTik ainda não configurada.</b> Os botões ficam desativados até preencher MIKROTIK_HOST, MIKROTIK_USERNAME e MIKROTIK_PASSWORD no arquivo .env e reiniciar a API.`;
  }
  if (!equipment.length) { tb.innerHTML = '<tr><td colspan="10" class="empty">Nenhum equipamento cadastrado.</td></tr>'; return; }
  tb.innerHTML = equipment.map(x => {
    const serviceStatus = x.service_status || 'enabled';
    const blocked = serviceStatus === 'blocked';
    const hasCustomer = Boolean(x.customer_id && x.customer_pppoe_username);
    const action = blocked ? 'unblock' : 'block';
    const actionLabel = blocked ? 'Desbloquear internet' : 'Bloquear internet';
    const actionDisabled = !mikrotikIntegration.configured || !hasCustomer;
    const title = !mikrotikIntegration.configured ? 'Configure a integração MikroTik no .env' : (!hasCustomer ? 'Associe um cliente e cadastre o usuário PPPoE' : actionLabel);
    return `<tr><td>${esc(x.manufacturer)}</td><td>${esc(x.model)}</td><td>${esc(x.equipment_type)}</td><td class="mono">${esc(x.serial_number)}</td><td class="mono">${esc(x.mac || '-')}</td><td>${esc(x.customer_name || '-')}</td><td>${esc(x.profile_name || 'Sem perfil')}</td><td><span class="badge ${x.status === 'online' ? 'online' : 'unknown'}">${esc(x.status)}</span></td><td><span class="badge ${blocked ? 'unknown' : 'online'}">${blocked ? 'Acesso bloqueado' : 'Acesso liberado'}</span><div class="hint">${esc(x.customer_pppoe_username || 'Sem usuário PPPoE')}</div></td><td><div class="actions"><button class="secondary" onclick="equipmentActions(${Number(x.id)},'${esc(x.acs_device_id || '')}')">Abrir</button><button ${actionDisabled ? 'disabled title="' + esc(title) + '"' : ''} class="${blocked ? '' : 'danger'}" onclick="changeServiceStatus(${Number(x.id)},'${action}')">${actionLabel}</button></div></td></tr>`;
  }).join('');
}
async function testMikrotikConnection() {
  try {
    const result = await api('/api/mikrotik/test', { method: 'POST', body: '{}' });
    showStatus(`Conexão MikroTik confirmada: ${result.identity} (${result.host}:${result.port}). Nenhuma conta PPPoE foi alterada.`);
  } catch (error) {
    showStatus(error.message, false);
  }
}
async function changeServiceStatus(equipmentId, action) {
  const item = equipment.find(x => Number(x.id) === Number(equipmentId));
  if (!item) return showStatus('Equipamento não encontrado.', false);
  const blocking = action === 'block';
  const verb = blocking ? 'BLOQUEAR' : 'DESBLOQUEAR';
  const account = item.customer_pppoe_username || 'usuário PPPoE não cadastrado';
  const warning = blocking
    ? `Isso desabilitará a conta PPPoE "${account}" no MikroTik e encerrará as sessões ativas desse usuário.`
    : `Isso habilitará novamente a conta PPPoE "${account}" no MikroTik. O cliente poderá reconectar.`;
  if (!confirm(`${verb} o acesso à internet de ${item.customer_name || 'este cliente'}?\n\n${warning}\n\nA configuração PPPoE armazenada no MR60X não será alterada. Continuar?`)) return;
  try {
    const result = await api(`/api/equipment/${Number(equipmentId)}/service-action`, { method: 'POST', body: JSON.stringify({ action }) });
    showStatus(blocking ? `Acesso bloqueado no MikroTik. Sessões encerradas: ${result.sessionsDisconnected ?? 0}.` : 'Conta PPPoE habilitada no MikroTik; o cliente poderá reconectar.');
    await loadAll();
  } catch (error) {
    showStatus(error.message, false);
    await loadAll();
  }
}
function renderCustomers() {
  const tb = $('customersTable');
  if (!tb) return;
  if (!customers.length) {
    tb.innerHTML = '<tr><td colspan="6" class="empty">Nenhum cliente cadastrado. Clique em + Cliente para criar o primeiro cadastro.</td></tr>';
    return;
  }
  tb.innerHTML = customers.map(c => `<tr><td>${esc(c.name)}</td><td class="mono">${esc(c.document || '—')}</td><td>${esc(c.phone || '—')}</td><td>${esc(c.address || '—')}</td><td><div class="mono">${esc(c.pppoe_username || 'Não cadastrado')}</div><div class="hint">Somente o usuário; senha não é armazenada</div></td><td><button class="secondary" onclick="editCustomer(${c.id})">Editar dados / PPPoE</button></td></tr>`).join('');
}
function openCustomerModal(customer = null) {
  const editing = Boolean(customer?.id);
  const c = customer || {};
  openModal(`<h2>${editing ? 'Editar cliente' : 'Novo cliente'}</h2><p class="hint">Cadastre o titular e, quando a conta estiver criada no MikroTik, registre o nome de usuário PPPoE que pertence a ele. A senha PPPoE nunca é armazenada no cadastro.</p><div class="form"><div><label>Nome completo / Razão social *</label><input id="cName" required maxlength="180" autocomplete="name" value="${esc(c.name || '')}"></div><div class="two"><div><label>CPF / CNPJ</label><input id="cDocument" maxlength="40" value="${esc(c.document || '')}"></div><div><label>Telefone</label><input id="cPhone" maxlength="50" autocomplete="tel" value="${esc(c.phone || '')}"></div></div><div><label>Endereço</label><input id="cAddress" maxlength="300" autocomplete="street-address" value="${esc(c.address || '')}"></div><div><label>Usuário PPPoE do cliente (sem senha)</label><input id="cPppoeUsername" maxlength="180" autocomplete="off" value="${esc(c.pppoe_username || '')}" placeholder="Ex.: cliente123"><p class="hint">Para ativação definitiva, este usuário precisa coincidir exatamente com o informado no provisionamento e com a conta validada no MikroTik.</p></div><div class="actions"><button onclick="saveCustomer(${editing ? c.id : 'null'})">${editing ? 'Salvar alterações' : 'Salvar cliente'}</button><button class="secondary" onclick="closeModal()">Cancelar</button></div></div>`);
  $('cName')?.focus();
}
function editCustomer(id) {
  const customer = customers.find(c => String(c.id) === String(id));
  if (!customer) { showStatus('Cliente não encontrado.', false); return; }
  openCustomerModal(customer);
}
async function saveCustomer(id = null) {
  try {
    const name = $('cName')?.value.trim();
    if (!name) throw new Error('Informe o nome do cliente.');
    const body = {
      name,
      document: $('cDocument')?.value.trim(),
      phone: $('cPhone')?.value.trim(),
      address: $('cAddress')?.value.trim(),
      pppoe_username: $('cPppoeUsername')?.value.trim()
    };
    await api(id ? `/api/customers/${id}` : '/api/customers', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    closeModal(); await loadAll(); showPage('customers', document.querySelector('.tabs .tab[onclick*="customers"]'));
    showStatus(id ? 'Cadastro do cliente atualizado.' : 'Cliente cadastrado. Agora associe-o ao equipamento em Equipamentos → Abrir.');
  } catch (e) { showStatus(e.message, false); }
}
function renderProfiles() {
  const g = $('profilesGrid');
  if (!profiles.length) { g.innerHTML = '<div class="card empty">Nenhum perfil.</div>'; return; }
  g.innerHTML = profiles.map(p => `<div class="card"><h3 style="margin-top:0">${esc(p.name)}</h3><p class="hint">${esc(p.description || '')}</p><div class="kv"><span>Parâmetros TR-069</span><b>${Array.isArray(p.config?.parameterValues) ? p.config.parameterValues.length : 0}</b></div><pre class="hint mono" style="white-space:pre-wrap">${esc(JSON.stringify(p.config, null, 2))}</pre><button onclick="editProfile(${p.id})">Editar</button></div>`).join('');
}

const compatibilityCatalog = [
  {
    manufacturer: 'MERCUSYS',
    models: 'MR60X V2 — CPE atualmente em laboratório',
    resetMethod: 'ISP Preset / Agile Config 2.1 é listado oficialmente para MR60X V2. A combinação exata de revisão/firmware do CPE de laboratório ainda precisa de confirmação do fabricante.',
    remote: 'TR-069/GenieACS confirmado no laboratório: o MR60X aparece online e reporta parâmetros.',
    status: 'Em validação com fabricante; solicitação de compatibilidade já enviada.',
    next: 'Confirmar revisão/firmware e obter o pacote oficial antes de gravar padrões persistentes.',
    source: 'MERCUSYS — ISP Preset',
    url: 'https://www.mercusys.com.br/support/isp/',
    tags: 'mercusys mr60x v2 agile config 2.1 isp preset genieacs tr-069 reset firmware'
  },
  {
    manufacturer: 'TP-Link',
    models: 'Exemplos documentados: Archer C6 (revisão/região específica), Archer A6, Archer C80; há outros modelos nas listas oficiais.',
    resetMethod: 'Aginet Config / Agile Config para modelos e revisões explicitamente suportados; permite definir parâmetros ISP persistentes após reset.',
    remote: 'TR-069 depende do modelo e firmware. A lista oficial diferencia suporte nativo e suporte com firmware especial.',
    status: 'Base oficial disponível; inventário exato do parque RFN ainda precisa ser cadastrado.',
    next: 'Registrar o modelo completo, revisão de hardware, região e versão de firmware antes de selecionar um fluxo.',
    source: 'TP-Link Brasil — Aginet/Agile Config',
    url: 'https://www.tp-link.com/br/solution/agile-config/',
    secondarySource: 'Tabela Agile Config/TR-069',
    secondaryUrl: 'https://www.tp-link.com/br/support/faq/2932/',
    tags: 'tp-link tplink aginet agile config archer c6 archer a6 archer c80 tr-069 reset'
  },
  {
    manufacturer: 'Intelbras',
    models: 'Modelos listados no Portal Customize incluem Twibi Giga+, ACtion RF 1200, RF 301 K e IWR 3000 N.',
    resetMethod: 'Portal Customize cria firmware customizado com padrões de fábrica do provedor para os modelos suportados.',
    remote: 'A compatibilidade com GenieACS/TR-069 precisa ser validada separadamente para o modelo e firmware.',
    status: 'Mecanismo oficial de padrões persistentes documentado para modelos da lista; modelos exatos usados no RFN ainda precisam ser identificados.',
    next: 'Conferir o modelo na lista do Portal Customize e registrar se o CPE também oferece TR-069.',
    source: 'Intelbras — Portal Customize',
    url: 'https://www.intelbras.com/pt-br/customize',
    tags: 'intelbras customize rf 1200 rf 301k iwr 3000 n twibi giga reset firmware tr-069'
  },
  {
    manufacturer: 'ZTE',
    models: 'Modelos do inventário RFN: ZXHN F6201B e F6600P.',
    resetMethod: 'Não há um mecanismo único de personalização pós-reset confirmado para todos os modelos/revisões. Depende do firmware fornecido ao provedor e do procedimento OEM.',
    remote: 'O fabricante documenta TR-069 e OMCI no ZXHN F6201B. O F6600P precisa de confirmação específica de firmware/operadora.',
    status: 'Gerenciamento do F6201B documentado; persistência e método de recuperação pós-reset ainda não confirmados.',
    next: 'Confirmar variante, versão do firmware do provedor e procedimento autorizado para padrões persistentes.',
    source: 'ZTE — ZXHN F6201B',
    url: 'https://www.zte.com.cn/global/home_and_enterprise/campus_network/zxhn_f6201b.html',
    tags: 'zte zxhn f6201b f6600p omci tr-069 reset firmware'
  },
  {
    manufacturer: 'C-Data',
    models: 'Modelos do inventário RFN: FD511G-X-F670 e FD514GS3-R850.',
    resetMethod: 'Padrão persistente pós-reset ainda precisa de confirmação por modelo/firmware. Em ONU/ONT, a restauração e o reprovisionamento também podem depender da OLT/OMCI.',
    remote: 'A C-Data documenta fluxo TR-069 para vincular ONUs compatíveis ao CMS/ACS por meio do perfil na OLT.',
    status: 'Fluxo geral de TR-069/CMS documentado; compatibilidade exata dos dois modelos e comportamento de reset pendentes.',
    next: 'Registrar OLT usada, revisão/firmware da ONU/ONT e verificar o perfil TR-069 e a recuperação após reset em laboratório.',
    source: 'C-Data — configuração TR-069 ONU/CMS',
    url: 'https://pt.cdatatec.com/video/tr-069-configuration-for-onu-to-cms-connectivity-c-data-cms-tutorial-series.html',
    tags: 'c-data cdata fd511g-x-f670 fd514gs3-r850 onu ont olt omci tr-069 cms acs reset'
  }
];

function renderCompatibilityCatalog(filter = '') {
  const grid = $('compatibilityGrid');
  if (!grid) return;
  const q = String(filter || '').trim().toLocaleLowerCase('pt-BR');
  const records = compatibilityCatalog.filter(x => !q || `${x.manufacturer} ${x.models} ${x.resetMethod} ${x.remote} ${x.status} ${x.next} ${x.tags}`.toLocaleLowerCase('pt-BR').includes(q));
  if (!records.length) {
    grid.innerHTML = '<div class="card empty">Nenhum registro corresponde ao filtro.</div>';
    return;
  }
  grid.innerHTML = records.map(x => `<div class="card" style="min-width:0">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap"><h3 style="margin:0">${esc(x.manufacturer)}</h3><span class="badge ${x.manufacturer === 'MERCUSYS' ? 'online' : 'unknown'}">${x.manufacturer === 'MERCUSYS' ? 'Em laboratório' : 'Requer validação por modelo'}</span></div>
    <p style="margin:10px 0 8px"><b>Modelos</b><br>${esc(x.models)}</p>
    <div class="kv" style="align-items:flex-start"><b style="min-width:132px">Pós-reset</b><span>${esc(x.resetMethod)}</span></div>
    <div class="kv" style="align-items:flex-start"><b style="min-width:132px">ACS / gerência</b><span>${esc(x.remote)}</span></div>
    <div class="kv" style="align-items:flex-start"><b style="min-width:132px">Estado no RFN</b><span>${esc(x.status)}</span></div>
    <div class="hint-block"><b>Próxima ação:</b> ${esc(x.next)}</div>
    <div class="actions" style="margin-top:12px"><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer" class="button-link">${esc(x.source)}</a>${x.secondaryUrl ? `<a href="${esc(x.secondaryUrl)}" target="_blank" rel="noopener noreferrer" class="button-link secondary-link">${esc(x.secondarySource)}</a>` : ''}</div>
  </div>`).join('');
}
function renderProviderSettings() {
  const v = providerSettings || {};
  const fields = {
    ispCompany: v.company_name || '', ispPortalTitle: v.portal_title || '', ispLogo: v.logo_url || '',
    ispPhone: v.support_phone || '', ispWhatsapp: v.support_whatsapp || '', ispMessage: v.portal_message || '',
    ispSsid24: v.default_wifi_ssid || '', ispSsid5: v.default_wifi_ssid_5g || '', ispAcsUrl: v.acs_url || '',
    ispAcsUser: v.acs_username || '', ispCrPath: v.connection_request_path || '', ispResetPolicy: v.reset_policy || ''
  };
  for (const [id, val] of Object.entries(fields)) { if ($(id)) $(id).value = val; }
  updateProviderPreview();
}
function updateProviderPreview() {
  const company = $('ispCompany')?.value || 'Sua Empresa';
  const title = $('ispPortalTitle')?.value || 'Configuração do Equipamento';
  const message = $('ispMessage')?.value || 'Este equipamento é gerenciado pelo provedor.';
  const s24 = $('ispSsid24')?.value || '—'; const s5 = $('ispSsid5')?.value || '—';
  if ($('ispPreviewCompany')) $('ispPreviewCompany').textContent = company;
  if ($('ispPreviewTitle')) $('ispPreviewTitle').textContent = title;
  applyProviderBranding(company, title, $('ispLogo')?.value?.trim() || '');
  if ($('ispPreviewMessage')) $('ispPreviewMessage').textContent = message;
  if ($('ispPreviewSsid24')) $('ispPreviewSsid24').textContent = s24;
  if ($('ispPreviewSsid5')) $('ispPreviewSsid5').textContent = s5;
  const logo = $('ispPreviewLogo'); const url = $('ispLogo')?.value?.trim();
  if (logo) { if (url) { logo.src = url; logo.style.display = 'block'; logo.onerror = () => { logo.style.display = 'none'; }; } else { logo.removeAttribute('src'); logo.style.display = 'none'; } }
}
function applyProviderBranding(companyName, portalTitle, logoUrl) {
  const name = $('headerBrandName');
  const subtitle = $('headerBrandSubtitle');
  const image = $('headerBrandLogo');
  if (name) name.textContent = String(companyName || '').trim() || 'RFN_Personalizar-roteadores';
  if (subtitle) subtitle.textContent = String(portalTitle || '').trim() || 'Personalização de Roteadores • ONU • ONT';
  if (image) {
    if (logoUrl) {
      image.onerror = () => { image.style.display = 'none'; };
      image.onload = () => { image.style.display = 'block'; };
      image.src = logoUrl;
    } else {
      image.removeAttribute('src'); image.style.display = 'none';
    }
  }
}
function clearProviderLogo() {
  if ($('ispLogo')) $('ispLogo').value = '';
  if ($('ispLogoFile')) $('ispLogoFile').value = '';
  updateProviderPreview();
}
function handleProviderLogoUpload(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.type)) { showStatus('Formato de logo inválido. Use PNG, JPEG, WebP ou GIF.', false); event.target.value = ''; return; }
  if (file.size > 1.5 * 1024 * 1024) { showStatus('A logo deve ter no máximo 1,5 MB.', false); event.target.value = ''; return; }
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result !== 'string' || !reader.result.startsWith('data:image/')) { showStatus('Não foi possível ler o arquivo de logo.', false); return; }
    $('ispLogo').value = reader.result;
    updateProviderPreview();
    showStatus('Logo carregada na prévia. Clique em Salvar Personalização ISP para gravar.');
  };
  reader.onerror = () => showStatus('Falha ao ler o arquivo de logo.', false);
  reader.readAsDataURL(file);
}
$('ispLogoFile')?.addEventListener('change', handleProviderLogoUpload);
async function loadProviderSettings() {
  try { providerSettings = await api('/api/provider-settings'); renderProviderSettings(); }
  catch (e) { showStatus(e.message, false); }
}
async function saveProviderSettings() {
  try {
    providerSettings = await api('/api/provider-settings', {
      method: 'PUT', body: JSON.stringify({
        company_name: $('ispCompany').value.trim(), logo_url: $('ispLogo').value.trim(), favicon_url: null,
        support_phone: $('ispPhone').value.trim(), support_whatsapp: $('ispWhatsapp').value.trim(),
        portal_title: $('ispPortalTitle').value.trim(), portal_message: $('ispMessage').value.trim(),
        default_wifi_ssid: $('ispSsid24').value.trim(), default_wifi_ssid_5g: $('ispSsid5').value.trim(),
        acs_url: $('ispAcsUrl').value.trim(), acs_username: $('ispAcsUser').value.trim(),
        connection_request_path: $('ispCrPath').value.trim(), reset_policy: $('ispResetPolicy').value.trim()
      })
    });
    renderProviderSettings();
    showStatus('Personalização ISP salva.');
  } catch (e) { showStatus(e.message, false); }
}
['ispCompany', 'ispPortalTitle', 'ispLogo', 'ispMessage', 'ispSsid24', 'ispSsid5'].forEach(id => {
  document.addEventListener('input', e => { if (e.target?.id === id) updateProviderPreview(); });
});

async function checkACS() {
  try { const d = await api('/api/acs/status'); $('acsBadge').textContent = `ACS: ONLINE (${d.devices})`; $('acsBadge').className = 'badge online'; }
  catch { $('acsBadge').textContent = 'ACS: indisponível'; $('acsBadge').className = 'badge unknown'; }
}
async function syncACS() {
  try { const d = await api('/api/acs/sync', { method: 'POST', body: '{}' }); showStatus(`${d.synced} equipamento(s) sincronizado(s).`); await loadAll(); }
  catch (e) { showStatus(e.message, false); }
}
async function loadACS() {
  try {
    acs = await api('/api/acs/devices'); $('acsDevicesCount').textContent = acs.length;
    $('acsTable').innerHTML = acs.map(d => {
      const man = d?._deviceId?._Manufacturer || d?.Device?.DeviceInfo?.Manufacturer?.value || d?.InternetGatewayDevice?.DeviceInfo?.Manufacturer?.value || '-';
      const model = d?._deviceId?._ProductClass || d?.Device?.DeviceInfo?.ModelName?.value || d?.InternetGatewayDevice?.DeviceInfo?.ModelName?.value || '-';
      const ser = d?._deviceId?._SerialNumber || d?.Device?.DeviceInfo?.SerialNumber?.value || d?.InternetGatewayDevice?.DeviceInfo?.SerialNumber?.value || '-';
      const status = d?._lastInform ? 'online' : 'unknown';
      return `<tr><td class="mono">${esc(d._id)}</td><td>${esc(man)}</td><td>${esc(model)}</td><td class="mono">${esc(ser)}</td><td>${esc(d._lastInform || '-')}</td><td><span class="badge ${status === 'online' ? 'online' : 'unknown'}">${status}</span> <button onclick="refreshDevice('${esc(d._id)}')">Atualizar</button></td></tr>`;
    }).join('') || '<tr><td colspan="6" class="empty">Nenhum CPE encontrado no ACS.</td></tr>';
  } catch (e) { $('acsTable').innerHTML = `<tr><td colspan="6" class="empty">${esc(e.message)}</td></tr>`; }
}
async function refreshDevice(id) {
  try { await api(`/api/acs/devices/${encodeURIComponent(id)}/task`, { method: 'POST', body: JSON.stringify({ task: { name: 'refreshObject', objectName: '' }, connection_request: true }) }); showStatus('Solicitação enviada ao CPE. Aguarde o próximo Inform para atualizar os valores.'); }
  catch (e) { showStatus(e.message, false); }
}
function openModal(html) { $('modalContent').innerHTML = html; $('modal').classList.add('open'); }
function closeModal(e) { if (!e || e.target === $('modal')) $('modal').classList.remove('open'); }
function openEquipmentModal() { openModal(`<h2>Novo equipamento</h2><div class="form"><div class="two"><div><label>Fabricante</label><input id="mMan"></div><div><label>Modelo</label><input id="mModel"></div></div><div class="two"><div><label>Tipo</label><select id="mType"><option>router</option><option>onu</option><option>ont</option></select></div><div><label>Serial</label><input id="mSerial"></div></div><div class="two"><div><label>MAC</label><input id="mMac"></div><div><label>Perfil</label><select id="mProfile"><option value="">Sem perfil</option>${profiles.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div></div><div class="actions"><button onclick="saveEquipment()">Salvar</button><button class="secondary" onclick="closeModal()">Cancelar</button></div></div>`); }
async function saveEquipment() { try { await api('/api/equipment', { method: 'POST', body: JSON.stringify({ manufacturer: $('mMan').value, model: $('mModel').value, equipment_type: $('mType').value, serial_number: $('mSerial').value, mac: $('mMac').value, profile_id: $('mProfile').value || null }) }); closeModal(); showStatus('Equipamento cadastrado.'); await loadAll(); } catch (e) { showStatus(e.message, false); } }
function openProfileModal(p = {}) { openModal(`<h2>${p.id ? 'Editar' : 'Novo'} perfil</h2><div class="form"><div><label>Nome</label><input id="pName" value="${esc(p.name || '')}"></div><div><label>Descrição</label><input id="pDesc" value="${esc(p.description || '')}"></div><div><label>Configuração JSON</label><textarea id="pConfig" rows="16" class="mono">${esc(JSON.stringify(p.config || { parameterValues: [] }, null, 2))}</textarea><div class="hint">Use somente parâmetros efetivamente existentes no firmware.</div></div><div class="actions"><button onclick="saveProfile(${p.id || ''})">Salvar</button><button class="secondary" onclick="closeModal()">Cancelar</button></div></div>`); }
function editProfile(id) { openProfileModal(profiles.find(p => String(p.id) === String(id)) || {}); }
async function saveProfile(id) { try { let config; try { config = JSON.parse($('pConfig').value); } catch { throw new Error('JSON do perfil inválido'); } const body = JSON.stringify({ name: $('pName').value, description: $('pDesc').value, config }); await api(id ? `/api/profiles/${id}` : '/api/profiles', { method: id ? 'PUT' : 'POST', body }); closeModal(); showStatus('Perfil salvo.'); await loadAll(); } catch (e) { showStatus(e.message, false); } }

function equipmentActions(id, acsId) {
  const e = equipment.find(x => String(x.id) === String(id)); if (!e) { showStatus('Equipamento não encontrado na lista.', false); return; }
  const options = profiles.map(p => `<option value="${p.id}" ${String(p.id) === String(e.profile_id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const customerOptions = `<option value="">Sem cliente associado</option>${customers.map(c => `<option value="${c.id}" ${String(c.id) === String(e.customer_id) ? 'selected' : ''}>${esc(c.name)}${c.document ? ` — ${esc(c.document)}` : ''}</option>`).join('')}`;
  const identity = `<div class="device-head"><div><h2 style="margin:0">${esc(e.manufacturer)} ${esc(e.model)}</h2><div class="hint">Serial <span class="mono">${esc(e.serial_number)}</span></div></div><span class="badge ${e.status === 'online' ? 'online' : 'unknown'}">${esc(e.status)}</span></div>`;
  currentDeviceModal = { id, acsId: acsId || '', tab: 'info' };
  openModal(`${identity}<p class="hint">ACS ID: <span class="mono">${esc(acsId || 'não vinculado')}</span></p><div id="deviceOperationalSummary"><div class="card" style="margin-top:10px"><div class="hint">Carregando estado operacional do GenieACS...</div></div></div><div class="device-tabs"><button class="device-tab active" onclick="showDeviceTab('info',this,${id},'${esc(acsId || '')}')">Informações</button><button class="device-tab" onclick="showDeviceTab('params',this,${id},'${esc(acsId || '')}')">Parâmetros</button><button class="device-tab" onclick="showDeviceTab('wifi',this,${id},'${esc(acsId || '')}')">Wi-Fi</button><button class="device-tab" onclick="showDeviceTab('wan',this,${id},'${esc(acsId || '')}')">WAN</button><button class="device-tab" onclick="showDeviceTab('tr069',this,${id},'${esc(acsId || '')}')">TR-069</button><button class="device-tab" onclick="showDeviceTab('provision',this,${id},'${esc(acsId || '')}')">Provisionamento</button><button class="device-tab" onclick="showDeviceTab('lab',this,${id},'${esc(acsId || '')}')">Controle do equipamento</button></div><div id="deviceTabBody"><div class="card"><div class="hint">Carregando dados do equipamento...</div></div></div><div class="device-actions"><div><label>Cliente responsável</label><select id="eCustomer">${customerOptions}</select><div class="hint">Vincula o cadastro e atualiza as ativações antigas ainda sem cliente.</div></div><div><label>Perfil</label><select id="eProfile"><option value="">Sem perfil</option>${options}</select></div><div class="actions" style="grid-column:1/-1"><button onclick="assignCustomer(${id})">Associar cliente</button><button onclick="assignProfile(${id})">Associar perfil</button>${acsId ? `<button class="ok" onclick="applyProfile('${esc(acsId)}')">Aplicar perfil</button><button class="secondary" onclick="refreshDevice('${esc(acsId)}')">Atualizar do CPE</button>` : ''}</div></div>`);
  if (acsId) {
    loadDeviceParameters(id, acsId, 'info');
  } else showDeviceEmpty('Este equipamento não está vinculado a um dispositivo do GenieACS.');
}
async function showDeviceTab(tab, btn, id, acsId) {
  document.querySelectorAll('.device-tab').forEach(x => x.classList.remove('active')); btn?.classList.add('active');
  currentDeviceModal = { id, acsId: acsId || '', tab };
  if (!acsId) { showDeviceEmpty('Este equipamento não está vinculado a um dispositivo do GenieACS.'); return; }
  await loadDeviceParameters(id, acsId, tab);
}
function showDeviceEmpty(msg) { $('deviceTabBody').innerHTML = `<div class="card empty">${esc(msg)}</div>`; }
function valueText(v) { if (v === null || v === undefined || v === '') return '—'; if (typeof v === 'object') return JSON.stringify(v); return String(v); }
function renderDeviceOperationalSummary(d) {
  const host = $('deviceOperationalSummary');
  if (!host) return;
  const values = Array.isArray(d?.values) ? d.values : [];
  const valueOf = (...paths) => {
    for (const path of paths) {
      const row = values.find(x => x?.path === path);
      if (row && row.value !== undefined && row.value !== null) {
        const value = String(row.value).trim();
        if (value !== '') return value;
      }
    }
    return '';
  };
  const findPathValue = predicate => {
    const row = values.find(x => predicate(String(x?.path || '')) && x?.value !== undefined && x?.value !== null && String(x.value).trim() !== '');
    return row ? String(row.value).trim() : '';
  };
  const wanPort = valueOf('Device.Ethernet.Interface.3.Status', 'InternetGatewayDevice.WANDevice.1.WANEthernetInterfaceConfig.Status');
  const wanLink = valueOf('Device.Ethernet.Link.2.Status', 'InternetGatewayDevice.WANDevice.1.WANEthernetInterfaceConfig.LinkStatus');
  const pppStatus = valueOf('Device.PPP.Interface.1.ConnectionStatus', 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ConnectionStatus', 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.2.ConnectionStatus');
  const pppUser = valueOf('Device.PPP.Interface.1.Username', 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username', 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.2.Username');
  let wanIp = valueOf('Device.IP.Interface.5.IPv4Address.1.IPAddress', 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress', 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.2.ExternalIPAddress');
  if (!wanIp) wanIp = findPathValue(path => /WANPPPConnection\.\d+\.ExternalIPAddress$/.test(path));
  if (!wanIp || wanIp === '0.0.0.0' || wanIp.toLowerCase() === 'none') wanIp = 'Sem IP atribuído';
  const lastInform = d?.lastInform || 'Não disponível';
  const informDate = d?.lastInform ? Date.parse(d.lastInform) : NaN;
  const informAgeSeconds = Number.isFinite(informDate) ? Math.max(0, Math.floor((Date.now() - informDate) / 1000)) : null;
  const informState = informAgeSeconds === null ? 'unknown' : informAgeSeconds <= 180 ? 'online' : 'unknown';
  const informAge = informAgeSeconds === null ? 'idade desconhecida' : informAgeSeconds < 60 ? 'há menos de 1 min' : `há ${Math.floor(informAgeSeconds / 60)} min`;
  const linkKnown = Boolean(wanPort || wanLink);
  const linkUp = [wanPort, wanLink].filter(Boolean).every(v => v.toLowerCase() === 'up') && Boolean(wanPort || wanLink);
  const linkPartial = Boolean(wanPort || wanLink) && !linkUp && [wanPort, wanLink].some(v => v.toLowerCase() === 'up') && ![wanPort, wanLink].some(v => v.toLowerCase() === 'down');
  const linkLabel = !linkKnown ? 'Não informado' : linkUp ? 'Ativo (EWAN e link)' : linkPartial ? `Parcial (${wanPort || 'EWAN —'} / ${wanLink || 'link —'})` : `Inativo (${wanPort || 'EWAN —'} / ${wanLink || 'link —'})`;
  const linkClass = linkUp ? 'online' : 'unknown';
  const pppLow = pppStatus.toLowerCase();
  const pppClass = pppLow === 'connected' ? 'online' : 'unknown';
  const pppLabel = pppStatus || 'Não informado';
  const userLabel = pppUser || 'Vazio / não informado';
  const pppIpClass = wanIp === 'Sem IP atribuído' ? 'unknown' : 'online';
  const statCard = (title, main, detail, badgeClass = 'unknown') => `<div class="card" style="padding:12px"><div class="title">${esc(title)}</div><div class="big-value" style="font-size:16px;margin:6px 0;overflow-wrap:anywhere">${esc(main)}</div><span class="badge ${badgeClass}">${esc(detail)}</span></div>`;
  host.innerHTML = `<div class="card" style="margin-top:10px;padding:14px"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><h3 style="margin:0">Estado operacional</h3><div class="hint">Leitura atual do cache do GenieACS; não altera o roteador.</div></div><button type="button" class="secondary" onclick="reloadDeviceRead()">Recarregar leitura</button></div><div class="grid" style="margin-top:12px">${statCard('Link físico WAN', linkLabel, linkUp ? 'Link ativo' : 'Verificar estado', linkClass)}${statCard('Sessão PPPoE', pppLabel, pppLow === 'connected' ? 'Autenticada' : pppLow === 'connecting' ? 'Tentando conectar' : 'Não confirmada', pppClass)}${statCard('IP WAN', wanIp, wanIp === 'Sem IP atribuído' ? 'Sem IPv4 WAN válido' : 'Endereço reportado pelo CPE', pppIpClass)}${statCard('Usuário PPPoE', userLabel, 'Campo reportado pelo CPE', pppUser ? 'online' : 'unknown')}</div><div class="kv" style="margin-top:12px"><span>Último Inform</span><b class="mono" style="text-align:right">${esc(lastInform)} <span class="badge ${informState}">${esc(informAge)}</span></b></div><div class="hint-block">Para pedir uma nova comunicação, use “Atualizar do CPE”. Depois que o CPE enviar outro Inform, clique em “Recarregar leitura” para ler o cache atualizado.</div></div>`;
}
async function reloadDeviceRead() {
  const { id, acsId, tab } = currentDeviceModal;
  if (!acsId) return;
  await loadDeviceParameters(id, acsId, tab || 'info');
  showStatus('Leitura recarregada do cache do GenieACS. Para consultar valores novos, solicite Atualizar do CPE e aguarde o próximo Inform.');
}
function parameterSearchTerms(path) {
  const low = String(path || '').toLowerCase();
  const terms = [String(path || '')];

  // Termos amigáveis para a busca do técnico. O firmware mantém os
  // nomes TR-069 reais, mas a interface também aceita os nomes usados
  // normalmente na operação do provedor.
  if (low.includes('managementserver') || low.includes('connectionrequest') || low.includes('tr069') || low.includes('tr-069') || low.includes('cwmp')) {
    terms.push('ACS', 'TR-069', 'TR069', 'CWMP', 'Gerência ACS', 'Gerenciamento TR-069');
  }
  if (low.includes('pppoe')) {
    terms.push('PPPoE', 'WAN', 'Internet', 'Autenticação');
  }
  if (low.includes('ssid') || low.includes('wifi') || low.includes('wlan') || low.includes('wireless') || low.includes('pre-sharedkey')) {
    terms.push('Wi-Fi', 'WiFi', 'WLAN', 'Wireless', 'SSID');
  }
  if (low.includes('vlan')) {
    terms.push('VLAN', 'WAN', 'Internet');
  }
  if (low.includes('dns')) {
    terms.push('DNS', 'WAN', 'Internet');
  }
  if (low.includes('mtu')) {
    terms.push('MTU', 'WAN', 'Internet');
  }
  if (low.includes('dhcp')) {
    terms.push('DHCP', 'LAN', 'WAN', 'IP');
  }
  if (low.includes('nat')) {
    terms.push('NAT', 'WAN', 'Internet');
  }

  return terms.join(' ');
}

function parameterRows(list) {
  if (!list?.length) return '<div class="empty">Nenhum parâmetro dessa categoria foi coletado ainda.</div>';
  const rows = [...list].sort((a, b) => String(a.path || '').localeCompare(String(b.path || ''))).map(x => {
    const searchText = `${parameterSearchTerms(x.path)} ${valueText(x.value)}`;
    return `<div class="param-row" data-search="${esc(searchText)}"><div class="mono param-path">${esc(x.path)}</div><div class="param-value">${esc(valueText(x.value))}</div></div>`;
  }).join('');
  return `<div class="param-list">${rows}</div>`;
}
function sectionCard(title, list) {
  const count = list?.length || 0;
  return `<div class="card">
    <div class="param-toolbar">
      <div>
        <h3 style="margin:0">${esc(title)}</h3>
        <div class="hint"><span class="param-count">${count}</span> parâmetro(s)</div>
      </div>
      <div class="param-search-wrap">
        <input class="param-search" type="search" placeholder="Pesquisar parâmetro (ex.: PPPoE, SSID, VLAN, DNS, ACS...)" oninput="filterParameterRows(this)" autocomplete="off">
        <button type="button" class="secondary param-clear" onclick="clearParameterFilter(this)">Limpar</button>
      </div>
    </div>
    ${parameterRows(list)}
  </div>`;
}
function filterParameterRows(input) {
  const card = input.closest('.card');
  if (!card) return;
  const term = String(input.value || '').trim().toLowerCase();
  const rows = card.querySelectorAll('.param-row');
  let visible = 0;
  rows.forEach(row => {
    const text = String(row.dataset.search || row.textContent || '').toLowerCase();
    const show = !term || text.includes(term);
    row.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  const count = card.querySelector('.param-count');
  if (count) count.textContent = term ? `${visible}/${rows.length}` : rows.length;
  let empty = card.querySelector('.param-filter-empty');
  if (!visible && rows.length) {
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 'empty param-filter-empty';
      empty.textContent = 'Nenhum parâmetro encontrado para esta pesquisa.';
      card.querySelector('.param-list')?.after(empty);
    }
    empty.style.display = '';
  } else if (empty) {
    empty.style.display = 'none';
  }
}
function clearParameterFilter(button) {
  const card = button.closest('.card');
  const input = card?.querySelector('.param-search');
  if (input) {
    input.value = '';
    filterParameterRows(input);
    input.focus();
  }
}
async function loadDeviceParameters(id, acsId, tab) {
  $('deviceTabBody').innerHTML = '<div class="card"><div class="hint">Consultando GenieACS...</div></div>';
  try {
    const d = await api(`/api/acs/devices/${encodeURIComponent(acsId)}/parameters`);
    renderDeviceOperationalSummary(d);
    if (tab === 'info') {
      const di = d.identity || {};
      $('deviceTabBody').innerHTML = `<div class="grid"><div class="card"><div class="title">Fabricante</div><div class="big-value">${esc(di._Manufacturer || '—')}</div></div><div class="card"><div class="title">Modelo / Product Class</div><div class="big-value">${esc(di._ProductClass || '—')}</div></div><div class="card"><div class="title">Serial</div><div class="big-value mono">${esc(di._SerialNumber || '—')}</div></div><div class="card"><div class="title">OUI</div><div class="big-value mono">${esc(di._OUI || '—')}</div></div></div>${sectionCard('Informações coletadas', d.categories.info)}<div class="card"><div class="kv"><span>Último Inform</span><b class="mono">${esc(d.lastInform || '—')}</b></div><div class="kv"><span>Último boot</span><b class="mono">${esc(d.lastBoot || '—')}</b></div><div class="kv"><span>Parâmetros em cache</span><b>${esc(d.parameterCount)}</b></div></div>`;
    } else if (tab === 'wifi') $('deviceTabBody').innerHTML = `${sectionCard('Wi-Fi / WLAN', d.categories.wifi)}<div class="hint-block">Os parâmetros exibidos são somente os que o GenieACS já possui em cache para este CPE.</div>`;
    else if (tab === 'wan') $('deviceTabBody').innerHTML = `${sectionCard('WAN / Internet / VLAN / IP', d.categories.wan)}<div class="hint-block">Os parâmetros exibidos são somente os que o GenieACS já possui em cache para este CPE.</div>`;
    else if (tab === 'tr069') $('deviceTabBody').innerHTML = `${sectionCard('Gerência TR-069 / ManagementServer', d.categories.tr069)}<div class="hint-block">Use estes nomes exatos ao montar perfis de provisionamento para o modelo.</div>`;
    else if (tab === 'provision') renderProvisionForm(d.values || [], acsId);
    else if (tab === 'lab') await renderMr60xLab(acsId);
    else $('deviceTabBody').innerHTML = `${sectionCard('Todos os parâmetros coletados', d.values)}`;
  } catch (e) { $('deviceTabBody').innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
}
function findParameterPath(values, exactPaths, needles = []) {
  const byPath = new Set((values || []).map(x => String(x.path || '')));
  for (const path of exactPaths || []) if (byPath.has(path)) return path;
  const arr = (values || []).map(x => String(x.path || ''));
  for (const needle of needles) {
    const found = arr.find(p => p.toLowerCase().includes(String(needle).toLowerCase()));
    if (found) return found;
  }
  return '';
}
function renderProvisionForm(values, acsId) {
  currentProvisionValues = Array.isArray(values) ? values : [];
  const getValue = (path) => {
    const item = currentProvisionValues.find(x => x.path === path);
    return item && item.value !== undefined && item.value !== null ? String(item.value) : '';
  };
  const field = (id, label, val, ph) => `<div><label for="prov_${id}">${esc(label)}</label><input id="prov_${id}" value="${esc(val)}" placeholder="${esc(ph)}" ${id.endsWith('Pass') ? 'type="password" autocomplete="new-password"' : ''}></div>`;
  const fields = [
    field('pppoeUser', 'Usuário PPPoE', getValue('Device.PPP.Interface.1.Username'), 'Usuário de teste criado no MikroTik'),
    field('pppoePass', 'Senha PPPoE', '', 'Senha do usuário PPPoE de teste'),
    field('ssid24', 'Nome do Wi-Fi 2,4 GHz', getValue('Device.WiFi.SSID.1.SSID'), 'Ex.: RFN_LAB_24'),
    field('ssid5', 'Nome do Wi-Fi 5 GHz', getValue('Device.WiFi.SSID.3.SSID'), 'Ex.: RFN_LAB_5G'),
    field('wifiPass', 'Senha do Wi-Fi', '', '8 a 63 caracteres; será usada nas duas bandas')
  ];
  const valText = path => {
    const value = getValue(path);
    return value || 'não informado';
  };
  const wanPort = valText('Device.Ethernet.Interface.3.Status');
  const wanLink = valText('Device.Ethernet.Link.2.Status');
  const pppStatus = valText('Device.PPP.Interface.1.ConnectionStatus');
  const band5Enabled = getValue('Device.WiFi.Radio.2.Enable').toLowerCase() === 'true'
    && getValue('Device.WiFi.SSID.3.Enable').toLowerCase() === 'true'
    && getValue('Device.WiFi.AccessPoint.3.Enable').toLowerCase() === 'true';
  const physicalUp = wanPort.toLowerCase() === 'up' && wanLink.toLowerCase() === 'up';
  const health = `<div class="kv"><span>Porta WAN (EWAN)</span><b>${esc(wanPort)}</b></div>
    <div class="kv"><span>Link Ethernet WAN</span><b>${esc(wanLink)}</b></div>
    <div class="kv"><span>Estado PPPoE atual</span><b>${esc(pppStatus)}</b></div>
    <div class="kv"><span>Rádio / SSID / AP 5 GHz</span><b>${band5Enabled ? 'Habilitados' : 'Há componente desabilitado'}</b></div>`;
  const wanWarning = physicalUp ? '' : `<div class="hint-block" style="border-left:4px solid #c88619;padding-left:10px"><b>Atenção:</b> o cache do ACS informa a WAN como não conectada fisicamente (EWAN: ${esc(wanPort)}; Link 2: ${esc(wanLink)}). Confirme o cabo entre o MikroTik e a porta WAN. A tarefa pode ser enviada pelo canal de gerenciamento, mas o PPPoE não conectará enquanto o link físico estiver inativo.</div>`;
  $('deviceTabBody').innerHTML = `<div class="card">
    <h3 style="margin-top:0">Provisionamento — perfil RESIDENCIAL</h3>
    <p class="hint">Selecione a etapa correta. O modo laboratório mantém o equipamento em teste; a ativação do cliente substitui a credencial PPPoE atual pela definitiva e aplica os nomes/senha Wi-Fi informados.</p>
    <div class="card" style="margin:10px 0">${health}</div>
    ${wanWarning}
    <div style="margin:12px 0">
      <label for="prov_operationMode">Etapa do provisionamento</label>
      <select id="prov_operationMode" onchange="updateProvisioningMode()" style="width:100%">
        <option value="lab">Laboratório / manutenção</option>
        <option value="customer">Ativação de cliente final</option>
      </select>
    </div>
    <div id="provModeHint" class="hint-block">Modo laboratório: use apenas uma conta PPPoE de teste criada no MikroTik. Não informe credenciais de cliente real.</div>
    <div id="customerActivationReadiness" class="card" style="display:none;margin:10px 0"></div>
    <div class="two">${fields.join('')}</div>
    <div id="customerActivationConfirmWrap" class="hint-block" style="display:none;border-left:4px solid #c88619">
      <label style="display:flex;align-items:flex-start;gap:8px;color:var(--text);font-size:13px">
        <input id="confirmCustomerPppoe" type="checkbox" style="width:auto;flex:0 0 auto;margin-top:3px">
        <span>Confirmo que o usuário PPPoE definitivo já foi criado/validado no MikroTik, que os dados inseridos são os do cliente correto e que autorizo substituir a credencial temporária. Sei que uma credencial errada pode interromper a Internet.</span>
      </label>
    </div>
    <div class="actions" style="margin-top:14px"><button class="secondary" onclick="previewProvisioning()">Pré-visualizar alterações</button><button id="sendProvisioningButton" class="ok" onclick="sendProvisioning('${esc(acsId)}')">Enviar configuração de laboratório</button></div>
    <div id="provisionPreview" class="hint-block" style="display:none;margin-top:12px"></div>
    <div class="hint-block">O RFN mantém um histórico operacional sem gravar as senhas PPPoE/Wi-Fi. “Confirmado” significa que os valores não secretos esperados foram encontrados no cache após um Inform posterior; o estado da sessão PPPoE aparece separadamente.</div>
    <div id="provisioningHistory" style="margin-top:12px"><div class="card"><div class="hint">Carregando histórico de ativações...</div></div></div>
  </div>`;
  const usernameInput = $('prov_pppoeUser');
  if (usernameInput) usernameInput.dataset.labUsername = getValue('Device.PPP.Interface.1.Username');
  updateProvisioningMode();
  loadProvisioningHistory(acsId);
}

function updateProvisioningMode() {
  const mode = $('prov_operationMode')?.value || 'lab';
  const hint = $('provModeHint');
  const confirmWrap = $('customerActivationConfirmWrap');
  const confirm = $('confirmCustomerPppoe');
  const button = $('sendProvisioningButton');
  const userInput = $('prov_pppoeUser');
  const passInput = $('prov_pppoePass');
  const wifi24 = $('prov_ssid24');
  const wifi5 = $('prov_ssid5');
  const wifiPass = $('prov_wifiPass');
  const linkedEquipment = equipment.find(x => String(x.acs_device_id || '') === String(currentDeviceModal.acsId || ''));
  const linkedCustomer = linkedEquipment ? customers.find(c => String(c.id) === String(linkedEquipment.customer_id)) : null;
  const customerUser = String(linkedCustomer?.pppoe_username || '').trim();
  const readiness = $('customerActivationReadiness');
  if (readiness) {
    if (mode !== 'customer') {
      readiness.style.display = 'none';
      readiness.innerHTML = '';
    } else {
      readiness.style.display = 'block';
      const checks = [
        { label: 'Equipamento associado a cliente', ok: !!linkedCustomer, detail: linkedCustomer?.name || 'Nenhum cliente associado' },
        { label: 'Usuário PPPoE registrado no cliente', ok: !!customerUser, detail: customerUser || 'Não cadastrado; edite o cliente na aba Clientes' },
        { label: 'Perfil residencial associado', ok: linkedEquipment?.profile_name === 'RESIDENCIAL', detail: linkedEquipment?.profile_name || 'Sem perfil associado' }
      ];
      readiness.innerHTML = `<h4 style="margin:0 0 8px">Pré-checagem da ativação do cliente</h4>${checks.map(c => `<div class="kv"><span>${c.ok ? '✓' : '⚠'} ${esc(c.label)}</span><b style="text-align:right;max-width:60%;overflow-wrap:anywhere">${esc(c.detail)}</b></div>`).join('')}<p class="hint">A ativação definitiva só será liberada quando os pré-requisitos forem válidos e o usuário digitado coincidir com o cadastro. A senha PPPoE não é salva no cadastro.</p>`;
    }
  }
  if (mode === 'customer' && customerUser && userInput && userInput.dataset.provisionMode !== 'customer') {
    userInput.value = customerUser;
  } else if (mode === 'lab' && userInput?.dataset.provisionMode === 'customer') {
    userInput.value = userInput.dataset.labUsername || userInput.value;
  }
  if (userInput) userInput.dataset.provisionMode = mode;
  if (mode === 'customer') {
    if (hint) {
      hint.style.borderLeft = '4px solid #c88619';
      hint.innerHTML = '<b>Ativação de cliente final:</b> substitui o PPPoE atual e aplica os nomes e a senha Wi-Fi informados. Primeiro confira no MikroTik se o usuário definitivo já existe e pertence a este cliente. Não altere VLAN ou parâmetros ACS nesta etapa.';
    }
    if (confirmWrap) confirmWrap.style.display = 'block';
    if (button) button.textContent = 'Ativar cliente / trocar PPPoE';
    if (userInput) userInput.placeholder = 'Usuário PPPoE definitivo deste cliente';
    if (passInput) passInput.placeholder = 'Senha PPPoE definitiva do cliente';
    if (wifi24) wifi24.placeholder = 'SSID residencial 2,4 GHz';
    if (wifi5) wifi5.placeholder = 'SSID residencial 5 GHz';
    if (wifiPass) wifiPass.placeholder = 'Senha Wi-Fi definida para o cliente';
  } else {
    if (hint) {
      hint.style.borderLeft = '';
      hint.innerHTML = 'Modo laboratório: use apenas uma conta PPPoE de teste criada no MikroTik. Não informe credenciais de cliente real.';
    }
    if (confirmWrap) confirmWrap.style.display = 'none';
    if (confirm) confirm.checked = false;
    if (button) button.textContent = 'Enviar configuração de laboratório';
    if (userInput) userInput.placeholder = 'Usuário PPPoE de teste do MikroTik';
    if (passInput) passInput.placeholder = 'Senha PPPoE de teste';
    if (wifi24) wifi24.placeholder = 'Ex.: RFN_LAB_24';
    if (wifi5) wifi5.placeholder = 'Ex.: RFN_LAB_5G';
    if (wifiPass) wifiPass.placeholder = '8 a 63 caracteres; será usada nas duas bandas';
  }
}

function buildProvisioningParameterValues() {
  const pppoeUser = $('prov_pppoeUser')?.value.trim();
  const pppoePass = $('prov_pppoePass')?.value;
  const ssid24 = $('prov_ssid24')?.value.trim();
  const ssid5 = $('prov_ssid5')?.value.trim();
  const wifiPass = $('prov_wifiPass')?.value;
  if (!pppoeUser || !pppoePass || !ssid24 || !ssid5 || !wifiPass) {
    throw new Error('Preencha usuário e senha PPPoE, os dois nomes de Wi-Fi e a senha Wi-Fi.');
  }
  if (ssid24.length > 32 || ssid5.length > 32) throw new Error('Cada nome de Wi-Fi deve ter no máximo 32 caracteres.');
  if (wifiPass.length < 8 || wifiPass.length > 63) throw new Error('A senha Wi-Fi precisa ter entre 8 e 63 caracteres.');
  return [
    ['Device.PPP.Interface.1.Enable', true],
    ['Device.PPP.Interface.1.ConnectionTrigger', 'AlwaysOn'],
    ['Device.PPP.Interface.1.Username', pppoeUser],
    ['Device.PPP.Interface.1.Password', pppoePass],
    ['Device.PPP.Interface.1.MaxMRUSize', 1492],
    ['Device.WiFi.Radio.1.Enable', true],
    ['Device.WiFi.SSID.1.Enable', true],
    ['Device.WiFi.AccessPoint.1.Enable', true],
    ['Device.WiFi.SSID.1.SSID', ssid24],
    ['Device.WiFi.AccessPoint.1.Security.PreSharedKey', wifiPass],
    ['Device.WiFi.Radio.2.Enable', true],
    ['Device.WiFi.SSID.3.Enable', true],
    ['Device.WiFi.AccessPoint.3.Enable', true],
    ['Device.WiFi.SSID.3.SSID', ssid5],
    ['Device.WiFi.AccessPoint.3.Security.PreSharedKey', wifiPass]
  ];
}

function previewProvisioning() {
  const target = $('provisionPreview');
  if (!target) return;
  let parameterValues;
  try { parameterValues = buildProvisioningParameterValues(); }
  catch (e) { showStatus(e.message, false); return; }
  const sensitive = path => /\.Password$|PreSharedKey|Passphrase|Secret/i.test(path);
  const rows = parameterValues.map(([path, value]) => {
    const current = currentProvisionValues.find(x => x.path === path);
    const writable = !!current && current.writable === true;
    const displayValue = sensitive(path) ? '•••••••• (oculto)' : String(value);
    const currentValue = !current ? 'ausente no cache' : current.sensitive ? '•••••••• (oculto)' : String(current.value ?? '—');
    return `<tr><td class="mono">${esc(path)}</td><td>${esc(currentValue)}</td><td>${esc(displayValue)}</td><td>${writable ? 'Sim' : 'Não / não confirmado'}</td></tr>`;
  }).join('');
  const noWrite = parameterValues.filter(([path]) => {
    const p = currentProvisionValues.find(x => x.path === path);
    return !p || p.writable !== true;
  });
  const mode = $('prov_operationMode')?.value || 'lab';
  const modeLabel = mode === 'customer' ? 'Ativação do cliente final' : 'Laboratório / manutenção';
  const modeNote = mode === 'customer'
    ? 'Prévia da ativação final. Confira o usuário PPPoE proposto e confirme que essa conta já existe no MikroTik para o cliente correto. Uma credencial errada pode interromper o serviço.'
    : 'Prévia de laboratório. Use somente credenciais temporárias de teste.';
  target.style.display = 'block';
  target.innerHTML = `<h4 style="margin:0 0 8px">${esc(modeLabel)} — ${parameterValues.length} parâmetros</h4><p class="hint">Nenhuma alteração foi enviada. ${esc(modeNote)} VLAN, endereço LAN e parâmetros ACS permanecem fora do plano.</p><div style="overflow:auto"><table><thead><tr><th>Parâmetro</th><th>Atual</th><th>Proposto</th><th>Gravável?</th></tr></thead><tbody>${rows}</tbody></table></div>${noWrite.length ? `<p style="color:#b45309"><b>Envio bloqueado por segurança:</b> ${noWrite.length} parâmetro(s) não aparecem como graváveis no cache atual. Atualize os dados do CPE ou valide os caminhos para este firmware antes de enviar.</p>` : '<p>Todos os caminhos do plano constam como graváveis no cache atual. Revise os valores antes de enviar.</p>'}`;
}

async function sendProvisioning(acsId) {
  const mode = $('prov_operationMode')?.value || 'lab';
  let parameterValues;
  try { parameterValues = buildProvisioningParameterValues(); }
  catch (e) { showStatus(e.message, false); return; }
  if (mode === 'customer' && !$('confirmCustomerPppoe')?.checked) {
    showStatus('Marque a confirmação de ativação somente após validar o PPPoE definitivo no MikroTik.', false);
    return;
  }
  const proposedUser = String(parameterValues.find(([path]) => path === 'Device.PPP.Interface.1.Username')?.[1] ?? '').trim();
  const currentUser = String(currentProvisionValues.find(x => x.path === 'Device.PPP.Interface.1.Username')?.value ?? '').trim();
  if (mode === 'customer') {
    const linkedEquipment = equipment.find(x => String(x.acs_device_id || '') === String(acsId));
    const linkedCustomer = linkedEquipment ? customers.find(c => String(c.id) === String(linkedEquipment.customer_id)) : null;
    const expectedUser = String(linkedCustomer?.pppoe_username || '').trim();
    if (!linkedEquipment || !linkedCustomer) {
      showStatus('Ativação bloqueada: associe um cliente cadastrado ao equipamento em Equipamentos → Abrir.', false);
      return;
    }
    if (linkedEquipment.profile_name !== 'RESIDENCIAL') {
      showStatus('Ativação bloqueada: associe o perfil RESIDENCIAL ao equipamento antes de ativar.', false);
      return;
    }
    if (!expectedUser) {
      showStatus('Ativação bloqueada: abra Clientes → Editar dados / PPPoE e cadastre o usuário PPPoE do cliente (não a senha).', false);
      return;
    }
    if (proposedUser !== expectedUser) {
      showStatus('Ativação bloqueada: o usuário PPPoE digitado não coincide com o usuário cadastrado para este cliente.', false);
      return;
    }
  }
  if (mode === 'customer' && proposedUser && currentUser && proposedUser === currentUser) {
    const proceedSameUser = window.confirm(`O usuário PPPoE proposto (${proposedUser}) é igual ao que o CPE já informa. Se a intenção é substituir a conta temporária, volte e informe o usuário definitivo. Deseja prosseguir mesmo assim?`);
    if (!proceedSameUser) return;
  }
  const unsupported = parameterValues.filter(([path]) => {
    const p = currentProvisionValues.find(x => x.path === path);
    return !p || p.writable !== true;
  }).map(([path]) => path);
  if (unsupported.length) {
    showStatus(`Envio bloqueado: ${unsupported.length} parâmetro(s) ausente(s) ou sem confirmação de escrita. Clique em Pré-visualizar alterações para ver quais.`, false);
    previewProvisioning();
    return;
  }
  const current = path => currentProvisionValues.find(x => x.path === path)?.value;
  const wanPort = String(current('Device.Ethernet.Interface.3.Status') ?? '').toLowerCase();
  const wanLink = String(current('Device.Ethernet.Link.2.Status') ?? '').toLowerCase();
  if (wanPort !== 'up' || wanLink !== 'up') {
    const proceed = window.confirm('O cache atual informa o link WAN como DOWN. Você pode enviar as configurações pelo gerenciamento, mas o PPPoE não conectará enquanto o cabo/link físico estiver inativo. Deseja enfileirar a tarefa mesmo assim?');
    if (!proceed) return;
  }
  if (mode === 'customer') {
    const accepted = window.confirm(
      `CONFIRMAR ATIVAÇÃO DO CLIENTE\n\nPPPoE atual: ${currentUser || 'não informado'}\nPPPoE proposto: ${proposedUser || 'não informado'}\n\nA tarefa trocará as credenciais PPPoE e aplicará os valores Wi-Fi informados. Confirme que o usuário/senha já estão cadastrados no MikroTik e pertencem ao cliente correto. Uma credencial inválida pode interromper a Internet. VLAN, LAN e parâmetros ACS não serão alterados.\n\nEnviar agora?`
    );
    if (!accepted) return;
  }
  const resultPreview = $('provisionPreview');
  if (resultPreview) resultPreview.style.display = 'none';
  try {
    const result = await api(`/api/acs/devices/${encodeURIComponent(acsId)}/provision`, {
      method: 'POST', body: JSON.stringify({
        parameterValues,
        operationMode: mode,
        confirmCustomerPppoe: mode === 'customer' && $('confirmCustomerPppoe')?.checked === true
      })
    });
    const operationNumber = result.operationId ? ` Registro #${result.operationId}.` : '';
    showStatus(`${mode === 'customer' ? 'Ativação' : 'Tarefa de laboratório'} aceita pelo GenieACS; aguardando confirmação pelo CPE.${operationNumber}`);
    await loadProvisioningHistory(acsId);
  } catch (e) { showStatus(e.message, false); }
}

const activationStatusLabel = status => ({
  submitting: 'Enviando', queued: 'Aguardando Inform', confirmed: 'Configuração confirmada',
  partial: 'Valores divergentes', needs_review: 'Revisar tarefa', failed: 'Falha no envio'
}[String(status || '')] || String(status || 'desconhecido'));

async function loadProvisioningHistory(acsId) {
  const host = $('provisioningHistory');
  if (!host || !acsId) return;
  host.innerHTML = '<div class="card"><div class="hint">Consultando histórico...</div></div>';
  try {
    const data = await api(`/api/acs/devices/${encodeURIComponent(acsId)}/activations`);
    const current = data.current || {};
    const ops = Array.isArray(data.operations) ? data.operations : [];
    const ppp = String(current.pppoeStatus || 'Não informado');
    const pppConnected = ppp.toLowerCase() === 'connected';
    const summaryCard = (title, main, detail, badgeClass = 'unknown') => `<div class="card" style="padding:12px"><div class="title">${esc(title)}</div><div class="big-value" style="font-size:15px;margin:6px 0;overflow-wrap:anywhere">${esc(main)}</div><span class="badge ${badgeClass}">${esc(detail)}</span></div>`;
    const currentSummary = `<div class="card" style="padding:12px;margin-bottom:10px"><div class="title">Estado atual observado pelo GenieACS</div><p class="hint">Leitura atual do cache do CPE. Os registros abaixo preservam o estado observado em cada operação e podem ter valores diferentes.</p><div class="grid" style="margin-top:8px">${summaryCard('PPPoE', ppp, pppConnected ? 'Autenticada' : 'Não conectada/confirmada', pppConnected ? 'online' : 'unknown')}${summaryCard('Usuário', current.pppoeUsername || '—', 'Reportado pelo CPE agora', current.pppoeUsername ? 'online' : 'unknown')}${summaryCard('IP WAN', current.wanIp || 'Sem IP atribuído', 'Reportado pelo CPE agora', current.wanIp ? 'online' : 'unknown')}${summaryCard('Último Inform', current.lastInform || '—', 'Último contato conhecido do CPE', current.lastInform ? 'online' : 'unknown')}</div></div>`;
    const rows = ops.map(op => {
      const status = String(op.status || 'unknown');
      const badge = status === 'confirmed' ? 'online' : status === 'failed' || status === 'partial' || status === 'needs_review' ? 'unknown' : 'unknown';
      const summary = op.observed_summary && typeof op.observed_summary === 'object' ? op.observed_summary : {};
      const observed = [summary.pppoeStatus ? `PPPoE: ${summary.pppoeStatus}` : '', summary.wanIp ? `IP: ${summary.wanIp}` : '', summary.lastInform ? `Inform da operação: ${summary.lastInform}` : ''].filter(Boolean).join(' · ') || 'Aguardando leitura do CPE';
      const mode = op.operation_mode === 'customer' ? 'Cliente final' : 'Laboratório';
      const profileLabel = op.profile_name || 'RESIDENCIAL';
      const customerLabel = op.customer_name || (op.customer_id ? `Cliente #${op.customer_id}` : 'Cliente não associado');
      const created = op.created_at ? new Date(op.created_at).toLocaleString('pt-BR') : '—';
      const requestedBy = op.requested_by_email ? `<div class="hint">Operador: ${esc(op.requested_by_email)}</div>` : '';
      return `<tr><td>#${esc(op.id)}</td><td>${esc(mode)}<div class="hint">Perfil: ${esc(profileLabel)}</div><div class="hint">${esc(customerLabel)}</div><div class="hint mono">PPPoE: ${esc(op.pppoe_username || '—')}</div></td><td><span class="badge ${badge}">${esc(activationStatusLabel(status))}</span><div class="hint">${esc(op.status_note || '')}</div></td><td>${esc(observed)}</td><td>${esc(created)}${requestedBy}</td></tr>`;
    }).join('') || '<tr><td colspan="5" class="empty">Nenhuma ativação registrada para este equipamento.</td></tr>';
    host.innerHTML = `${currentSummary}<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h3 style="margin:0">Histórico de provisionamento</h3><button type="button" class="secondary" onclick="loadProvisioningHistory('${esc(acsId)}')">Atualizar histórico</button></div><p class="hint">Senhas não são salvas. A leitura atual fica separada do histórico: o Inform em cada registro é o snapshot associado àquela operação, não necessariamente o último Inform atual. Configuração confirmada e conectividade PPPoE são estados separados.</p><div class="table-wrap"><table><thead><tr><th>Registro</th><th>Operação / PPPoE</th><th>Resultado</th><th>Estado observado na operação</th><th>Data</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  } catch (e) {
    host.innerHTML = `<div class="card"><h3>Histórico de provisionamento</h3><p class="hint">${esc(e.message || 'Não foi possível consultar o histórico.')}</p><button class="secondary" onclick="loadProvisioningHistory('${esc(acsId)}')">Tentar novamente</button></div>`;
  }
}
async function assignCustomer(id) {
  try {
    const value = $('eCustomer')?.value || null;
    if (value && !customers.some(c => String(c.id) === String(value))) throw new Error('Selecione um cliente cadastrado.');
    await api(`/api/equipment/${id}`, { method: 'PATCH', body: JSON.stringify({ customer_id: value ? Number(value) : null }) });
    closeModal(); await loadAll();
    showStatus(value ? 'Cliente associado ao equipamento; histórico sem vínculo atualizado.' : 'Associação de cliente removida do equipamento.');
  } catch (e) { showStatus(e.message, false); }
}
async function assignProfile(id) { try { await api(`/api/equipment/${id}`, { method: 'PATCH', body: JSON.stringify({ profile_id: $('eProfile').value || null }) }); closeModal(); showStatus('Perfil associado.'); await loadAll(); } catch (e) { showStatus(e.message, false); } }
async function applyProfile(acsId) { try { const e = equipment.find(x => x.acs_device_id === acsId); if (!e?.profile_id) throw new Error('Associe um perfil antes de aplicar.'); await api(`/api/acs/devices/${encodeURIComponent(acsId)}/apply-profile`, { method: 'POST', body: JSON.stringify({ profile_id: e.profile_id }) }); showStatus('Perfil enviado ao GenieACS/CPE.'); } catch (e) { showStatus(e.message, false); } }
async function renderMr60xLab(acsId) {
  $('deviceTabBody').innerHTML = '<div class="card"><div class="hint">Consultando catálogo de controle do MR60X...</div></div>';
  try {
    const d = await api(`/api/acs/devices/${encodeURIComponent(acsId)}/lab`);
    const badge = d.supported ? '<span class="badge online">Catálogo MR60X ativo</span>' : '<span class="badge unknown">Modelo sem catálogo</span>';
    const conn = d.connection?.state === 'online' ? '<span class="badge online">CPE online</span>' : '<span class="badge unknown">Sem Inform recente</span>';
    const categories = [...new Set((d.candidates || []).map(c => c.category))];
    const categoryFilter = `<select id="labCategoryFilter" onchange="filterLabParameters()" style="max-width:260px"><option value="">Todas as categorias</option>${categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>`;
    const candidates = (d.candidates || []).map(c => {
      const fieldId = `labValue_${c.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
      const value = c.sensitive ? '' : (c.discovered ? String(c.value ?? '') : '');
      const currentLabel = c.sensitive ? (c.discovered ? '•••••••• (valor oculto)' : 'não observado') : (c.discovered ? esc(c.value ?? '—') : 'não observado');
      const writableLabel = c.discovered ? (c.writable ? 'gravável' : 'somente leitura no firmware') : 'não observado no cache';
      const disabled = !(c.discovered && c.writable);
      let input;
      if (c.discovered && c.writable && c.type === 'xsd:boolean') {
        const boolValue = String(c.value).toLowerCase() === 'true';
        input = `<select id="${fieldId}" data-lab-kind="boolean" ${disabled ? 'disabled' : ''}><option value="true" ${boolValue ? 'selected' : ''}>Habilitado (true)</option><option value="false" ${!boolValue ? 'selected' : ''}>Desabilitado (false)</option></select>`;
      } else if (c.discovered && c.writable && Array.isArray(c.options) && c.options.length) {
        const opts = c.options.map(o => `<option value="${esc(o)}" ${String(o) === String(c.value) ? 'selected' : ''}>${esc(o)}</option>`).join('');
        const current = !c.sensitive && !c.options.map(String).includes(String(c.value)) ? `<option value="${esc(c.value)}" selected>${esc(c.value)}</option>` : '';
        input = `<select id="${fieldId}" data-lab-kind="string">${opts}${current}</select>`;
      } else {
        const numeric = c.discovered && c.writable && /xsd:(unsignedInt|int|short|unsignedShort|byte|unsignedByte)$/.test(c.type || '');
        const type = c.sensitive ? 'password' : numeric ? 'number' : 'text';
        const placeholder = c.sensitive ? 'Digite o novo valor (não exibido)' : disabled ? 'Parâmetro indisponível para gravação' : 'Novo valor';
        input = `<input id="${fieldId}" type="${type}" data-lab-kind="${numeric ? 'number' : 'string'}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${disabled ? 'disabled' : ''} autocomplete="${c.sensitive ? 'new-password' : 'off'}">`;
      }
      const read = c.discovered ? `<button type="button" class="secondary" onclick="labRead('${esc(acsId)}','${esc(c.path)}')">Ler</button>` : '';
      const probe = c.safeProbe && c.discovered && c.writable ? `<button type="button" class="secondary" onclick="labWriteProbe('${esc(acsId)}','${esc(c.path)}')">Reenviar valor atual</button>` : '';
      const apply = !disabled ? `<button type="button" class="ok" onclick="labApplyParameter('${esc(acsId)}','${esc(c.id)}','${esc(c.path)}','${esc(c.label)}','${esc(c.category)}','${esc(fieldId)}',${c.critical ? 'true' : 'false'},${c.sensitive ? 'true' : 'false'})">Aplicar</button>` : '';
      const search = `${c.category} ${c.label} ${c.path}`.toLowerCase();
      return `<div class="card lab-control-item" data-lab-search="${esc(search)}" data-lab-category="${esc(c.category)}" style="padding:12px;margin:0"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"><div style="min-width:240px;flex:1"><b>${esc(c.label)}</b><div class="hint mono" style="overflow-wrap:anywhere">${esc(c.path)}</div><div class="hint">${esc(c.category)} · ${writableLabel} · tipo ${esc(c.type || '—')}</div><div class="hint">Valor atual: ${currentLabel}</div></div><div style="min-width:min(360px,100%);flex:1;display:flex;flex-direction:column;gap:8px">${input}<div class="actions">${read}${probe}${apply}</div></div></div></div>`;
    }).join('');
    const runs = (d.runs || []).map(r => {
      const badge = ['executed', 'confirmed'].includes(r.status) ? 'online' : 'unknown';
      const typeLabel = r.test_type === 'write' ? 'Alteração' : r.test_type === 'reboot' ? 'Reinicialização' : r.test_type === 'factory-reset' ? 'Reset de fábrica' : r.test_type === 'write-probe' ? 'Teste de gravação' : r.test_type;
      const interpretation = r.test_type === 'write' && r.status === 'executed' && r.observed_value === '[redacted]'
        ? 'Inform observado; valor secreto não pode ser lido de volta' : (r.interpretation || (r.test_type === 'reboot' ? 'Solicitação de reinicialização' : r.test_type === 'factory-reset' ? 'Reset de fábrica: o CPE pode perder a configuração ACS e não voltar a comunicar automaticamente' : ''));
      return `<tr><td>${esc(r.id)}</td><td>${esc(typeLabel)}</td><td class="mono">${esc(r.parameter_path || '—')}</td><td><span class="badge ${badge}">${esc(r.status)}</span></td><td>${esc(interpretation)}</td><td class="mono">${esc(r.created_at)}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="empty">Nenhuma operação registrada.</td></tr>';
    $('deviceTabBody').innerHTML = `<div class="card"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><div><h3 style="margin:0">Controle avançado do equipamento — MR60X</h3><p class="hint">Personalização via GenieACS com catálogo de parâmetros reconhecidos deste modelo. Só permite gravar um parâmetro se o próprio CPE o reportar como gravável.</p></div><div class="actions"><button class="secondary" onclick="labReboot('${esc(acsId)}')">Reiniciar roteador</button><button class="danger" onclick="labFactoryReset('${esc(acsId)}','${esc(d.serialNumber || '')}')">Reset de fábrica</button><button onclick="labRefresh('${esc(acsId)}')">Atualizar parâmetros</button><button class="secondary" onclick="renderMr60xLab('${esc(acsId)}')">Recarregar tela</button></div></div><div class="hint-block">${badge} ${conn} · Último Inform: <span class="mono">${esc(d.lastInform || '—')}</span></div><div class="hint-block" style="border-left:4px solid #c88619;margin-top:10px">Atenção: alterar PPPoE, IP LAN/DHCP, VLAN ou TR-069 pode interromper o acesso. Senhas não são exibidas nem gravadas no histórico. Reset de fábrica apaga configurações do roteador e pode remover o vínculo com o ACS; só use após preparar recuperação local/ISP Preset. Para reset persistente com logo e padrões RFN, use o recurso oficial ISP Preset/Agile Config compatível com a revisão.</div><div class="two" style="margin-top:12px;align-items:end"><div><label for="labParamSearch">Buscar parâmetro</label><input id="labParamSearch" placeholder="Ex.: SSID, VLAN, DHCP, ACS" oninput="filterLabParameters()"></div><div><label for="labCategoryFilter">Categoria</label>${categoryFilter}</div></div><div id="labAdvancedParams" class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:10px;margin-top:12px">${candidates || '<div class="empty">Este modelo não possui catálogo habilitado.</div>'}</div></div><div class="card" style="margin-top:12px"><h3 style="margin-top:0">Histórico de operações do equipamento</h3><div class="table-wrap"><table><thead><tr><th>ID</th><th>Operação</th><th>Parâmetro</th><th>Status</th><th>Interpretação</th><th>Data</th></tr></thead><tbody>${runs}</tbody></table></div><p class="hint">“Confirmado” significa que o valor não secreto foi observado após Inform. Para senhas, o RFN não tenta ler nem armazenar o segredo de volta. “queued” significa que a tarefa foi enfileirada e depende de nova comunicação do CPE.</p></div>`;
    filterLabParameters();
  } catch (e) { $('deviceTabBody').innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
}
function filterLabParameters() {
  const q = String($('labParamSearch')?.value || '').trim().toLowerCase();
  const category = String($('labCategoryFilter')?.value || '');
  document.querySelectorAll('[data-lab-search]').forEach(item => {
    const textMatch = !q || String(item.dataset.labSearch || '').includes(q);
    const categoryMatch = !category || item.dataset.labCategory === category;
    item.style.display = textMatch && categoryMatch ? '' : 'none';
  });
}
async function labApplyParameter(acsId, candidateId, pathValue, label, category, fieldId, critical, sensitive) {
  const input = document.getElementById(fieldId);
  if (!input) return;
  let value = input.value;
  if (input.dataset.labKind === 'boolean') value = value === 'true';
  else if (input.dataset.labKind === 'number') {
    if (value.trim() === '' || !Number.isSafeInteger(Number(value))) { showStatus('Informe um número inteiro válido.', false); return; }
    value = Number(value);
  }
  if (sensitive && (typeof value !== 'string' || value.length === 0)) { showStatus('Digite o novo segredo antes de aplicar. O valor atual não é exibido.', false); return; }
  const warning = critical
    ? `A alteração de “${label}” pode interromper internet, DHCP, rede local ou acesso remoto ao GenieACS.\n\nConfirme que este CPE é o correto e que você tem forma de recuperar o acesso.\n\nAplicar agora?`
    : `Aplicar “${label}” no MR60X? A alteração pode desconectar aparelhos conectados ao Wi-Fi.`;
  if (!window.confirm(warning)) return;
  try {
    const r = await api(`/api/acs/devices/${encodeURIComponent(acsId)}/lab/write`, { method: 'POST', body: JSON.stringify({ path: pathValue, value, confirmCritical: critical ? true : undefined }) });
    const status = r.status === 'executed' ? 'aceita/executada pelo ACS' : 'enfileirada para o próximo contato do CPE';
    showStatus(`Parâmetro “${label}” ${status}. Operação #${r.runId}. ${sensitive ? 'A senha não é exibida nem armazenada.' : 'Atualize os parâmetros após o próximo Inform para conferir o resultado.'}`);
    await renderMr60xLab(acsId);
  } catch (e) { showStatus(e.message, false); }
}
async function labReboot(acsId) {
  if (!window.confirm('Reiniciar este roteador agora? A internet e o Wi-Fi serão interrompidos temporariamente. Esta ação não restaura o padrão de fábrica nem apaga a configuração.')) return;
  try {
    const r = await api(`/api/acs/devices/${encodeURIComponent(acsId)}/lab/reboot`, { method: 'POST', body: JSON.stringify({ confirmCritical: true }) });
    showStatus(`Reinicialização ${r.status === 'executed' ? 'solicitada ao CPE' : 'enfileirada no GenieACS'}. Operação #${r.runId}.`);
    await renderMr60xLab(acsId);
  } catch (e) { showStatus(e.message, false); }
}

async function labFactoryReset(acsId, expectedSerial) {
  const serial = String(expectedSerial || '').trim();
  if (!serial) { showStatus('Não foi possível confirmar o serial do CPE. Atualize os parâmetros antes do reset.', false); return; }
  const accepted = window.confirm(`RESET DE FÁBRICA — ação destrutiva

Equipamento: MERCUSYS MR60X
Serial: ${serial}

O reset apaga configurações personalizadas. O CPE pode perder a URL/credenciais do ACS e não voltar a ser gerenciado remotamente. A logo RFN só fica no firmware após configuração por ferramenta oficial do fabricante.

Só prossiga se houver acesso local ou plano de recuperação e se este CPE for realmente o alvo.`);
  if (!accepted) return;
  const typed = window.prompt(`Para confirmar, digite o serial exato do equipamento:
${serial}`);
  if (typed === null || typed.trim() !== serial) { showStatus('Reset cancelado: o serial não confere.', false); return; }
  try {
    const r = await api(`/api/acs/devices/${encodeURIComponent(acsId)}/lab/factory-reset`, {
      method: 'POST', body: JSON.stringify({ confirmCritical: true, confirmSerial: typed.trim() })
    });
    showStatus(`Reset de fábrica ${r.status === 'executed' ? 'enviado/executado pelo ACS' : 'enfileirado no GenieACS'}. Operação #${r.runId}. O CPE pode não retornar ao ACS após o reset.`);
    await renderMr60xLab(acsId);
  } catch (e) { showStatus(e.message, false); }
}

async function labRefresh(acsId) {
  try { const r = await api(`/api/acs/devices/${encodeURIComponent(acsId)}/lab/refresh`, { method:'POST', body:'{}' }); showStatus(`Refresh ${r.status === 'executed' ? 'executado' : 'enfileirado'}. Teste #${r.runId}.`); } catch(e) { showStatus(e.message,false); }
}
async function labRead(acsId, pathValue) {
  try { const r = await api(`/api/acs/devices/${encodeURIComponent(acsId)}/lab/read`, { method:'POST', body:JSON.stringify({path:pathValue}) }); showStatus(`Leitura ${r.status === 'executed' ? 'executada' : 'enfileirada'} para ${pathValue}. ${r.status === 'executed' ? `Valor observado: ${r.observedValue ?? '—'}.` : 'Confirme após novo Inform.'} Teste #${r.runId}.`); } catch(e) { showStatus(e.message,false); }
}
async function labWriteProbe(acsId, pathValue) {
  const ok = window.confirm(`O teste reenviará o valor ATUAL de ${pathValue} para verificar se o CPE aceita setParameterValues sem alterar efetivamente o valor. Continuar?`);
  if (!ok) return;
  try { const r = await api(`/api/acs/devices/${encodeURIComponent(acsId)}/lab/write-probe`, { method:'POST', body:JSON.stringify({path:pathValue}) }); showStatus(`Write-probe ${r.status === 'executed' ? 'executado' : 'enfileirado'}. Teste #${r.runId}. ${r.status === 'executed' ? `Valor observado: ${r.observedValue ?? '—'}.` : 'Confirme no próximo Inform.'}`); } catch(e) { showStatus(e.message,false); }
}
loadAll();
