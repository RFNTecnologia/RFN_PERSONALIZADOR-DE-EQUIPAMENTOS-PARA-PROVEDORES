#!/usr/bin/env node
/**
 * Verificacao de ponta a ponta do servidor do provedor.
 *
 * Sobe uma instancia isolada do servidor (porta e pasta de dados temporarias),
 * exercita a API e a varredura de rede contra a propria maquina e relata o
 * que passou ou falhou. Nao toca em nenhum equipamento de verdade: a varredura
 * de teste roda em 127.0.0.1/30, ou seja, apenas no proprio servidor.
 *
 * Uso:  node server/verificar.mjs
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const PORTA = Number(process.env.RFN_VERIFICAR_PORTA || 8099)
const BASE = `http://127.0.0.1:${PORTA}`
const RAIZ = path.resolve(aqui, '..')

const resultados = []
let falhas = 0

function ok(nome, detalhe = '') {
  resultados.push({ nome, ok: true, detalhe })
  console.log(`  OK   ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
}

function falha(nome, detalhe = '') {
  falhas += 1
  resultados.push({ nome, ok: false, detalhe })
  console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
}

async function esperarServidor(tentativas = 60) {
  for (let i = 0; i < tentativas; i += 1) {
    try {
      const resposta = await fetch(`${BASE}/api/health`)
      if (resposta.ok) return true
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

async function json(caminho, opcoes = {}, token = '') {
  const cabecalhos = { accept: 'application/json', ...(opcoes.headers || {}) }
  if (token) cabecalhos.authorization = `Bearer ${token}`
  if (opcoes.corpo) cabecalhos['content-type'] = 'application/json'
  const resposta = await fetch(`${BASE}${caminho}`, {
    ...opcoes,
    headers: cabecalhos,
    body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
  })
  let dados = null
  try {
    dados = await resposta.json()
  } catch {
    /* resposta sem json */
  }
  return { status: resposta.status, dados }
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfn-verificar-'))
const filho = spawn(process.execPath, [path.join(RAIZ, 'server', 'index.mjs')], {
  env: {
    ...process.env,
    RFN_PORT: String(PORTA),
    RFN_HOST: '127.0.0.1',
    RFN_DATA_DIR: dataDir,
    RFN_TOKEN: 'token-de-teste',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

const saidaServidor = []
filho.stdout.on('data', (d) => saidaServidor.push(d.toString()))
filho.stderr.on('data', (d) => saidaServidor.push(d.toString()))

console.log('Verificando o servidor do provedor...\n')

try {
  if (!(await esperarServidor())) {
    falha('servidor sobe', 'nao respondeu /api/health a tempo')
    throw new Error('servidor indisponivel')
  }
  ok('servidor sobe', BASE)

  // 1. Sessao automatica (painel servido pelo proprio servidor).
  const sessao = await json('/api/sessao', { headers: { referer: `${BASE}/` } })
  if (sessao.status === 200 && sessao.dados?.token) {
    ok('sessao automatica', 'token devolvido sem colar na mao')
  } else {
    falha('sessao automatica', `status ${sessao.status}`)
  }

  const token = sessao.dados?.token || 'token-de-teste'

  // 2. Exige token nas rotas do painel.
  const semToken = await json('/api/rede/redes')
  if (semToken.status === 401) ok('rota protegida sem token', '401 como esperado')
  else falha('rota protegida sem token', `status ${semToken.status}`)

  // 3. Redes alcancaveis.
  const redes = await json('/api/rede/redes', {}, token)
  if (redes.status === 200 && Array.isArray(redes.dados?.redes)) {
    ok('redes do servidor', `${redes.dados.redes.length} faixa(s)`)
  } else {
    falha('redes do servidor', `status ${redes.status}`)
  }

  // 4. Varredura real contra a propria maquina (127.0.0.1/30).
  const inicio = await json('/api/rede/varredura', { method: 'POST', corpo: { cidr: '127.0.0.1/30', portas: [PORTA] } }, token)
  if (inicio.status !== 200 || !inicio.dados?.id) {
    falha('varredura inicia', `status ${inicio.status}`)
  } else {
    ok('varredura inicia', inicio.dados.cidr)
    let estado = inicio.dados
    for (let i = 0; i < 80 && estado.estado === 'rodando'; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const consulta = await json(`/api/rede/varredura/${inicio.dados.id}`, {}, token)
      estado = consulta.dados || estado
    }
    if (estado.estado === 'concluida' && estado.encontrados >= 1) {
      const host = estado.hosts[0]
      ok('varredura encontra o host', `${host.ip} · ${host.mac || 'sem mac'} · ${host.portas.join(',')}`)
    } else {
      falha('varredura encontra o host', `estado ${estado.estado}, ${estado.encontrados} encontrado(s)`)
    }

    // 5. Historico persistido.
    const historico = await json('/api/rede/varreduras', {}, token)
    if (historico.status === 200 && (historico.dados?.varreduras || []).length >= 1) {
      ok('historico de varreduras', 'gravado no servidor')
    } else {
      falha('historico de varreduras', `status ${historico.status}`)
    }
    const arquivoHistorico = path.join(dataDir, 'varreduras.json')
    if (fs.existsSync(arquivoHistorico)) ok('historico em disco', arquivoHistorico)
    else falha('historico em disco', 'arquivo varreduras.json ausente')

    // 6. Importacao para a frota.
    const importacao = await json(`/api/rede/varredura/${inicio.dados.id}/importar`, { method: 'POST' }, token)
    if (importacao.status === 200 && importacao.dados?.ok) {
      ok('importar para a frota', `${importacao.dados.criados} criado(s), ${importacao.dados.jaConhecidos} já conhecido(s)`)
    } else {
      falha('importar para a frota', `status ${importacao.status}`)
    }
  }

  // 7. Descoberta UPnP/SSDP (pode nao haver nenhum equipamento anunciando).
  const descoberta = await json('/api/rede/descobrir', { method: 'POST', corpo: {} }, token)
  if (descoberta.status === 200 && Array.isArray(descoberta.dados?.hosts)) {
    ok('descoberta UPnP/SSDP', `${descoberta.dados.hosts.length} equipamento(s) anunciado(s)`)
  } else {
    falha('descoberta UPnP/SSDP', `status ${descoberta.status}`)
  }

  // 8. Pacote de instalacao para download (tar.gz e zip).
  const pacote = await fetch(`${BASE}/api/pacote`, { headers: { authorization: `Bearer ${token}` } })
  const bytes = (await pacote.arrayBuffer()).byteLength
  if (pacote.ok && bytes > 1000) ok('pacote do servidor (.tar.gz)', `${(bytes / 1024).toFixed(0)} KB para download`)
  else falha('pacote do servidor (.tar.gz)', `status ${pacote.status}, ${bytes} bytes`)

  const pacoteZip = await fetch(`${BASE}/api/pacote.zip`, { headers: { authorization: `Bearer ${token}` } })
  const bufferZip = Buffer.from(await pacoteZip.arrayBuffer())
  const assinaturaZip = bufferZip.length > 4 && bufferZip[0] === 0x50 && bufferZip[1] === 0x4b
  if (pacoteZip.ok && assinaturaZip) {
    ok('pacote do servidor (.zip)', `${(bufferZip.length / 1024).toFixed(0)} KB para download`)
  } else {
    falha('pacote do servidor (.zip)', `status ${pacoteZip.status}, ${bufferZip.length} bytes`)
  }

  // 9. Kit de implantacao por equipamento (sem equipamento: apenas checa a rota).
  const kit = await json('/api/equipamentos/inexistente/kit', {}, token)
  if (kit.status === 404 || kit.status === 400) ok('rota de kit responde', `status ${kit.status}`)
  else falha('rota de kit responde', `status ${kit.status}`)
} catch (erro) {
  if (falhas === 0) falha('execucao', erro.message)
} finally {
  filho.kill('SIGTERM')
  fs.rmSync(dataDir, { recursive: true, force: true })
}

console.log(`\n${falhas === 0 ? 'Tudo certo' : `${falhas} verificacao(oes) falharam`} — ${resultados.length} checagens.`)
if (falhas > 0) {
  console.log('\nSaida do servidor:')
  console.log(saidaServidor.join('').slice(-2000))
  process.exitCode = 1
}
