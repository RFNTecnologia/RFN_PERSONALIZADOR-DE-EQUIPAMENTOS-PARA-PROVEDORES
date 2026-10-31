/**
 * Implementacao CWMP (TR-069) sobre HTTP/SOAP, suficiente para o fluxo de
 * restauracao: Inform -> Provision (com SetParameterValues) -> reboot.
 *
 * O parser SOAP e baseado em regex de proposito: o servidor roda sem
 * dependencias externas e o trafego CWMP e sempre estruturado e previsivel.
 */

const NS = 'urn:dslforum-org:cwmp-1-0'

function tag(nome, conteudo = '') {
  return `<${nome}>${conteudo}</${nome}>`
}

function envelope(id, corpo) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="${NS}" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Header><cwmp:ID soap:mustUnderstand="1">${id}</cwmp:ID></soap:Header>
  <soap:Body>${corpo}</soap:Body>
</soap:Envelope>`
}

function decodificar(valor) {
  return String(valor ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * O DeviceId do TR-069 e o MAC do equipamento. Alguns CPEs apagam o serial
 * de fabrica no reset de fabrica, mas o MAC continua: ele permite reconhecer
 * o equipamento e reaplicar o perfil do provedor.
 */
export function macDeDeviceId(deviceId) {
  const bruto = String(deviceId || '').trim().replace(/[^0-9a-fA-F]/g, '')
  if (bruto.length !== 12) return ''
  return bruto
    .toLowerCase()
    .match(/.{2}/g)
    .join(':')
}

/** Extrai o conteudo de uma tag, aceitando o prefixo de namespace usado pelos
 * CPEs reais (cwmp:Name) e o formato sem prefixo do simulador (Name).
 */
function textoBloco(xml, tagName) {
  const regex = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tagName}[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${tagName}>`)
  const achado = xml.match(regex)
  return achado ? achado[1] : ''
}

export function idSoap(xml) {
  const bloco = textoBloco(xml, 'ID')
  return decodificar(bloco).trim()
}

/** Extrai o tipo de mensagem CWMP (Inform, GetParameterValues, ...). */
export function tipoMensagem(xml) {
  const candidatos = ['Inform', 'GetParameterValues', 'SetParameterValues', 'AddObject', 'DeleteObject', 'Reboot', 'GetParameterAttributes', 'FactoryReset']
  for (const c of candidatos) {
    if (xml.includes(`<cwmp:${c}`) || xml.includes(`:${c}`) || new RegExp(`<${c}[ >]`).test(xml)) return c
  }
  return 'desconhecida'
}

export function parseInform(xml) {
  const oid = textoBloco(xml, 'OUI')
  const serial = textoBloco(xml, 'SerialNumber')
  const modelo = textoBloco(xml, 'ModelName')
  const fabricante = textoBloco(xml, 'Manufacturer')
  const firmware = textoBloco(xml, 'SoftwareVersion')
  const deviceId = textoBloco(xml, 'DeviceId')
  const params = []

  const regexParam = /<(?:[A-Za-z0-9_.-]+:)?ParameterValueStruct>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?ParameterValueStruct>/g
  let achado
  while ((achado = regexParam.exec(xml)) !== null) {
    const bloco = achado[1]
    const nome = decodificar(textoBloco(bloco, 'Name')).trim()
    const valor = decodificar(textoBloco(bloco, 'Value'))
    if (nome) params.push({ path: nome, value: valor })
  }

  const eventos = []
  const regexEvento = /<(?:[A-Za-z0-9_.-]+:)?EventStruct>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?EventStruct>/g
  while ((achado = regexEvento.exec(xml)) !== null) {
    const bloco = achado[1]
    eventos.push({
      code: decodificar(textoBloco(bloco, 'EventCode')).trim(),
      timestamp: decodificar(textoBloco(bloco, 'Timestamp')).trim(),
    })
  }

  return {
    oid: decodificar(oid).trim(),
    serial: decodificar(serial).trim(),
    deviceId: decodificar(deviceId).trim(),
    mac: macDeDeviceId(decodificar(deviceId).trim()),
    modelo: decodificar(modelo).trim(),
    fabricante: decodificar(fabricante).trim(),
    firmware: decodificar(firmware).trim(),
    parametros: params,
    eventos,
  }
}

export function parseGetParameterValues(xml) {
  const caminhos = []
  const regex = /<(?:[A-Za-z0-9_.-]+:)?ParameterPath>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?ParameterPath>/g
  let achado
  while ((achado = regex.exec(xml)) !== null) {
    const caminho = decodificar(achado[1]).trim()
    if (caminho) caminhos.push(caminho)
  }
  return caminhos
}

export function parseSetParameterValues(xml) {
  const params = []
  const regex = /<(?:[A-Za-z0-9_.-]+:)?ParameterValueStruct>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?ParameterValueStruct>/g
  let achado
  while ((achado = regex.exec(xml)) !== null) {
    const bloco = achado[1]
    const nome = decodificar(textoBloco(bloco, 'Name')).trim()
    const valor = decodificar(textoBloco(bloco, 'Value'))
    if (nome) params.push({ path: nome, value: valor })
  }
  return params
}

/** Serial do dispositivo informado no corpo da mensagem (DeviceId). */
export function serialDoDispositivo(xml) {
  return decodificar(textoBloco(xml, 'SerialNumber')).trim()
}

export function respostaInform(id, comandos = []) {
  const lista = comandos
    .map((cmd) => {
      if (cmd.tipo === 'SetParameterValues') {
        const structs = cmd.parametros
          .map(
            (p) =>
              `<cwmp:ParameterValueStruct><cwmp:Name>${p.path}</cwmp:Name><cwmp:Value>${p.value}</cwmp:Value></cwmp:ParameterValueStruct>`,
          )
          .join('')
        return `<cwmp:SetParameterValues>${structs}</cwmp:SetParameterValues>`
      }
      if (cmd.tipo === 'Reboot') {
        return '<cwmp:Reboot><cwmp:Command>Reboot</cwmp:Command></cwmp:Reboot>'
      }
      return ''
    })
    .join('')
  const provision = lista ? `<cwmp:Provision>${lista}</cwmp:Provision>` : ''
  return envelope(id, `<cwmp:InformResponse><cwmp:MaxEnvelopeSize>65536</cwmp:MaxEnvelopeSize>${provision}</cwmp:InformResponse>`)
}

export function respostaGetParameterValues(id, params) {
  const structs = params
    .map(
      (p) =>
        `<cwmp:ParameterValueStruct><cwmp:Name>${p.path}</cwmp:Name><cwmp:Value>${p.value}</cwmp:Value></cwmp:ParameterValueStruct>`,
    )
    .join('')
  return envelope(
    id,
    `<cwmp:GetParameterValuesResponse><cwmp:ParameterList>${structs}</cwmp:GetParameterList></cwmp:GetParameterValuesResponse>`,
  )
}

export function respostaSetParameterValues(id) {
  return envelope(id, '<cwmp:SetParameterValuesResponse></cwmp:SetParameterValuesResponse>')
}

export function respostaVazia(id) {
  return envelope(id, '<cwmp:Response></cwmp:Response>')
}

export function respostaReboot(id) {
  return envelope(id, '<cwmp:RebootResponse></cwmp:RebootResponse>')
}

export function soapFalha(id, codigo, descricao) {
  return envelope(
    id,
    `<soap:Fault><faultcode>${codigo}</faultcode><faultstring>${descricao}</faultstring></soap:Fault>`,
  )
}
