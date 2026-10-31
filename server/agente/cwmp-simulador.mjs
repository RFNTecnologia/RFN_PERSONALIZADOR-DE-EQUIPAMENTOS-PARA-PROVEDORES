/**
 * Simulador de CPE (TR-069/CWMP) para validar o ACS sem hardware real.
 *
 *   node server/agente/cwmp-simulador.mjs \
 *     --server http://127.0.0.1:8080/acs/tr069 \
 *     --usuario admin --senha SEGREDO \
 *     --serial FS-ONT-0001 --modelo cx588 \
 *     --identificador gru1::cx588-1793224550476-38f3d149b1ba \
 *     --reset
 *
 * O simulador envia um Inform como se fosse o equipamento real e mostra o que
 * o ACS devolve (SetParameterValues + Reboot). Com --reset ele informa o
 * evento de reset de fabrica, que e o cenario que o provedor precisa validar.
 */

import crypto from 'node:crypto'

const NS = 'urn:dslforum-org:cwmp-1-0'

function md5(valor) {
  return crypto.createHash('md5').update(valor).digest('hex')
}

function argumentos() {
  const bruto = process.argv.slice(2)
  const mapa = {}
  for (let i = 0; i < bruto.length; i += 1) {
    if (!bruto[i].startsWith('--')) continue
    const chave = bruto[i].slice(2)
    const proximo = bruto[i + 1]
    if (proximo && !proximo.startsWith('--')) {
      mapa[chave] = proximo
      i += 1
    } else {
      mapa[chave] = 'true'
    }
  }
  return mapa
}

const opcoes = argumentos()
const SERVIDOR = opcoes.server || 'http://127.0.0.1:8080/acs/tr069'
const USUARIO = opcoes.usuario || 'admin'
const SENHA = opcoes.senha || process.env.RFN_ACS_PASSWORD || 'admin'
const SERIAL = opcoes.serial || 'FS-SIM-0001'
const MODELO = opcoes.modelo || 'cx588'
const FABRICANTE = opcoes.fabricante || 'Simulado'
const FIRMWARE = opcoes.firmware || '1.0.0'
const IDENTIFICADOR = opcoes.identificador || ''
const RESET = Boolean(opcoes.reset)

function escapar(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function envelope(id, corpo) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="${NS}" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Header><cwmp:ID soap:mustUnderstand="1">${id}</cwmp:ID></soap:Header>
  <soap:Body>${corpo}</soap:Body>
</soap:Envelope>`
}

function inform() {
  const parametros = [
    ['Device.X.DeviceInfo.OUI', 'F0:9E:7C'],
    ['Device.X.DeviceInfo.SerialNumber', SERIAL],
    ['Device.X.DeviceInfo.ModelName', MODELO],
    ['Device.X.DeviceInfo.Manufacturer', FABRICANTE],
    ['Device.X.DeviceInfo.SoftwareVersion', FIRMWARE],
    ['Device.X.DeviceInfo.ProvisioningCode', IDENTIFICADOR || MODELO],
    ['InternetGatewayDevice.1.WANConnectionDevice.1.WANConnectionInstance.1.WANPPPConnection.1.Username', 'padrao@fabrica'],
  ]
    .map(([nome, valor]) => `<ParameterValueStruct><Name>${nome}</Name><Value>${escapar(valor)}</Value></ParameterValueStruct>`)
    .join('')

  const eventos = RESET
    ? `<EventStruct><EventCode>0 FACTORYRESET</EventCode><Timestamp>${new Date().toISOString()}</Timestamp></EventStruct>`
    : `<EventStruct><EventCode>0 BOOTSTRAP</EventCode><Timestamp>${new Date().toISOString()}</Timestamp></EventStruct>`

  return envelope(
    crypto.randomBytes(8).toString('hex'),
    `<cwmp:Inform>
      <DeviceId><Manufacturer>${escapar(FABRICANTE)}</Manufacturer><OUI>F09E7C</OUI><ProductClass>${escapar(
        MODELO,
      )}</ProductClass><SerialNumber>${escapar(SERIAL)}</SerialNumber></DeviceId>
      <Event><EventStruct>${eventos}</EventStruct></Event>
      <ParameterList>${parametros}</ParameterList>
    </cwmp:Inform>`,
  )
}

function desafio(header) {
  const campos = {}
  for (const parte of (header || '').replace(/^Digest\s+/, '').split(',')) {
    const [chave, ...resto] = parte.trim().split('=')
    if (chave) campos[chave] = resto.join('=').replace(/^"|"$/g, '')
  }
  return campos
}

async function enviar(corpo) {
  const url = new URL(SERVIDOR)
  const uri = url.pathname + url.search
  const resposta = await fetch(SERVIDOR, {
    method: 'POST',
    headers: { 'content-type': 'text/xml; charset=utf-8' },
    body: corpo,
  })
  if (resposta.status !== 401) return resposta

  const campos = desafio(resposta.headers.get('www-authenticate'))
  const nc = '00000001'
  const cnonce = crypto.randomBytes(8).toString('hex')
  const ha1 = md5(`${USUARIO}:${campos.realm || ''}:${SENHA}`)
  const ha2 = md5(`POST:${uri}`)
  const esperado = campos.qop
    ? md5(`${ha1}:${campos.nonce}:${nc}:${cnonce}:${campos.qop}:${ha2}`)
    : md5(`${ha1}:${campos.nonce}:${ha2}`)
  const authorization =
    `Digest username="${USUARIO}", realm="${campos.realm || ''}", nonce="${campos.nonce}", ` +
    `uri="${uri}", response="${esperado}"` +
    (campos.qop ? `, qop=${campos.qop}, nc=${nc}, cnonce="${cnonce}"` : '') +
    (campos.opaque ? `, opaque="${campos.opaque}"` : '')

  return fetch(SERVIDOR, {
    method: 'POST',
    headers: { 'content-type': 'text/xml; charset=utf-8', authorization },
    body: corpo,
  })
}

async function principal() {
  console.log(`→ ACS: ${SERVIDOR}`)
  console.log(`→ CPE simulado: ${SERIAL} (${MODELO})${RESET ? ' [reset de fábrica]' : ''}`)
  const resposta = await enviar(inform())
  const texto = await resposta.text()

  console.log(`← status ${resposta.status}`)
  if (resposta.status !== 200) {
    console.log(texto)
    process.exitCode = 1
    return
  }

  const parametros = [...texto.matchAll(/<(?:cwmp:)?Name>([^<]+)<\/(?:cwmp:)?Name>\s*<(?:cwmp:)?Value>([^<]*)<\/(?:cwmp:)?Value>/g)]
  const comando = texto.includes('<cwmp:Reboot>') ? 'Reboot' : texto.includes('<cwmp:SetParameterValues>') ? 'SetParameterValues' : 'sem comandos'
  console.log(`← comando do ACS: ${comando}`)
  if (parametros.length) {
    console.log('← parâmetros entregues:')
    for (const [, nome, valor] of parametros) console.log(`   ${nome} = ${valor}`)
  } else {
    console.log('← nenhum parâmetro na resposta (perfil já aplicado ou equipamento desconhecido)')
  }
}

principal().catch((erro) => {
  console.error('falha na simulação:', erro.message)
  process.exitCode = 1
})
