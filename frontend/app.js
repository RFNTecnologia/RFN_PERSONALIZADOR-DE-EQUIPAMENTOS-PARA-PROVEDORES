const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
let equipment = [], profiles = [], acs = [], providerSettings = null;

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
  if (name === 'profiles') renderProfiles();
  if (name === 'isp') loadProviderSettings();
  if (name === 'acs') loadACS();
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
    const [d, e, p, s] = await Promise.all([api('/api/dashboard'), api('/api/equipment'), api('/api/profiles'), api('/api/provider-settings')]);
    equipment = e; profiles = p; providerSettings = s; renderProviderSettings();
    $('cEquipment').textContent = d.equipment;
    $('cOnline').textContent = d.online_equipment;
    $('cProfiles').textContent = d.profiles;
    renderEquipment(); renderProfiles(); checkACS();
  } catch (e) { showStatus(e.message, false); }
}
function renderEquipment() {
  const tb = $('equipmentTable');
  if (!equipment.length) { tb.innerHTML = '<tr><td colspan="9" class="empty">Nenhum equipamento cadastrado.</td></tr>'; return; }
  tb.innerHTML = equipment.map(x => `<tr><td>${esc(x.manufacturer)}</td><td>${esc(x.model)}</td><td>${esc(x.equipment_type)}</td><td class="mono">${esc(x.serial_number)}</td><td class="mono">${esc(x.mac || '-')}</td><td>${esc(x.customer_name || '-')}</td><td>${esc(x.profile_name || 'Sem perfil')}</td><td><span class="badge ${x.status === 'online' ? 'online' : 'unknown'}">${esc(x.status)}</span></td><td><button class="secondary" onclick="equipmentActions(${x.id},'${esc(x.acs_device_id || '')}')">Abrir</button></td></tr>`).join('');
}
function renderProfiles() {
  const g = $('profilesGrid');
  if (!profiles.length) { g.innerHTML = '<div class="card empty">Nenhum perfil.</div>'; return; }
  g.innerHTML = profiles.map(p => `<div class="card"><h3 style="margin-top:0">${esc(p.name)}</h3><p class="hint">${esc(p.description || '')}</p><div class="kv"><span>Parâmetros TR-069</span><b>${Array.isArray(p.config?.parameterValues) ? p.config.parameterValues.length : 0}</b></div><pre class="hint mono" style="white-space:pre-wrap">${esc(JSON.stringify(p.config, null, 2))}</pre><button onclick="editProfile(${p.id})">Editar</button></div>`).join('');
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
  if ($('ispPreviewMessage')) $('ispPreviewMessage').textContent = message;
  if ($('ispPreviewSsid24')) $('ispPreviewSsid24').textContent = s24;
  if ($('ispPreviewSsid5')) $('ispPreviewSsid5').textContent = s5;
  const logo = $('ispPreviewLogo'); const url = $('ispLogo')?.value?.trim();
  if (logo) { if (url) { logo.src = url; logo.style.display = 'block'; logo.onerror = () => { logo.style.display = 'none'; }; } else { logo.removeAttribute('src'); logo.style.display = 'none'; } }
}
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
  const identity = `<div class="device-head"><div><h2 style="margin:0">${esc(e.manufacturer)} ${esc(e.model)}</h2><div class="hint">Serial <span class="mono">${esc(e.serial_number)}</span></div></div><span class="badge ${e.status === 'online' ? 'online' : 'unknown'}">${esc(e.status)}</span></div>`;
  openModal(`${identity}<p class="hint">ACS ID: <span class="mono">${esc(acsId || 'não vinculado')}</span></p><div class="device-tabs"><button class="device-tab active" onclick="showDeviceTab('info',this,${id},'${esc(acsId || '')}')">Informações</button><button class="device-tab" onclick="showDeviceTab('params',this,${id},'${esc(acsId || '')}')">Parâmetros</button><button class="device-tab" onclick="showDeviceTab('wifi',this,${id},'${esc(acsId || '')}')">Wi-Fi</button><button class="device-tab" onclick="showDeviceTab('wan',this,${id},'${esc(acsId || '')}')">WAN</button><button class="device-tab" onclick="showDeviceTab('tr069',this,${id},'${esc(acsId || '')}')">TR-069</button><button class="device-tab" onclick="showDeviceTab('provision',this,${id},'${esc(acsId || '')}')">Provisionamento</button><button class="device-tab" onclick="showDeviceTab('lab',this,${id},'${esc(acsId || '')}')">Laboratório MR60X</button></div><div id="deviceTabBody"><div class="card"><div class="hint">Carregando dados do equipamento...</div></div></div><div class="device-actions"><div><label>Perfil</label><select id="eProfile"><option value="">Sem perfil</option>${options}</select></div><div class="actions"><button onclick="assignProfile(${id})">Associar perfil</button>${acsId ? `<button class="ok" onclick="applyProfile('${esc(acsId)}')">Aplicar perfil</button><button class="secondary" onclick="refreshDevice('${esc(acsId)}')">Atualizar do CPE</button>` : ''}</div></div>`);
  if (acsId) {
    loadDeviceParameters(id, acsId, 'info');
  } else showDeviceEmpty('Este equipamento não está vinculado a um dispositivo do GenieACS.');
}
async function showDeviceTab(tab, btn, id, acsId) {
  document.querySelectorAll('.device-tab').forEach(x => x.classList.remove('active')); btn?.classList.add('active');
  if (!acsId) { showDeviceEmpty('Este equipamento não está vinculado a um dispositivo do GenieACS.'); return; }
  await loadDeviceParameters(id, acsId, tab);
}
function showDeviceEmpty(msg) { $('deviceTabBody').innerHTML = `<div class="card empty">${esc(msg)}</div>`; }
function valueText(v) { if (v === null || v === undefined || v === '') return '—'; if (typeof v === 'object') return JSON.stringify(v); return String(v); }
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
  const getValue = (path) => {
    const item = (values || []).find(x => x.path === path);
    return item && item.value !== undefined && item.value !== null ? String(item.value) : '';
  };
  const fields = [
    ['pppoeUser', 'Usuário PPPoE', getValue('Device.PPP.Interface.1.Username'), 'Usuário fornecido pelo provedor'],
    ['pppoePass', 'Senha PPPoE', '', 'Senha PPPoE'],
    ['ssid24', 'Nome do Wi-Fi 2,4 GHz', getValue('Device.WiFi.SSID.1.SSID'), 'Ex.: RFN_CLIENTE_2G'],
    ['ssid5', 'Nome do Wi-Fi 5 GHz', getValue('Device.WiFi.SSID.3.SSID'), 'Ex.: RFN_CLIENTE_5G'],
    ['wifiPass', 'Senha do Wi-Fi', '', 'Use uma senha forte (mínimo 8 caracteres)']
  ];
  const html = fields.map(([id, label, val, ph]) => `<div><label>${esc(label)}</label><input id="prov_${id}" value="${esc(val)}" placeholder="${esc(ph)}" ${id.endsWith('Pass') ? 'type="password" autocomplete="new-password"' : ''}></div>`).join('');
  $('deviceTabBody').innerHTML = `<div class="card">
    <h3 style="margin-top:0">Provisionamento — perfil RESIDENCIAL</h3>
    <p class="hint">Configure PPPoE e as duas redes Wi-Fi do MERCUSYS MR60X. Os caminhos TR-069 usados pelo formulário são os identificados no catálogo do equipamento; não é necessário preenchê-los manualmente.</p>
    <div class="two">${html}</div>
    <div class="actions" style="margin-top:14px"><button onclick="sendProvisioning('${esc(acsId)}')">Enviar configuração RESIDENCIAL</button><button class="secondary" onclick="showDeviceTab('params',document.querySelector('.device-tab.active'),null,'${esc(acsId)}')">Ver parâmetros</button></div>
    <div class="hint-block">O envio cria uma tarefa no GenieACS e solicita contato com o roteador. A tarefa pode ficar aguardando o próximo Inform; isso não significa que a configuração já foi aplicada. VLAN não será alterada automaticamente.</div>
  </div>`;
}
async function sendProvisioning(acsId) {
  const pppoeUser = $('prov_pppoeUser')?.value.trim();
  const pppoePass = $('prov_pppoePass')?.value;
  const ssid24 = $('prov_ssid24')?.value.trim();
  const ssid5 = $('prov_ssid5')?.value.trim();
  const wifiPass = $('prov_wifiPass')?.value;
  if (!pppoeUser || !pppoePass || !ssid24 || !ssid5 || !wifiPass) {
    showStatus('Preencha usuário e senha PPPoE, os dois nomes de Wi-Fi e a senha Wi-Fi.', false); return;
  }
  if (wifiPass.length < 8) { showStatus('A senha Wi-Fi precisa ter pelo menos 8 caracteres.', false); return; }
  const parameterValues = [
    ['Device.PPP.Interface.1.Enable', true],
    ['Device.PPP.Interface.1.ConnectionTrigger', 'AlwaysOn'],
    ['Device.PPP.Interface.1.Username', pppoeUser],
    ['Device.PPP.Interface.1.Password', pppoePass],
    ['Device.PPP.Interface.1.MaxMRUSize', 1492],
    ['Device.WiFi.SSID.1.SSID', ssid24],
    ['Device.WiFi.SSID.3.SSID', ssid5],
    ['Device.WiFi.AccessPoint.1.Security.PreSharedKey', wifiPass],
    ['Device.WiFi.AccessPoint.3.Security.PreSharedKey', wifiPass]
  ];
  try {
    const result = await api(`/api/acs/devices/${encodeURIComponent(acsId)}/provision`, { method: 'POST', body: JSON.stringify({ parameterValues }) });
    showStatus(`Tarefa de provisionamento enviada ao GenieACS (${result.count || parameterValues.length} parâmetros). Aguarde o retorno do MR60X no ACS para confirmar a aplicação.`);
  } catch (e) { showStatus(e.message, false); }
}
async function assignProfile(id) { try { await api(`/api/equipment/${id}`, { method: 'PATCH', body: JSON.stringify({ profile_id: $('eProfile').value || null }) }); closeModal(); showStatus('Perfil associado.'); await loadAll(); } catch (e) { showStatus(e.message, false); } }
async function applyProfile(acsId) { try { const e = equipment.find(x => x.acs_device_id === acsId); if (!e?.profile_id) throw new Error('Associe um perfil antes de aplicar.'); await api(`/api/acs/devices/${encodeURIComponent(acsId)}/apply-profile`, { method: 'POST', body: JSON.stringify({ profile_id: e.profile_id }) }); showStatus('Perfil enviado ao GenieACS/CPE.'); } catch (e) { showStatus(e.message, false); } }
async function renderMr60xLab(acsId) {
  $('deviceTabBody').innerHTML = '<div class="card"><div class="hint">Consultando laboratório determinístico do modelo...</div></div>';
  try {
    const d = await api(`/api/acs/devices/${encodeURIComponent(acsId)}/lab`);
    const badge = d.supported ? '<span class="badge online">Catálogo MR60X ativo</span>' : '<span class="badge unknown">Modelo sem catálogo</span>'; const conn = d.connection?.state === 'online' ? '<span class="badge online">CPE online</span>' : '<span class="badge unknown">Sem Inform recente</span>';
    const candidates = (d.candidates || []).map(c => {
      const value = c.sensitive ? (c.discovered ? '[redacted]' : '—') : (c.discovered ? esc(c.value) : '—');
      const writable = c.discovered ? (c.writable ? 'gravável' : 'somente leitura') : 'não observado';
      const probe = c.safeProbe && c.discovered && c.writable ? `<button class="secondary" onclick="labWriteProbe('${esc(acsId)}','${esc(c.path)}')">Write-probe</button>` : '';
      const read = c.discovered ? `<button class="secondary" onclick="labRead('${esc(acsId)}','${esc(c.path)}')">Ler</button>` : '';
      return `<div class="kv" style="gap:10px;align-items:flex-start"><div style="min-width:0;flex:1"><b>${esc(c.label)}</b><div class="hint mono">${esc(c.path)}</div><div class="hint">${writable} · tipo ${esc(c.type || '—')} · valor ${value}</div></div><div class="actions">${read}${probe}</div></div>`;
    }).join('');
    const runs = (d.runs || []).map(r => { const badge = r.status === 'executed' || r.status === 'confirmed' ? 'online' : 'unknown'; return `<tr><td>${esc(r.id)}</td><td>${esc(r.test_type)}</td><td class="mono">${esc(r.parameter_path || '—')}</td><td><span class="badge ${badge}">${esc(r.status)}</span></td><td>${esc(r.interpretation || '')}</td><td class="mono">${esc(r.created_at)}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">Nenhum teste registrado.</td></tr>';
    $('deviceTabBody').innerHTML = `<div class="card"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><div><h3 style="margin:0">Laboratório MR60X</h3><p class="hint">${d.supported ? 'Catálogo exato do MERCUSYS MR60X. Nenhuma busca genérica cria caminho de escrita.' : 'Este modelo ainda não possui catálogo determinístico.'}</p></div><div class="actions"><button onclick="labRefresh('${esc(acsId)}')">RefreshObject</button><button class="secondary" onclick="showDeviceTab('lab',document.querySelector('.device-tab.active'),null,'${esc(acsId)}')">Atualizar resultados</button></div></div><div class="hint-block">${badge} ${conn} Último Inform: <span class="mono">${esc(d.lastInform || '—')}</span></div>${candidates ? `<div class="param-list" style="margin-top:12px">${candidates}</div>` : ''}</div><div class="card" style="margin-top:12px"><h3 style="margin-top:0">Histórico do laboratório</h3><div class="table-wrap"><table><thead><tr><th>ID</th><th>Teste</th><th>Parâmetro</th><th>Status</th><th>Interpretação</th><th>Data</th></tr></thead><tbody>${runs}</tbody></table></div><p class="hint">"queued" significa que o ACS aceitou a tarefa para o próximo Inform. O histórico é reconciliado automaticamente quando o CPE realmente volta a falar com o ACS.</p></div>`;
  } catch (e) { $('deviceTabBody').innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
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
