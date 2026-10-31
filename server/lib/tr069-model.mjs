/**
 * Traduz o perfil de configuracao do provedor para o modelo de parametros
 * TR-069 usado pelo ACS, e para o formato plano consumido pelo agente de
 * restauracao que roda dentro do equipamento.
 *
 * O perfil continua sendo a fonte da verdade; aqui apenas mapeamos os campos
 * para o vocabulario que o CPE entende.
 */

const ACS_RAIZ = 'Device.X.Provisioning.ACS'

function igd() {
  return 'InternetGatewayDevice.1'
}

/** Converte "192.168.15.0/24" na mascara correspondente. */
export function mascaraDaFaixa(faixa) {
  const texto = String(faixa || '')
  const partes = texto.split('/')
  const bits = Number(partes[1])
  if (!Number.isFinite(bits) || bits <= 0 || bits > 32) return '255.255.255.0'
  const mascara = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return [24, 16, 8].map((deslocamento) => (mascara >>> deslocamento) & 0xff).join('.')
}

/** Modo WAN aceito pelo UCI do OpenWrt. */
function modoUci(modo) {
  if (modo === 'pppoe') return 'pppoe'
  if (modo === 'ip-estatico') return 'static'
  return 'dhcp'
}

export function parametrosDoPerfil({
  perfil,
  branding,
  politica,
  serial,
  identificador,
  acsUrl,
  acsUsuario,
  acsSenha,
}) {
  const wan = perfil.wan
  const wifi = perfil.wifi
  const lan = perfil.lan
  const params = []

  const add = (path, value) => params.push({ path, value })

  add(`${ACS_RAIZ}.URL`, acsUrl || perfil.gestao.acsUrl || '')
  add(`${ACS_RAIZ}.Username`, acsUsuario || 'admin')
  add(`${ACS_RAIZ}.Password`, acsSenha || '')
  add(`${ACS_RAIZ}.PeriodicInformInterval`, Math.max(60, (perfil.gestao.intervaloMin || 60) * 60))
  add(`${ACS_RAIZ}.BOOTSTRAPURL`, perfil.gestao.urlBootstrap || '')
  add('Device.X.ManagementServer.Password', politica.senhaAdminPadrao || '')
  add('Device.X.ManagementServer.ConnectionRequestPassword', politica.senhaAdminPadrao || '')

  if (wan.modo === 'pppoe') {
    add(`${igd()}.WANConnectionDevice.1.WANConnectionInstance.1.WANPPPConnection.1.Username`, wan.usuario)
    add(`${igd()}.WANConnectionDevice.1.WANConnectionInstance.1.WANPPPConnection.1.Password`, wan.senha)
    add(`${igd()}.WANConnectionDevice.1.WANConnectionInstance.1.WANPPPConnection.1.VLANID`, wan.vlan)
  } else if (wan.modo === 'ip-estatico') {
    add(`${igd()}.WANConnectionDevice.1.WANConnectionInstance.1.WANIPConnection.1.Addressing.1.Address`, wan.usuario)
    add(`${igd()}.WANConnectionDevice.1.WANConnectionInstance.1.WANIPConnection.1.Addressing.1.SubnetMask`, '255.255.255.0')
    add(`${igd()}.WANConnectionDevice.1.WANConnectionInstance.1.WANIPConnection.1.Addressing.1.Gateway`, lan.gateway)
  } else {
    add(`${igd()}.WANConnectionDevice.1.WANConnectionInstance.1.WANIPConnection.1.Addressing.1.AddressingType`, 'DHCP')
  }
  add(`${igd()}.WANConnectionDevice.1.WANConnectionInstance.1.MTU`, wan.mtu)

  add(`${igd()}.LANInterfaceConfig.1.DefaultGateway`, lan.gateway)
  add(`${igd()}.LANInterfaceConfig.1.DHCPServer.1.DHCPLeaseTime`, 86400)
  add(`${igd()}.LANInterfaceConfig.1.DHCPServer.1.DHCPGateway`, lan.dns[0] || '')
  add(`${igd()}.LANInterfaceConfig.1.DHCPServer.1.DHCPDNSServers`, (lan.dns || []).join(','))
  add(`${igd()}.LANInterfaceConfig.1.DHCPServer.1.DHCPStaticAddresses`, lan.faixa)

  add(`${igd()}.AccessPoint.1.SSID`, wifi.ssid)
  add(`${igd()}.AccessPoint.1.X_Provider_SSID`, branding.marca)
  add(`${igd()}.AccessPoint.1.WPAPassphrase`, wifi.senha)
  add(`${igd()}.AccessPoint.1.X_Band`, wifi.banda)
  add(`${igd()}.AccessPoint.1.ChannelWidth`, wifi.larguraCanal)
  add(`${igd()}.AccessPoint.1.X_SSIDHidden`, wifi.oculta ? 'true' : 'false')

  add('Device.X.DeviceInfo.SerialNumber', serial)
  add('Device.X.DeviceInfo.ProvisioningCode', identificador || branding.marca)
  add('Device.X.DeviceInfo.Provider', branding.marca)

  if (perfil.gestao.aplicarBranding) {
    add('Device.X.Customization.LoginPageURL', '')
    add('Device.X.Customization.BrandingPayload', JSON.stringify({
      marca: branding.marca,
      corPrimaria: branding.corPrimaria,
      corPrimariaTexto: branding.corPrimariaTexto,
      corFundo: branding.corFundo,
      corPainel: branding.corPainel,
      corTexto: branding.corTexto,
      corBorda: branding.corBorda,
      raio: branding.raio,
      tema: branding.tema,
      titulo: branding.titulo,
      subtitulo: branding.subtitulo,
      rotuloBotao: branding.rotuloBotao,
      rodape: branding.rodape,
      mostrarTermos: branding.mostrarTermos,
      textoTermos: branding.textoTermos,
      mostrarWifi: branding.mostrarWifi,
      mostrarVelocidade: branding.mostrarVelocidade,
      camposExtras: branding.camposExtras,
    }))
  }

  if (perfil.gestao.aplicarFirmware) {
    add('Device.X.Firmware.1.DownloadURL', perfil.gestao.firmwareUrl || '')
    add('Device.X.Firmware.1.TargetVersion', perfil.gestao.firmwareVersao || '')
    add('Device.X.Firmware.1.Download', perfil.gestao.forcarAtualizacao ? '1' : '0')
  }

  return params
}

/**
 * Configuracao plana do provedor: formato unico consumido pelo agente
 * dentro do equipamento (sem depender de TR-069 nem de ferramentas JSON).
 */
export function configPlana({ perfil, branding, politica, serial, identificador, acsUsuario, acsSenha }) {
  return {
    serial: serial || '',
    identificador: identificador || '',
    marca: branding.marca,
    wan: {
      modo: perfil.wan.modo,
      modoUci: modoUci(perfil.wan.modo),
      usuario: perfil.wan.usuario || '',
      senha: perfil.wan.senha || '',
      vlan: perfil.wan.vlan || 0,
      mtu: perfil.wan.mtu || 1500,
    },
    lan: {
      gateway: perfil.lan.gateway || '',
      faixa: perfil.lan.faixa || '',
      mascara: mascaraDaFaixa(perfil.lan.faixa),
      dns: perfil.lan.dns || [],
      dnsSecundario: perfil.lan.dnsSecundario || '',
    },
    wifi: {
      ssid: perfil.wifi.ssid || '',
      senha: perfil.wifi.senha || '',
      banda: perfil.wifi.banda || 'dual-band',
      canal: perfil.wifi.canal || 'auto',
      larguraCanal: perfil.wifi.larguraCanal || '40MHz',
      oculta: perfil.wifi.oculta ? '1' : '0',
    },
    gestao: {
      acsUrl: perfil.gestao.acsUrl || '',
      acsUsuario: acsUsuario || 'admin',
      acsSenha: acsSenha || '',
      intervaloMin: perfil.gestao.intervaloMin || 60,
      metodoRestore: perfil.gestao.metodoRestore || 'tr069-acs',
      urlBootstrap: perfil.gestao.urlBootstrap || '',
      dhcpOption60: perfil.gestao.dhcpOption60 || '',
      senhaAdmin: politica.senhaAdminPadrao || '',
    },
  }
}

/** Comandos UCI derivados da configuracao plana (para OpenWrt/derivados). */
export function comandosUci(config) {
  const comandos = []
  const uci = (chave, valor) => {
    if (valor === undefined || valor === null || valor === '') return
    comandos.push({ chave, valor: String(valor) })
  }

  uci('network.wan.proto', config.wan.modoUci)
  uci('network.wan.username', config.wan.usuario)
  uci('network.wan.password', config.wan.senha)
  uci('network.wan.vlan', config.wan.vlan ? String(config.wan.vlan) : '')
  uci('network.wan.mtu', String(config.wan.mtu || ''))
  uci('network.lan.ipaddr', config.lan.gateway)
  uci('network.lan.netmask', config.lan.mascara)
  uci('network.lan.dns', (config.lan.dns || []).join(' '))
  uci('wireless.@wifi[0].ssid', config.wifi.ssid)
  uci('wireless.@wifi[0].key', config.wifi.senha)
  uci('wireless.@wifi[0].band', config.wifi.banda === '5GHz' ? '5g' : '2g')
  uci('wireless.@wifi[0].htmode', config.wifi.larguraCanal)
  uci('wireless.@wifi[0].hidden', config.wifi.oculta)

  return comandos
}

function aspa(valor) {
  return `'${String(valor ?? '').replace(/'/g, "'\\''")}'`
}

/**
 * Exporta a configuracao como arquivo de shell (KEY=VALUE) para o agente
 * buscar com "source". Evita depender de jq ou de parser JSON no equipamento.
 */
export function exportarEnv(config) {
  const linhas = [
    '# Configuracao do provedor — gerada pelo servidor RFN',
    `RFN_SERIAL=${aspa(config.serial)}`,
    `RFN_IDENTIFICADOR=${aspa(config.identificador)}`,
    `RFN_MARCA=${aspa(config.marca)}`,
    `RFN_WAN_PROTO=${aspa(config.wan.modoUci)}`,
    `RFN_WAN_MODO=${aspa(config.wan.modo)}`,
    `RFN_WAN_USER=${aspa(config.wan.usuario)}`,
    `RFN_WAN_PASS=${aspa(config.wan.senha)}`,
    `RFN_WAN_VLAN=${aspa(config.wan.vlan ?? 0)}`,
    `RFN_WAN_MTU=${aspa(config.wan.mtu ?? 1500)}`,
    `RFN_LAN_IP=${aspa(config.lan.gateway)}`,
    `RFN_LAN_MASK=${aspa(config.lan.mascara)}`,
    `RFN_LAN_DNS=${aspa((config.lan.dns || []).join(' '))}`,
    `RFN_WIFI_SSID=${aspa(config.wifi.ssid)}`,
    `RFN_WIFI_PASS=${aspa(config.wifi.senha)}`,
    `RFN_WIFI_BAND=${aspa(config.wifi.banda)}`,
    `RFN_WIFI_HTMODE=${aspa(config.wifi.larguraCanal)}`,
    `RFN_WIFI_HIDDEN=${aspa(config.wifi.oculta)}`,
    `RFN_ACS_URL=${aspa(config.gestao.acsUrl)}`,
    `RFN_ACS_USER=${aspa(config.gestao.acsUsuario)}`,
    `RFN_ACS_PASS=${aspa(config.gestao.acsSenha)}`,
    `RFN_ACS_INTERVALO=${aspa(config.gestao.intervaloMin)}`,
    `RFN_METODO_RESTORE=${aspa(config.gestao.metodoRestore)}`,
    `RFN_URL_BOOTSTRAP=${aspa(config.gestao.urlBootstrap)}`,
    `RFN_ADMIN_PASS=${aspa(config.gestao.senhaAdmin)}`,
    '',
  ]
  return linhas.join('\n')
}

/** Assinatura do estado provisionado, usada para detectar divergencia. */
export function hashConfig(params) {
  const base = params
    .map((p) => `${p.path}=${p.value}`)
    .sort()
    .join('|')
  let h = 0x811c9dc5
  for (let i = 0; i < base.length; i += 1) {
    h ^= base.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** Extrai o valor mais especifico de um caminho TR-069 (curinga *). */
export function valorPorCaminho(params, caminho) {
  const exato = params.find((p) => p.path === caminho)
  if (exato) return exato.value
  const regex = new RegExp(
    `^${caminho.replace(/\./g, '\\.').replace(/\*/g, '\\.[^.]+')}$`,
  )
  const encontrado = params.find((p) => regex.test(p.path))
  return encontrado ? encontrado.value : undefined
}

export function parametrosDoDispositivo(dispositivo) {
  return (dispositivo?.parametros || []).map((p) => ({ path: p.path, value: p.value }))
}
