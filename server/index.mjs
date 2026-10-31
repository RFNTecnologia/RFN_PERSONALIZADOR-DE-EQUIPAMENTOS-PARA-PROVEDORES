/**
 * Servidor do provedor: API do painel + ACS (TR-069/CWMP) + bootstrap para CPE.
 * Sem dependencias externas: apenas modulos nativos do Node.
 *
 *   node server/index.mjs
 *
 * Variaveis de ambiente:
 *   PORT / RFN_PORT   porta HTTP (padrao 8080)
 *   RFN_TOKEN         token de administracao do painel (gerado se ausente)
 *   RFN_DEVICE_TOKEN  token usado pelos equipamentos
 *   RFN_ACS_USERNAME  usuario TR-069 (padrao admin)
 *   RFN_ACS_PASSWORD  senha TR-069 (padrao igual ao token)
 */

import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  DATA_DIR,
  DIR_DIST,
  HOST,
  PORTA,
  RAIZ,
  garantirDir,
  log,
  tokenDispositivo,
  tokenPainel,
  tokenValido,
} from './lib/config.mjs'

const RAIZ_AGENTE = path.join(RAIZ, 'server', 'agente')
import { atualizarEstado, lerEstado, salvarEstado } from './lib/store.mjs'
import { gerarPaginaLogin } from './lib/login.mjs'
import {
  comandosUci,
  configPlana,
  exportarEnv,
  hashConfig,
  parametrosDoPerfil,
} from './lib/tr069-model.mjs'
import { formatarIdentificador, parseIdentificador } from './lib/identificador.mjs'
import { montarKit } from './lib/kit.mjs'
import { montarPacote } from './lib/pacote.mjs'
import * as cwmp from './lib/cwmp.mjs'
import * as varredura from './lib/varredura.mjs'

const TOKEN_PAINEL = tokenPainel()
const TOKEN_DISPOSITIVO = tokenDispositivo()
const ACS_USUARIO = process.env.RFN_ACS_USERNAME || 'admin'
const ACS_SENHA = process.env.RFN_ACS_PASSWORD || TOKEN_PAINEL

/** URL publica do ACS, usada para conectar o CPE de volta ao provedor. */
const ACS_URL_PADRAO =
  process.env.RFN_PUBLIC_URL ||
  `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORTA}/acs/tr069`

/** Diretorio onde ficam os firmwares publicados para download pelo CPE. */
const DIR_FIRMWARE = path.join(DATA_DIR, 'firmware')

const TIPOS = {
  'text/html': 'html',
  'text/css': 'css',
  'application/javascript': 'js',
  'application/json': 'json',
  'image/svg+xml': 'svg',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/x-icon': 'ico',
  'font/woff2': 'woff2',
}

// ---------------------------------------------------------------- utilidades

function responderJson(res, status, dados, cabecalhos = {}) {
  const corpo = JSON.stringify(dados, null, 2)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(corpo),
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization, x-rfn-token',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    ...cabecalhos,
  })
  res.end(corpo)
}

function responderTexto(res, status, texto, tipo = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': tipo,
    'content-length': Buffer.byteLength(texto),
    'access-control-allow-origin': '*',
  })
  res.end(texto)
}

/** Envia um arquivo binario (kit de implantacao, firmware) ao navegador ou ao CPE. */
function responderBinario(res, status, dados, nomeArquivo, tipo = 'application/octet-stream') {
  res.writeHead(status, {
    'content-type': tipo,
    'content-length': dados.length,
    'content-disposition': `attachment; filename="${nomeArquivo}"`,
    'access-control-allow-origin': '*',
  })
  res.end(dados)
}

async function lerCorpo(req) {
  const partes = []
  for await (const parte of req) partes.push(parte)
  return Buffer.concat(partes).toString('utf8')
}

function tokenDaRequisicao(req) {
  const auth = req.headers.authorization || ''
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim()
  return req.headers['x-rfn-token'] || ''
}

function autorizadoPainel(req) {
  return tokenValido(TOKEN_PAINEL, tokenDaRequisicao(req))
}

function exigePainel(req, res) {
  if (autorizadoPainel(req)) return true
  responderJson(res, 401, { erro: 'token invalido ou ausente' })
  return false
}

function md5(valor) {
  return crypto.createHash('md5').update(valor).digest('hex')
}

function desafioDigest(nonce) {
  return (
    'Digest realm="FibraSul-ACS", qop="auth", nonce="' +
    nonce +
    '", opaque="' +
    md5(nonce + 'fibrasul') +
    '"'
  )
}

function checarDigest(req, res) {
  const header = req.headers.authorization || ''
  if (!header.startsWith('Digest ')) {
    res.writeHead(401, { 'www-authenticate': desafioDigest(crypto.randomBytes(16).toString('hex')) })
    res.end()
    return false
  }
  if (validarDigest(header, req.method, req.url)) return true
  res.writeHead(401, { 'www-authenticate': desafioDigest(crypto.randomBytes(16).toString('hex')) })
  res.end()
  return false
}

/** Valida um cabecalho Digest sem responder: usado em downloads de firmware. */
function validarDigest(header, metodo, url) {
  if (!header.startsWith('Digest ')) return false
  const campos = {}
  for (const parte of header.slice(7).split(',')) {
    const [chave, ...resto] = parte.trim().split('=')
    if (!chave) continue
    campos[chave] = resto.join('=').replace(/^"|"$/g, '')
  }
  const caminho = String(url || '').split('?')[0]
  const ha1 = md5(`${ACS_USUARIO}:${campos.realm || ''}:${ACS_SENHA}`)
  const ha2 = md5(`${metodo}:${campos.uri || caminho}`)
  const esperado = campos.qop
    ? md5(`${ha1}:${campos.nonce}:${campos.nc}:${campos.cnonce}:${campos.qop}:${ha2}`)
    : md5(`${ha1}:${campos.nonce}:${ha2}`)
  return tokenValido(esperado, campos.response)
}

// ------------------------------------------------------- estado e dispositivos

function registrarEvento(tipo, mensagem, detalhe, equipamentoId = null, resultado = 'sucesso') {
  atualizarEstado((estado) => {
    estado.logs = [
      {
        id: `l${Date.now()}${Math.floor(Math.random() * 1000)}`,
        em: new Date().toISOString(),
        tipo,
        equipamentoId,
        mensagem,
        detalhe,
        resultado,
      },
      ...(estado.logs || []),
    ].slice(0, 2000)
    return estado
  })
}

function garantirDispositivos(estado) {
  if (!Array.isArray(estado.dispositivos)) estado.dispositivos = []
  return estado.dispositivos
}

function dispositivoPorSerial(estado, serial) {
  const alvo = String(serial || '').trim().toLowerCase()
  return garantirDispositivos(estado).find((d) => String(d.serial || '').toLowerCase() === alvo)
}

function equipamentoPorSerial(estado, serial) {
  const alvo = String(serial || '').trim().toLowerCase()
  return (estado.equipamentos || []).find((e) => String(e.serial || '').trim().toLowerCase() === alvo)
}

/**
 * Busca pelo MAC. Alguns CPEs apagam o serial de fabrica no reset de fabrica,
 * mas o MAC permanece: e o vinculo mais confiavel para reconhecer o
 * equipamento e reaplicar o perfil do provedor.
 */
function normalizarMac(valor) {
  return String(valor || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase()
}

function equipamentoPorMac(estado, mac) {
  const alvo = normalizarMac(mac)
  if (!alvo) return null
  return (estado.equipamentos || []).find((e) => normalizarMac(e.mac) === alvo)
}

/**
 * Localiza o dispositivo do ACS pelo serial ou pelo DeviceId (MAC). O DeviceId
 * e o que sobrevive ao reset de fabrica, por isso e o caminho mais confiavel
 * quando o CPE ja voltou do reset.
 */
function dispositivoPorSerialOuMac(estado, valor) {
  const serial = String(valor || '').trim().toLowerCase()
  const mac = normalizarMac(valor)
  if (!serial && !mac) return null
  return garantirDispositivos(estado).find((d) => {
    if (serial && String(d.serial || '').toLowerCase() === serial) return true
    if (mac) {
      if (normalizarMac(d.deviceId) === mac) return true
      if (normalizarMac(d.mac) === mac) return true
    }
    return false
  })
}

/**
 * ACS de verdade costuma identificar a sessao pelo DeviceId na URL
 * (ex.: /acs/tr069/AA-BB-CC-DD-EE-FF). Esse valor e o MAC do equipamento e
 * sobrevive ao reset de fabrica.
 */
function deviceIdDaUrl(url) {
  const segmentos = url.pathname.split('/').filter(Boolean)
  const ultimo = segmentos[segmentos.length - 1] || ''
  if (!ultimo || ['tr069', 'acs', 'health'].includes(ultimo.toLowerCase())) return ''
  return ultimo
}

/** Localiza o equipamento pelo identificador de provisionamento do provedor. */
function equipamentoPorIdentificador(estado, identificador) {
  const alvo = String(identificador || '').trim().toLowerCase()
  if (!alvo) return null
  return (estado.equipamentos || []).find(
    (e) => String(e.identificador || '').trim().toLowerCase() === alvo,
  )
}

/**
 * Cadastro automatico: um equipamento que chega com identificador valido e
 * ainda nao conhecido entra na frota como "em recuperacao", ja vinculado ao
 * perfil que cobre o modelo. Assim a restauracao funciona mesmo em equipamento
 * novo ou com o serial apagado pelo reset de fabrica.
 */
function cadastrarEquipamentoPorIdentificador(ident) {
  const perfil =
    (lerEstado().perfis || []).find((p) =>
      (p.modelos || []).some(
        (m) => String(m).toLowerCase().replace(/[^a-z0-9]+/g, '') === ident.modelo.replace(/[^a-z0-9]+/g, ''),
      ),
    ) ||
    (lerEstado().perfis || [])[0] ||
    null

  const equipamento = {
    id: `eq-${ident.uid}`,
    serial: ident.uid.toUpperCase(),
    mac: '',
    modelo: ident.modelo,
    fabricante: '',
    tipo: perfil?.tipo || 'roteador',
    clienteId: '',
    perfilId: perfil?.id || '',
    status: 'em-recuperacao',
    ip: '',
    firmware: '',
    firmwareAlvo: '',
    ultimoContato: new Date().toISOString(),
    sincronizadoEm: null,
    configHash: '—',
    restaurado: true,
    tokenRecuperacao: `rcv_${ident.uid.slice(0, 8)}`,
    identificador: ident.bruto,
    grupo: ident.grupo,
    origem: 'cadastro automatico',
  }

  atualizarEstado((estado) => {
    const lista = estado.equipamentos || []
    if (!lista.some((e) => String(e.identificador || '').toLowerCase() === ident.bruto.toLowerCase())) {
      estado.equipamentos = [...lista, equipamento]
    }
    return estado
  })

  registrarEvento(
    'provisionamento',
    `Novo equipamento recebido via bootstrap: ${ident.bruto}`,
    `Grupo ${ident.grupo} · modelo ${ident.modelo} · vinculado ao perfil "${perfil?.nome || 'sem perfil'}".`,
    equipamento.id,
  )

  return equipamento
}

function perfilDoEquipamento(estado, equipamento) {
  if (!equipamento) return null
  return (estado.perfis || []).find((p) => p.id === equipamento.perfilId) || (estado.perfis || [])[0] || null
}

/** Pacote de configuracao entregue ao CPE na restauracao. */
function pacoteDoEquipamento(estado, equipamento, opcoes = {}) {
  const perfil = perfilDoEquipamento(estado, equipamento)
  if (!perfil) return null
  const acsUrl = opcoes.acsUrl || perfil.gestao.acsUrl || ACS_URL_PADRAO
  const params = parametrosDoPerfil({
    perfil,
    branding: estado.branding,
    politica: estado.politica,
    serial: equipamento?.serial || '',
    identificador: equipamento?.identificador || '',
    acsUrl,
    acsUsuario: ACS_USUARIO,
    acsSenha: ACS_SENHA,
  })
  const config = configPlana({
    perfil,
    branding: estado.branding,
    politica: estado.politica,
    serial: equipamento?.serial || '',
    identificador: equipamento?.identificador || '',
    acsUsuario: ACS_USUARIO,
    acsSenha: ACS_SENHA,
  })
  return {
    perfilId: perfil.id,
    perfilNome: perfil.nome,
    modelo: equipamento?.modelo || '',
    identificador: equipamento?.identificador || '',
    acsUrl,
    hash: hashConfig(params),
    parametros: params,
    config,
    uci: comandosUci(config),
    login: {
      pagina: gerarPaginaLogin({
        branding: estado.branding,
        perfil,
        opcoes: {
          plano: (estado.clientes || []).find((c) => c.id === equipamento?.clienteId)?.plano || '',
          nomeCliente: (estado.clientes || []).find((c) => c.id === equipamento?.clienteId)?.nome || '',
        },
      }),
    },
    politica: estado.politica,
    geradoEm: new Date().toISOString(),
  }
}

/** Monta o pacote de implantacao (.tar.gz) de um equipamento. */
function kitDoEquipamento(estado, equipamento, perfil) {
  const script = fs.readFileSync(path.join(RAIZ_AGENTE, 'rfn-bootstrap.sh'), 'utf8')
  const scriptInit = fs.readFileSync(path.join(RAIZ_AGENTE, 'rfn-agent.init'), 'utf8')
  return montarKit({
    estado,
    equipamento,
    perfil,
    branding: estado.branding,
    politica: estado.politica,
    acsUrl: ACS_URL_PADRAO,
    acsUsuario: ACS_USUARIO,
    acsSenha: ACS_SENHA,
    tokenDispositivo: TOKEN_DISPOSITIVO,
    scriptAgente: script,
    scriptInit,
    servidor: ACS_URL_PADRAO.replace(/\/acs\/tr069$/, ''),
  })
}

// ------------------------------------------------------------------- ACS CWMP

async function tratarCwmp(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/acs/health') {
    responderJson(res, 200, { ok: true, servico: 'acs-cwmp', modelo: 'TR-069 CWMP' })
    return
  }
  if (req.method !== 'POST') {
    responderTexto(res, 405, 'metodo nao permitido')
    return
  }
  if (!checarDigest(req, res)) return

  const corpo = await lerCorpo(req)
  const id = cwmp.idSoap(corpo) || crypto.randomBytes(8).toString('hex')
  const tipo = cwmp.tipoMensagem(corpo)
  const estado = lerEstado()

  if (tipo === 'Inform') {
    const inform = cwmp.parseInform(corpo)
    let equipamento = equipamentoPorSerial(estado, inform.serial)

    // MAC sobrevive ao reset de fabrica mesmo quando o serial e apagado.
    if (!equipamento && inform.mac) equipamento = equipamentoPorMac(estado, inform.mac)

    // ProvisioningCode do provedor (grupo::modelo-carimbo-uid) tem precedencia
    // sobre o serial: e o que sobrevive ao reset de fabrica.
    const codigo = inform.parametros.find((p) => /ProvisioningCode$/i.test(p.path))?.value || ''
    const ident = parseIdentificador(codigo)
    if (ident.valido) {
      const porIdentificador = equipamentoPorIdentificador(estado, ident.bruto)
      if (porIdentificador) equipamento = porIdentificador
      else if (!equipamento) equipamento = cadastrarEquipamentoPorIdentificador(ident)
    }

    const dispositivo = dispositivoPorSerialOuMac(estado, inform.serial || inform.deviceId)
    const resetFabrica = (inform.eventos || []).some((e) => /FACTORYRESET/i.test(e.code || ''))

    atualizarEstado((atual) => {
      const lista = garantirDispositivos(atual)
      const existente = lista.find(
        (d) =>
          (inform.serial && String(d.serial).toLowerCase() === String(inform.serial).toLowerCase()) ||
          (inform.deviceId && normalizarMac(d.deviceId) === normalizarMac(inform.deviceId)),
      )
      const registro = {
        serial: inform.serial,
        deviceId: inform.deviceId,
        mac: inform.mac,
        oid: inform.oid,
        modelo: inform.modelo,
        fabricante: inform.fabricante,
        firmware: inform.firmware,
        identificador: ident.valido ? ident.bruto : codigo,
        ultimoContato: new Date().toISOString(),
        parametros: inform.parametros,
        eventos: inform.eventos,
        autenticado: true,
      }
      if (existente) Object.assign(existente, registro)
      else lista.push(registro)

      if (equipamento) {
        const alvo = atual.equipamentos.find((e) => e.id === equipamento.id)
        if (alvo) {
          alvo.ultimoContato = registro.ultimoContato
          alvo.status = resetFabrica ? 'em-recuperacao' : 'online'
          if (inform.firmware) alvo.firmware = inform.firmware
          if (ident.valido) alvo.identificador = ident.bruto
          if (inform.mac && !alvo.mac) alvo.mac = inform.mac
          if (!alvo.serial && inform.serial) alvo.serial = inform.serial
        }
      }
      return atual
    })

    registrarEvento(
      'provisionamento',
      `CPE ${inform.serial}connected ao ACS`,
      `OUI ${inform.oid || '—'} · ${inform.fabricante || '—'} ${inform.modelo || ''} · firmware ${inform.firmware || '—'}`,
      equipamento?.id || null,
    )

    if (resetFabrica) {
      registrarEvento(
        'reset',
        `Reset de fábrica executado em ${inform.serial || 'CPE'}`,
        'O equipamento informou o evento de reset; o ACS reaplicará o perfil do provedor.',
        equipamento?.id || null,
      )
    }

    const comandos = []
    if (equipamento) {
      const pacote = pacoteDoEquipamento(estado, equipamento, { acsUrl: ACS_URL_PADRAO })
      if (pacote) {
        const atual = dispositivo
        // Depois de um reset de fabrica o CPE volta com os parametros de
        // fabrica: o hash guardado deixa de valer como comparacao, e a
        // configuracao do provedor precisa ser reenviada de qualquer forma.
        const divergente =
          resetFabrica || !atual || hashConfig(atual.parametros || []) !== pacote.hash
        if (divergente) {
          comandos.push({ tipo: 'SetParameterValues', parametros: pacote.parametros })
          comandos.push({ tipo: 'Reboot' })
          registrarEvento(
            'restauracao',
            `Configuracao reenviada para ${inform.serial}`,
            `Perfil "${pacote.perfilNome}" · hash ${pacote.hash}. Equipamento reiniciando para aplicar.`,
            equipamento.id,
          )
          atualizarEstado((s) => {
            const eq = (s.equipamentos || []).find((e) => e.id === equipamento.id)
            if (eq) {
              eq.status = 'provisionando'
              eq.sincronizadoEm = new Date().toISOString()
              eq.configHash = pacote.hash
            }
            const disp = garantirDispositivos(s).find((d) => String(d.serial).toLowerCase() === inform.serial.toLowerCase())
            if (disp) disp.hashEsperado = pacote.hash
            return s
          })
        }
      }
    }
    responderTexto(res, 200, cwmp.respostaInform(id, comandos), 'application/xml; charset=utf-8')
    return
  }

  if (tipo === 'GetParameterValues') {
    const caminhos = cwmp.parseGetParameterValues(corpo)
    const identidade =
      url.searchParams.get('serial') || cwmp.serialDoDispositivo(corpo) || deviceIdDaUrl(url)
    const dispositivo = dispositivoPorSerialOuMac(estado, identidade)
    const base = dispositivo?.parametros || []
    const params = caminhos.map((caminho) => {
      const exato = base.find((p) => p.path === caminho)
      if (exato) return { path: caminho, value: exato.value }
      const regex = new RegExp(`^${caminho.replace(/\./g, '\\.').replace(/\*/g, '\\.[^.]+')}$`)
      const encontrado = base.find((p) => regex.test(p.path))
      return { path: caminho, value: encontrado ? encontrado.value : '' }
    })
    responderTexto(res, 200, cwmp.respostaGetParameterValues(id, params), 'application/xml; charset=utf-8')
    return
  }

  if (tipo === 'SetParameterValues') {
    const valores = cwmp.parseSetParameterValues(corpo)
    const identidade =
      url.searchParams.get('serial') || cwmp.serialDoDispositivo(corpo) || deviceIdDaUrl(url)
    const serial = cwmp.serialDoDispositivo(corpo) || identidade
    atualizarEstado((atual) => {
      const lista = garantirDispositivos(atual)
      let dispositivo = dispositivoPorSerialOuMac(atual, identidade)
      if (!dispositivo) {
        dispositivo = {
          serial,
          deviceId: deviceIdDaUrl(url),
          parametros: [],
          ultimoContato: new Date().toISOString(),
        }
        lista.push(dispositivo)
      }
      for (const item of valores) {
        const existente = dispositivo.parametros.find((p) => p.path === item.path)
        if (existente) existente.value = item.value
        else dispositivo.parametros.push({ path: item.path, value: item.value })
      }
      return atual
    })
    responderTexto(res, 200, cwmp.respostaSetParameterValues(id), 'application/xml; charset=utf-8')
    return
  }

  if (tipo === 'Reboot') {
    responderTexto(res, 200, cwmp.respostaReboot(id), 'application/xml; charset=utf-8')
    return
  }

  responderTexto(res, 200, cwmp.respostaVazia(id), 'application/xml; charset=utf-8')
}

// ------------------------------------------------------------------ bootstrap

async function tratarBootstrap(req, res, url) {
  const token = url.searchParams.get('token') || req.headers['x-rfn-token'] || ''
  if (!tokenValido(TOKEN_DISPOSITIVO, token)) {
    responderJson(res, 401, { erro: 'token de dispositivo invalido' })
    return
  }
  const serial = url.searchParams.get('serial') || ''
  const bruto = url.searchParams.get('identificador') || ''
  const mac = url.searchParams.get('mac') || ''
  const estado = lerEstado()
  let equipamento = serial ? equipamentoPorSerial(estado, serial) : null
  if (!equipamento && mac) equipamento = equipamentoPorMac(estado, mac)

  // O CPE pode se identificar pelo identificador de provisionamento do
  // provedor (grupo::modelo-carimbo-uid) em vez do serial de fabrica.
  if (!equipamento && bruto) {
    const ident = parseIdentificador(bruto)
    if (!ident.valido) {
      responderJson(res, 400, { erro: `identificador invalido: ${ident.motivo}`, identificador: bruto })
      return
    }
    equipamento = equipamentoPorIdentificador(estado, ident.bruto)
    if (!equipamento) equipamento = cadastrarEquipamentoPorIdentificador(ident)
  }

  if (!equipamento) {
    responderJson(res, 404, { erro: 'equipamento nao cadastrado', serial, identificador: bruto, mac })
    return
  }

  const pacote = pacoteDoEquipamento(estado, equipamento, { acsUrl: ACS_URL_PADRAO })
  if (!pacote) {
    responderJson(res, 400, { erro: 'equipamento sem perfil de configuracao' })
    return
  }

  const caminho = url.pathname.replace('/bootstrap', '').replace(/^\//, '')

  // Retorno do agente: o equipamento informa que terminou a restauracao.
  if (caminho === 'status' && req.method === 'POST') {
    const corpo = await lerCorpo(req)
    let dados = {}
    try {
      dados = JSON.parse(corpo || '{}')
    } catch {
      responderJson(res, 400, { erro: 'JSON invalido' })
      return
    }
    const estado = lerEstado()
    const serial = dados.serial || ''
    const bruto = dados.identificador || ''
    let equipamento = serial ? equipamentoPorSerial(estado, serial) : null
    if (!equipamento && bruto) {
      const ident = parseIdentificador(bruto)
      if (ident.valido) equipamento = equipamentoPorIdentificador(estado, ident.bruto)
    }
    if (!equipamento && dados.mac) equipamento = equipamentoPorMac(estado, dados.mac)
    const resultado = dados.resultado === 'sucesso' ? 'sucesso' : 'falha'
    if (equipamento) {
      atualizarEstado((s) => {
        const alvo = (s.equipamentos || []).find((e) => e.id === equipamento.id)
        if (alvo) {
          alvo.status = resultado === 'sucesso' ? 'online' : 'em-recuperacao'
          alvo.sincronizadoEm = new Date().toISOString()
          alvo.ultimoContato = new Date().toISOString()
          if (dados.mac && !alvo.mac) alvo.mac = dados.mac
        }
        return s
      })
    }
    registrarEvento(
      resultado === 'sucesso' ? 'restauracao' : 'restauracao',
      `Restauracao no equipamento ${serial || bruto || 'desconhecido'}: ${resultado}`,
      dados.detalhe || (resultado === 'sucesso'
        ? 'O agente aplicou a configuracao do provedor e publicou a tela de login.'
        : 'O agente nao conseguiu aplicar a configuracao; revise o log do equipamento.'),
      equipamento?.id || null,
      resultado,
    )
    responderJson(res, 200, { ok: true, registrado: true })
    return
  }

  // Arquivo de shell: o agente aplica sem precisar de parser JSON.
  if (caminho === 'env') {
    responderTexto(res, 200, exportarEnv(pacote.config), 'text/plain; charset=utf-8')
    return
  }

  // Pagina de login pronta para publicacao no web server do CPE.
  if (caminho === 'login.html') {
    responderTexto(res, 200, pacote.login.pagina, 'text/html; charset=utf-8')
    return
  }

  responderJson(res, 200, {
    serial: equipamento.serial,
    identificador: equipamento.identificador || null,
    modelo: equipamento.modelo,
    firmware: { atual: equipamento.firmware, alvo: equipamento.firmwareAlvo },
    ...pacote,
  })
}

// ------------------------------------------------------------------ painel API

function serializarEstado(estado) {
  return {
    branding: estado.branding,
    perfis: estado.perfis || [],
    clientes: estado.clientes || [],
    equipamentos: estado.equipamentos || [],
    logs: estado.logs || [],
    politica: estado.politica,
    dispositivos: garantirDispositivos(estado),
    servidor: {
      versao: '1.0.0',
      acsUrl: `/acs/tr069`,
      tokenPainel: TOKEN_PAINEL,
      tokenDispositivo: TOKEN_DISPOSITIVO,
      acsUsuario: ACS_USUARIO,
    },
  }
}

async function tratarApi(req, res, url) {
  const rota = url.pathname.replace(/^\/api/, '') || '/'
  const metodo = req.method

  if (rota === '/agente' && metodo === 'GET') {
    const serial = url.searchParams.get('serial') || ''
    const token = url.searchParams.get('token') || TOKEN_DISPOSITIVO
    const esquema = process.env.RFN_TLS_CERT ? 'https' : 'http'
    const origem = `${req.headers.host || `${HOST}:${PORTA}`}`
    const script = fs.readFileSync(path.join(RAIZ_AGENTE, 'rfn-bootstrap.sh'), 'utf8')
    const estado = lerEstado()
    const equipamento = serial ? equipamentoPorSerial(estado, serial) : null
    const conf = [
      '# Configuracao do agente de restauracao (gerado pelo painel).',
      `RFN_SERVER=${esquema}://${origem}`,
      `RFN_TOKEN=${token}`,
      serial ? `RFN_SERIAL=${serial}` : '# RFN_SERIAL=detectado automaticamente',
      equipamento?.identificador
        ? `RFN_IDENTIFICADOR=${equipamento.identificador}`
        : '# RFN_IDENTIFICADOR=<grupo::modelo-carimbo-uid>',
      `RFN_LOGIN_DIR=${url.searchParams.get('dir') || '/www'}`,
      'RFN_LOGIN_ALVOS=/www/webpages/login.html,/usr/www/login.html,/www/login.html',
      `RFN_ACS_URL=${ACS_URL_PADRAO}`,
      '',
    ].join('\n')
    responderTexto(
      res,
      200,
      `${script}\n# --- configuracao gerada pelo painel ---\n${conf}`,
      'text/plain; charset=utf-8',
    )
    return
  }

  if (rota === '/health') {
    responderJson(res, 200, { ok: true, servico: 'rfn-painel', hora: new Date().toISOString() })
    return
  }

  if (rota === '/login.html' && metodo === 'GET') {
    const estado = lerEstado()
    const serial = url.searchParams.get('serial') || ''
    const equipamento = equipamentoPorSerial(estado, serial)
    const perfil = perfilDoEquipamento(estado, equipamento)
    const cliente = (estado.clientes || []).find((c) => c.id === equipamento?.clienteId)
    const html = gerarPaginaLogin({
      branding: estado.branding,
      perfil,
      opcoes: { plano: cliente?.plano || '', nomeCliente: cliente?.nome || '' },
    })
    responderTexto(res, 200, html, 'text/html; charset=utf-8')
    return
  }

  // Sessoes do painel servido pelo proprio servidor: quando a origem da
  // requisicao e a mesma do servidor, o navegador ja tem acesso de rede ao
  // painel, entao o token e devolvido para que a aba Conexao funcione sem
  // colar nada. Requisicoes de terceiros continuam exigindo o token.
  if (rota === '/sessao' && metodo === 'GET') {
    const host = String(req.headers.host || '')
    const origem = String(req.headers.origin || '')
    const referer = String(req.headers.referer || '')
    const hostNome = host.split(':')[0]
    const loopback = ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostNome)
    const privada =
      /^10\./.test(hostNome) ||
      /^192\.168\./.test(hostNome) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostNome)
    const mesma = [origem, referer]
      .filter(Boolean)
      .some((valor) => {
        try {
          const alvo = new URL(valor)
          if (alvo.hostname !== hostNome) return false
          // Mesma porta: o painel servido pelo proprio servidor.
          if (alvo.host === host) return true
          // Outra porta: aceito apenas em rede interna, onde o painel em
          // desenvolvimento e o servidor ficam na mesma maquina.
          return loopback || privada
        } catch {
          return false
        }
      })
    if (!mesma && !autorizadoPainel(req)) {
      responderJson(res, 403, { erro: 'sessao disponivel apenas para o painel servido pelo servidor' })
      return
    }
    const esquema =
      process.env.RFN_TLS_CERT && process.env.RFN_TLS_KEY ? 'https' : 'http'
    responderJson(res, 200, {
      ok: true,
      urlBase: `${esquema}://${host}`,
      token: TOKEN_PAINEL,
      mesmaOrigem: mesma,
    })
    return
  }

  if (!exigePainel(req, res)) return

  // ---------------------------------------------------------------- varredura
  // A varredura roda no servidor do provedor (e nao no navegador): e ele que
  // enxerga a rede dos equipamentos.

  if (rota === '/rede/redes' && metodo === 'GET') {
    responderJson(res, 200, { redes: varredura.redesLocais(), portasPadrao: varredura.PORTAS_PADRAO })
    return
  }

  if (rota === '/rede/varreduras' && metodo === 'GET') {
    responderJson(res, 200, { varreduras: varredura.listarVarreduras() })
    return
  }

  // Descoberta UPnP/SSDP: acha equipamentos que se anunciam na rede, mesmo
  // sem porta aberta para varredura. Somente leitura.
  if (rota === '/rede/descobrir' && metodo === 'POST') {
    const hosts = await varredura.descobrirRede({ timeoutMs: 4000 })
    const trabalho = varredura.registrarDescoberta(hosts)
    registrarEvento(
      'provisionamento',
      'Descoberta UPnP/SSDP concluida',
      `${hosts.length} equipamento(s) anunciado(s) na rede local.`,
    )
    responderJson(res, 200, trabalho)
    return
  }

  if (rota === '/rede/varredura' && metodo === 'POST') {
    const corpo = JSON.parse(await lerCorpo(req))
    const redes = varredura.redesLocais()
    let cidr = String(corpo.cidr || '').trim()
    if (!cidr && redes.length) cidr = redes[0].cidr
    if (!cidr) {
      responderJson(res, 400, { erro: 'informe a faixa CIDR a varrer', sugestao: '' })
      return
    }
    const trabalho = varredura.iniciarVarredura({
      cidr,
      portas: corpo.portas,
      timeoutMs: corpo.timeoutMs,
      limite: corpo.limite,
      concorrencia: corpo.concorrencia,
      ssdp: corpo.ssdp !== false,
      acsUsuario: ACS_USUARIO,
      acsSenha: ACS_SENHA,
    })
    if (trabalho.erro) {
      responderJson(res, 400, { erro: trabalho.erro })
      return
    }
    registrarEvento(
      'provisionamento',
      `Varredura de rede iniciada em ${cidr}`,
      `Trabalho ${trabalho.id} · ${trabalho.total} enderecos · portas ${trabalho.portas.join(', ')}.`,
    )
    responderJson(res, 202, trabalho)
    return
  }

  if (rota.startsWith('/rede/varredura/') && rota.endsWith('/importar') && metodo === 'POST') {
    const id = rota.split('/')[3]
    const trabalho = varredura.obterVarredura(id)
    if (!trabalho) {
      responderJson(res, 404, { erro: 'varredura nao encontrada' })
      return
    }
    const estado = lerEstado()
    const criados = []
    const atualizados = []
    for (const host of trabalho.hosts) {
      const mac = normalizarMac(host.mac)
      const serial = String(host.serial || '').trim()
      const existente = (estado.equipamentos || []).find((e) => {
        if (mac && normalizarMac(e.mac) === mac) return true
        if (serial && String(e.serial || '').toLowerCase() === serial.toLowerCase()) return true
        return false
      })
      if (existente) {
        atualizados.push(existente.id)
        continue
      }
      const perfil =
        (estado.perfis || []).find((p) =>
          (p.modelos || []).some((m) => {
            const alvo = String(m).toLowerCase().replace(/[^a-z0-9]+/g, '')
            const achado = `${host.fabricante} ${host.modelo}`.toLowerCase().replace(/[^a-z0-9]+/g, '')
            return alvo && achado.includes(alvo)
          }),
        ) ||
        (estado.perfis || [])[0] ||
        null
      const novo = {
        id: `eq-scan-${host.ip.replace(/\./g, '-')}`,
        serial: serial || mac || `IP-${host.ip.replace(/\./g, '-')}`,
        mac: host.mac || '',
        modelo: host.modelo || host.fabricante || '',
        fabricante: host.fabricante || '',
        tipo: perfil?.tipo || 'roteador',
        clienteId: '',
        perfilId: perfil?.id || '',
        status: 'em-recuperacao',
        ip: host.ip,
        firmware: host.firmware || '',
        firmwareAlvo: '',
        ultimoContato: new Date().toISOString(),
        sincronizadoEm: null,
        configHash: '—',
        restaurado: false,
        tokenRecuperacao: `rcv_${Math.random().toString(16).slice(2, 10)}`,
        identificador: '',
        grupo: '',
        origem: 'varredura de rede',
      }
      criados.push(novo)
    }
    if (criados.length) {
      atualizarEstado((s) => {
        s.equipamentos = [...(s.equipamentos || []), ...criados]
        return s
      })
    }
    registrarEvento(
      'provisionamento',
      `Varredura ${id} importada para a frota`,
      `${criados.length} equipamento(s) novo(s) · ${atualizados.length} ja conhecido(s).`,
    )
    responderJson(res, 200, { ok: true, criados: criados.length, jaConhecidos: atualizados.length, ids: criados.map((c) => c.id) })
    return
  }

  if (rota.startsWith('/rede/varredura/') && metodo === 'GET') {
    const id = rota.split('/')[3]
    const trabalho = varredura.obterVarredura(id)
    if (!trabalho) {
      responderJson(res, 404, { erro: 'varredura nao encontrada' })
      return
    }
    responderJson(res, 200, trabalho)
    return
  }

  if (rota.startsWith('/rede/varredura/') && metodo === 'DELETE') {
    const id = rota.split('/')[3]
    const trabalho = varredura.cancelarVarredura(id)
    if (!trabalho) {
      responderJson(res, 404, { erro: 'varredura nao encontrada' })
      return
    }
    responderJson(res, 200, trabalho)
    return
  }

  if (rota === '/estado' && metodo === 'GET') {
    responderJson(res, 200, serializarEstado(lerEstado()))
    return
  }

  if (rota === '/estado' && (metodo === 'PUT' || metodo === 'POST')) {
    const corpo = await lerCorpo(req)
    let dados
    try {
      dados = JSON.parse(corpo)
    } catch {
      responderJson(res, 400, { erro: 'JSON invalido' })
      return
    }
    const atual = lerEstado()
    const mesclado = { ...atual, ...dados }
    // Listas sao mescladas por id: o painel nunca apaga o identificador de
    // provisionamento nem o estado de restauro que o servidor ja conhece.
    for (const lista of ['equipamentos', 'clientes', 'perfis']) {
      if (!Array.isArray(dados[lista])) continue
      const anteriores = atual[lista] || []
      mesclado[lista] = dados[lista].map((item) => {
        const anterior = anteriores.find((e) => e.id === item.id)
        if (!anterior) return item
        return {
          ...anterior,
          ...item,
          identificador: item.identificador ?? anterior.identificador,
          grupo: item.grupo ?? anterior.grupo,
        }
      })
    }
    salvarEstado(mesclado)
    registrarEvento('provisionamento', 'Estado sincronizado pelo painel', 'Branding, perfis e politica atualizados.')
    responderJson(res, 200, serializarEstado(lerEstado()))
    return
  }

  if (rota === '/branding' && metodo === 'PATCH') {
    const patch = JSON.parse(await lerCorpo(req))
    atualizarEstado((estado) => {
      estado.branding = { ...estado.branding, ...patch }
      return estado
    })
    responderJson(res, 200, serializarEstado(lerEstado()))
    return
  }

  if (rota === '/politica' && metodo === 'PATCH') {
    const patch = JSON.parse(await lerCorpo(req))
    atualizarEstado((estado) => {
      estado.politica = { ...estado.politica, ...patch }
      return estado
    })
    responderJson(res, 200, serializarEstado(lerEstado()))
    return
  }

  if (rota === '/perfis' && metodo === 'PUT') {
    const perfil = JSON.parse(await lerCorpo(req))
    atualizarEstado((estado) => {
      const lista = estado.perfis || []
      const indice = lista.findIndex((p) => p.id === perfil.id)
      if (indice >= 0) lista[indice] = perfil
      else lista.push(perfil)
      estado.perfis = lista
      return estado
    })
    responderJson(res, 200, serializarEstado(lerEstado()))
    return
  }

  if (rota.startsWith('/perfis/') && metodo === 'DELETE') {
    const id = rota.split('/')[2]
    atualizarEstado((estado) => {
      estado.perfis = (estado.perfis || []).filter((p) => p.id !== id)
      return estado
    })
    responderJson(res, 200, serializarEstado(lerEstado()))
    return
  }

  if (rota.startsWith('/equipamentos/') && rota.endsWith('/sincronizar') && metodo === 'POST') {
    const id = rota.split('/')[2]
    const estado = lerEstado()
    const equipamento = (estado.equipamentos || []).find((e) => e.id === id)
    if (!equipamento) {
      responderJson(res, 404, { erro: 'equipamento nao encontrado' })
      return
    }
    const pacote = pacoteDoEquipamento(estado, equipamento, { acsUrl: ACS_URL_PADRAO })
    if (!pacote) {
      responderJson(res, 400, { erro: 'equipamento sem perfil associado' })
      return
    }
    const dispositivo = dispositivoPorSerial(estado, equipamento.serial)
    const divergente = !dispositivo || dispositivo.hashEsperado !== pacote.hash
    if (dispositivo) {
      dispositivo.hashEsperado = pacote.hash
      dispositivo.parametros = pacote.parametros
      dispositivo.ultimoContato = new Date().toISOString()
    }
    atualizarEstado((s) => {
      const eq = (s.equipamentos || []).find((e) => e.id === id)
      if (eq) {
        eq.sincronizadoEm = new Date().toISOString()
        eq.configHash = pacote.hash
        eq.status = divergente ? 'provisionando' : 'online'
      }
      return s
    })
    registrarEvento(
      'provisionamento',
      `Sincronizacao solicitada para ${equipamento.serial}`,
      divergente
        ? `Perfil "${pacote.perfilNome}" enviado. Hash ${pacote.hash}.`
        : `Configuracao ja identica (hash ${pacote.hash}).`,
      equipamento.id,
      divergente ? 'pendente' : 'sucesso',
    )
    responderJson(res, 200, { ok: true, divergente, hash: pacote.hash, pacote })
    return
  }

  if (rota.startsWith('/equipamentos/') && rota.endsWith('/kit') && metodo === 'GET') {
    const id = rota.split('/')[2]
    const estado = lerEstado()
    const equipamento = (estado.equipamentos || []).find((e) => e.id === id)
    if (!equipamento) {
      responderJson(res, 404, { erro: 'equipamento nao encontrado' })
      return
    }
    const perfil = perfilDoEquipamento(estado, equipamento)
    if (!perfil) {
      responderJson(res, 400, { erro: 'equipamento sem perfil de configuracao' })
      return
    }
    const kit = kitDoEquipamento(estado, equipamento, perfil)
    registrarEvento(
      'provisionamento',
      `Kit de implantacao gerado para ${equipamento.serial}`,
      `Perfil "${perfil.nome}" · hash ${kit.hash} · ${kit.arquivos.length} arquivos.`,
      equipamento.id,
    )
    responderBinario(
      res,
      200,
      kit.gzip,
      `kit-${equipamento.serial || equipamento.id}.tar.gz`,
      'application/gzip',
    )
    return
  }

  if (rota.startsWith('/equipamentos/') && rota.endsWith('/kit-arquivos') && metodo === 'GET') {
    const id = rota.split('/')[2]
    const estado = lerEstado()
    const equipamento = (estado.equipamentos || []).find((e) => e.id === id)
    if (!equipamento) {
      responderJson(res, 404, { erro: 'equipamento nao encontrado' })
      return
    }
    const perfil = perfilDoEquipamento(estado, equipamento)
    if (!perfil) {
      responderJson(res, 400, { erro: 'equipamento sem perfil de configuracao' })
      return
    }
    const kit = kitDoEquipamento(estado, equipamento, perfil)
    responderJson(res, 200, { hash: kit.hash, arquivos: kit.arquivos, conteudo: kit.conteudo })
    return
  }

  if (rota.startsWith('/equipamentos/') && rota.endsWith('/reiniciar') && metodo === 'POST') {
    const id = rota.split('/')[2]
    const estado = lerEstado()
    const equipamento = (estado.equipamentos || []).find((e) => e.id === id)
    if (!equipamento) {
      responderJson(res, 404, { erro: 'equipamento nao encontrado' })
      return
    }
    atualizarEstado((s) => {
      const eq = (s.equipamentos || []).find((e) => e.id === id)
      if (eq) eq.status = 'provisionando'
      return s
    })
    registrarEvento('reset', `Reinicio remoto aplicado em ${equipamento.serial}`, 'Comando de reboot enviado ao CPE.')
    responderJson(res, 200, { ok: true })
    return
  }

  if (rota === '/identificador' && metodo === 'GET') {
    const bruto = url.searchParams.get('valor') || ''
    const ident = parseIdentificador(bruto)
    const estado = lerEstado()
    const equipamento = ident.valido ? equipamentoPorIdentificador(estado, ident.bruto) : null
    responderJson(res, 200, {
      ...ident,
      equipamento: equipamento ? { id: equipamento.id, serial: equipamento.serial, status: equipamento.status } : null,
    })
    return
  }

  if (rota.startsWith('/equipamentos/') && rota.endsWith('/identificador') && metodo === 'POST') {
    const id = rota.split('/')[2]
    const bruto = String((await lerCorpo(req)) || '').trim()
    let valor = bruto
    try {
      const dados = JSON.parse(bruto)
      valor = String(dados.identificador ?? bruto).trim()
    } catch {
      /* corpo em texto puro */
    }
    const ident = parseIdentificador(valor)
    if (!ident.valido) {
      responderJson(res, 400, { erro: `identificador invalido: ${ident.motivo}`, valor })
      return
    }
    const estado = lerEstado()
    const equipamento = (estado.equipamentos || []).find((e) => e.id === id)
    if (!equipamento) {
      responderJson(res, 404, { erro: 'equipamento nao encontrado' })
      return
    }
    const outro = equipamentoPorIdentificador(estado, ident.bruto)
    if (outro && outro.id !== id) {
      responderJson(res, 409, { erro: 'identificador ja vinculado a outro equipamento', equipamentoId: outro.id })
      return
    }
    atualizarEstado((s) => {
      const alvo = (s.equipamentos || []).find((e) => e.id === id)
      if (alvo) {
        alvo.identificador = ident.bruto
        alvo.grupo = ident.grupo
        if (!alvo.modelo) alvo.modelo = ident.modelo
      }
      return s
    })
    registrarEvento(
      'provisionamento',
      `Identificador vinculado a ${equipamento.serial}`,
      `${ident.bruto} · grupo ${ident.grupo} · modelo ${ident.modelo}.`,
      id,
    )
    responderJson(res, 200, serializarEstado(lerEstado()))
    return
  }

  if (rota === '/equipamentos' && metodo === 'POST') {
    const corpo = JSON.parse(await lerCorpo(req))
    const serial = String(corpo.serial || '').trim()
    const identificador = String(corpo.identificador || '').trim()
    if (!serial && !identificador) {
      responderJson(res, 400, { erro: 'informe o serial ou o identificador de provisionamento' })
      return
    }
    let ident = null
    if (identificador) {
      ident = parseIdentificador(identificador)
      if (!ident.valido) {
        responderJson(res, 400, { erro: `identificador invalido: ${ident.motivo}`, identificador })
        return
      }
    }
    const estado = lerEstado()
    let existente = serial ? equipamentoPorSerial(estado, serial) : null
    if (!existente && ident) existente = equipamentoPorIdentificador(estado, ident.bruto)
    if (existente) {
      responderJson(res, 409, { erro: 'equipamento ja cadastrado', id: existente.id })
      return
    }
    const perfil =
      (estado.perfis || []).find((p) => p.id === corpo.perfilId) || (estado.perfis || [])[0] || null
    const novo = {
      id: ident ? `eq-${ident.uid}` : `eq-${Date.now().toString(36)}`,
      serial: serial || (ident ? ident.uid.toUpperCase() : ''),
      mac: corpo.mac || '',
      modelo: corpo.modelo || (ident ? ident.modelo : ''),
      fabricante: corpo.fabricante || '',
      tipo: corpo.tipo || perfil?.tipo || 'roteador',
      clienteId: corpo.clienteId || '',
      perfilId: perfil?.id || '',
      status: 'em-recuperacao',
      ip: '',
      firmware: '',
      firmwareAlvo: corpo.firmwareAlvo || '',
      ultimoContato: null,
      sincronizadoEm: null,
      configHash: '—',
      restaurado: true,
      tokenRecuperacao: `rcv_${Math.random().toString(16).slice(2, 10)}`,
      identificador: ident ? ident.bruto : '',
      grupo: ident ? ident.grupo : '',
      origem: 'cadastro manual',
    }
    atualizarEstado((s) => {
      s.equipamentos = [...(s.equipamentos || []), novo]
      return s
    })
    registrarEvento(
      'provisionamento',
      `Equipamento ${novo.serial} cadastrado`,
      `Perfil "${perfil?.nome || 'sem perfil'}" vinculado. Restauracao pos-reset ativa.`,
      novo.id,
    )
    responderJson(res, 201, { ok: true, equipamento: novo })
    return
  }

  if (rota === '/dhcp-info' && metodo === 'GET') {
    const estado = lerEstado()
    const perfis = (estado.perfis || []).map((p) => ({
      id: p.id,
      nome: p.nome,
      modelo: (p.modelos || [])[0] || '',
      metodoRestore: p.gestao.metodoRestore,
      dhcpOption43: p.gestao.dhcpOption43 || '',
      dhcpOption60: p.gestao.dhcpOption60 || '',
    }))
    responderJson(res, 200, {
      acsUrl: ACS_URL_PADRAO,
      acsUsuario: ACS_USUARIO,
      tokenDispositivo: TOKEN_DISPOSITIVO,
      perfis,
      exemploDhcpd: [
        '# /etc/dhcp/dhcpd.conf — o CPE encontra o ACS do provedor',
        'option vendor-encapsulated-options 43;',
        `option vendor-encapsulated-options ${ACS_URL_PADRAO};`,
        `set vendor-class-identifier = "${perfis[0]?.dhcpOption60 || 'FibraSul-CPE'}";`,
      ].join('\n'),
      exemploUci: [
        '# /etc/config/dhcp — apontar o CPE para o ACS do provedor',
        `option dhcp_option 43, '${ACS_URL_PADRAO}'`,
        `option dhcp_option 60, '${perfis[0]?.dhcpOption60 || 'FibraSul-CPE'}'`,
      ].join('\n'),
    })
    return
  }

  if (rota === '/firmware' && metodo === 'GET') {
    garantirDir(DIR_FIRMWARE)
    const arquivos = fs.readdirSync(DIR_FIRMWARE).filter((n) => !n.startsWith('.'))
    responderJson(res, 200, { arquivos })
    return
  }

  if (rota === '/firmware' && metodo === 'POST') {
    const corpo = JSON.parse(await lerCorpo(req))
    const nome = path.basename(String(corpo.nome || '')).replace(/[^A-Za-z0-9._-]/g, '_')
    if (!nome) {
      responderJson(res, 400, { erro: 'informe o nome do arquivo' })
      return
    }
    const conteudo = Buffer.from(String(corpo.conteudoBase64 || ''), 'base64')
    if (!conteudo.length) {
      responderJson(res, 400, { erro: 'arquivo vazio' })
      return
    }
    garantirDir(DIR_FIRMWARE)
    fs.writeFileSync(path.join(DIR_FIRMWARE, nome), conteudo)
    const url = `${ACS_URL_PADRAO.replace(/\/acs\/tr069$/, '')}/firmware/${nome}?token=${TOKEN_DISPOSITIVO}`
    registrarEvento('firmware', `Firmware ${nome} publicado`, `Disponivel para download em ${url}.`)
    responderJson(res, 201, { ok: true, nome, bytes: conteudo.length, url })
    return
  }

  if (rota.startsWith('/firmware/') && metodo === 'DELETE') {
    const nome = path.basename(rota.split('/')[2] || '')
    const alvo = path.join(DIR_FIRMWARE, nome)
    if (nome && fs.existsSync(alvo)) fs.unlinkSync(alvo)
    responderJson(res, 200, { ok: true })
    return
  }

  if (rota === '/identificador/gerar' && metodo === 'POST') {
    const corpo = JSON.parse(await lerCorpo(req))
    const valor = formatarIdentificador({
      grupo: corpo.grupo,
      modelo: corpo.modelo,
      uid: corpo.uid,
      carimbo: corpo.carimbo,
    })
    responderJson(res, 200, { identificador: valor, ...parseIdentificador(valor) })
    return
  }

  if (rota === '/exportar' && metodo === 'GET') {
    const estado = lerEstado()
    responderJson(res, 200, {
      exportadoEm: new Date().toISOString(),
      branding: estado.branding,
      perfis: estado.perfis,
      clientes: estado.clientes,
      equipamentos: estado.equipamentos,
      politica: estado.politica,
    })
    return
  }

  if (rota === '/importar' && metodo === 'POST') {
    const dados = JSON.parse(await lerCorpo(req))
    salvarEstado({ ...lerEstado(), ...dados })
    registrarEvento('provisionamento', 'Configuracao importada', 'Arquivo JSON aplicado no servidor.')
    responderJson(res, 200, serializarEstado(lerEstado()))
    return
  }

  if (rota === '/pacote.zip' && metodo === 'GET') {
    const pacote = montarPacote({ raiz: RAIZ, versao: '1.0.0' })
    registrarEvento(
      'provisionamento',
      'Pacote de instalacao (zip) gerado',
      `${pacote.arquivos.length} arquivos · ${(pacote.bytesZip / 1024).toFixed(0)} kB comprimidos.`,
    )
    responderBinario(
      res,
      200,
      pacote.zip,
      `rfn-painel-${pacote.versao}.zip`,
      'application/zip',
    )
    return
  }

  if (rota === '/pacote' && metodo === 'GET') {
    const pacote = montarPacote({ raiz: RAIZ, versao: '1.0.0' })
    registrarEvento(
      'provisionamento',
      'Pacote de instalacao do painel gerado',
      `${pacote.arquivos.length} arquivos · ${(pacote.bytes / 1024).toFixed(0)} kB comprimidos.`,
    )
    responderBinario(res, 200, pacote.gzip, `rfn-painel-${pacote.versao}.tar.gz`, 'application/gzip')
    return
  }

  responderJson(res, 404, { erro: `rota nao encontrada: ${metodo} ${rota}` })
}

// --------------------------------------------------------------- arquivos estaticos

/**
 * Serve os firmwares publicados para download pelo CPE. O download exige o
 * token do dispositivo: a URL e published no Device.X.Firmware.1.DownloadURL
 * e chega ao equipamento por TR-069.
 */
function servirFirmware(req, res, url) {
  const nome = path.basename(url.pathname.replace('/firmware/', ''))
  const token = url.searchParams.get('token') || ''
  const autorizado =
    tokenValido(TOKEN_DISPOSITIVO, token) ||
    validarDigest(req.headers.authorization || '', req.method, req.url)
  if (!autorizado) {
    res.writeHead(401, { 'www-authenticate': desafioDigest(crypto.randomBytes(16).toString('hex')) })
    res.end('token de dispositivo invalido')
    return
  }
  const alvo = path.join(DIR_FIRMWARE, nome)
  if (!nome || !fs.existsSync(alvo)) {
    responderTexto(res, 404, 'firmware nao encontrado')
    return
  }
  const dados = fs.readFileSync(alvo)
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': dados.length,
  })
  res.end(dados)
}

function servirEstatico(req, res, url) {
  if (!fs.existsSync(DIR_DIST)) {
    responderJson(res, 404, {
      erro: 'painel nao compilado',
      dica: 'rode "npm run build" e sirva a pasta dist pelo mesmo servidor',
    })
    return
  }
  let caminho = decodeURIComponent(url.pathname)
  if (caminho === '/') caminho = '/index.html'
  const alvo = path.join(DIR_DIST, path.normalize(caminho).replace(/^([/\\])+/, ''))
  if (!alvo.startsWith(DIR_DIST)) {
    responderTexto(res, 403, 'acesso negado')
    return
  }
  fs.readFile(alvo, (erro, dados) => {
    if (erro) {
      fs.readFile(path.join(DIR_DIST, 'index.html'), (erro2, fallback) => {
        if (erro2) {
          responderTexto(res, 404, 'nao encontrado')
          return
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(fallback)
      })
      return
    }
    const ext = path.extname(alvo).toLowerCase()
    const tipo =
      Object.entries(TIPOS).find(([chave]) => chave.endsWith(ext) || ext === `.${TIPOS[chave]}`)?.[0] ||
      'application/octet-stream'
    res.writeHead(200, { 'content-type': tipo })
    res.end(dados)
  })
}

// ----------------------------------------------------------------------- servidor

const manipulador = async (req, res) => {
  const inicio = Date.now()
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  res.on('finish', () => {
    log(`${req.method} ${url.pathname} -> ${res.statusCode} (${Date.now() - inicio}ms)`)
  })

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, authorization, x-rfn-token',
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    })
    res.end()
    return
  }

  try {
    if (url.pathname.startsWith('/acs/')) {
      await tratarCwmp(req, res, url)
      return
    }
    if (url.pathname === '/bootstrap' || url.pathname.startsWith('/bootstrap/')) {
      await tratarBootstrap(req, res, url)
      return
    }
    if (url.pathname.startsWith('/firmware/')) {
      servirFirmware(req, res, url)
      return
    }
    if (url.pathname.startsWith('/api/')) {
      await tratarApi(req, res, url)
      return
    }
    servirEstatico(req, res, url)
  } catch (erro) {
    log('erro nao tratado:', erro)
    responderJson(res, 500, { erro: erro.message })
  }
}

const usarTls = Boolean(process.env.RFN_TLS_CERT && process.env.RFN_TLS_KEY)
const servidor = usarTls
  ? https.createServer(
      {
        cert: fs.readFileSync(process.env.RFN_TLS_CERT),
        key: fs.readFileSync(process.env.RFN_TLS_KEY),
      },
      manipulador,
    )
  : http.createServer(manipulador)

servidor.listen(PORTA, HOST, () => {
  const esquema = usarTls ? 'https' : 'http'
  log(`painel + ACS no ar em ${esquema}://${HOST}:${PORTA}`)
  log(`ACS TR-069: ${ACS_URL_PADRAO} (usuario ${ACS_USUARIO})`)
  log(`bootstrap do CPE: ${esquema}://${HOST}:${PORTA}/bootstrap?serial=<serial>&token=<token>`)
  log(`pagina de login: ${esquema}://${HOST}:${PORTA}/bootstrap/login.html?serial=<serial>&token=<token>`)
  log(`firmwares: ${DIR_FIRMWARE}`)
  log(`token do painel: ${TOKEN_PAINEL}`)
  log(`token do dispositivo: ${TOKEN_DISPOSITIVO}`)
})
