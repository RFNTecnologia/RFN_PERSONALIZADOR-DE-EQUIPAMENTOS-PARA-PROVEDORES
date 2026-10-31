/**
 * Gera o "kit de implantacao" de um equipamento: um .tar.gz com tudo o que o
 * provedor precisa levar ate o CPE.
 *
 * O kit contem:
 *   rfn-bootstrap.sh   agente de restauracao pos-reset (roda dentro do equipamento)
 *   rfn-agent.conf     configuracao do agente (servidor, token, serial, identificador)
 *   login.html         tela de login do provedor pronta para publicar no CPE
 *   aplicar-uci.sh     comandos UCI equivalentes, para execucao manual
 *   cwmpd.uci          configuracao do cliente TR-069 do equipamento
 *   LEIA-ME.txt        passo a passo de instalacao
 *
 * O formato tar e escrito a mao (sem dependencias externas) e comprimido com
 * o zlib nativo do Node.
 */

import zlib from 'node:zlib'
import { gerarPaginaLogin } from './login.mjs'
import { comandosUci, hashConfig, parametrosDoPerfil } from './tr069-model.mjs'

const TAMANHO_BLOCO = 512

function cabecalhoTar(nome, tamanho, modo, mtime, tipo = '0') {
  const bloco = Buffer.alloc(TAMANHO_BLOCO)
  const escrever = (texto, posicao, comprimento) => {
    bloco.write(texto.slice(0, comprimento), posicao, comprimento, 'utf8')
  }

  escrever(nome, 0, 100)
  escrever((modo & 0o7777).toString(8).padStart(7, '0'), 100, 8)
  escrever('0000000', 108, 8)
  escrever('0000000', 116, 8)
  escrever(tamanho.toString(8).padStart(11, '0'), 124, 12)
  escrever(mtime.toString(8).padStart(11, '0'), 136, 12)
  escrever('        ', 148, 9)
  bloco.write(tipo, 156, 1, 'ascii')
  escrever('ustar', 257, 6)
  escrever('00', 263, 2)

  let soma = 0
  for (const byte of bloco) soma += byte
  bloco.write(soma.toString(8).padStart(6, '0') + '\u0000 ', 148, 8, 'ascii')
  return bloco
}

/** Monta um tar (ustar) a partir de uma lista de arquivos. */
export function criarTar(arquivos, mtime = Math.floor(Date.now() / 1000)) {
  const partes = []
  for (const arquivo of arquivos) {
    const conteudo = Buffer.isBuffer(arquivo.conteudo)
      ? arquivo.conteudo
      : Buffer.from(arquivo.conteudo ?? '', 'utf8')
    const nome = String(arquivo.nome || 'arquivo')
    // Nomes com mais de 100 caracteres nao cabem no campo "name" do ustar:
    // usamos a entrada GNU LongLink, que o tar do Windows (bsdtar) tambem
    // entende.
    if (Buffer.byteLength(nome, 'utf8') > 100) {
      const longo = Buffer.from(`${nome}\n`, 'utf8')
      partes.push(cabecalhoTar('././@LongLink', longo.length, 0o644, mtime, 'L'))
      partes.push(longo)
      const restoLongo = longo.length % TAMANHO_BLOCO
      if (restoLongo > 0) partes.push(Buffer.alloc(TAMANHO_BLOCO - restoLongo))
    }
    partes.push(cabecalhoTar(nome.slice(0, 100), conteudo.length, arquivo.modo ?? 0o644, mtime))
    partes.push(conteudo)
    const resto = conteudo.length % TAMANHO_BLOCO
    if (resto > 0) partes.push(Buffer.alloc(TAMANHO_BLOCO - resto))
  }
  partes.push(Buffer.alloc(TAMANHO_BLOCO * 2))
  return Buffer.concat(partes)
}

function arquivoTexto(nome, conteudo, modo = 0o644) {
  return { nome, conteudo, modo }
}

function aspa(valor) {
  return `'${String(valor ?? '').replace(/'/g, "'\\''")}'`
}

/**
 * Monta o kit completo de um equipamento.
 * Contexto: { estado, equipamento, perfil, branding, politica, acsUrl,
 *             acsUsuario, acsSenha, tokenDispositivo, scriptAgente, servidor }
 */
export function montarKit({
  estado,
  equipamento,
  perfil,
  branding,
  politica,
  acsUrl,
  acsUsuario,
  acsSenha,
  tokenDispositivo,
  scriptAgente,
  scriptInit,
  servidor,
}) {
  const cliente = (estado.clientes || []).find((c) => c.id === equipamento.clienteId)
  const html = gerarPaginaLogin({
    branding,
    perfil,
    opcoes: { plano: cliente?.plano || '', nomeCliente: cliente?.nome || '' },
  })

  const params = parametrosDoPerfil({
    perfil,
    branding,
    politica,
    serial: equipamento.serial,
    identificador: equipamento.identificador,
    acsUrl,
    acsUsuario,
    acsSenha,
  })
  const hash = hashConfig(params)

  const conf = [
    '# Configuracao do agente de restauracao do provedor.',
    `# equipamento: ${equipamento.serial} (${equipamento.modelo || 'modelo nao informado'})`,
    `RFN_SERVER=${servidor}`,
    `RFN_TOKEN=${tokenDispositivo}`,
    `RFN_SERIAL=${equipamento.serial || ''}`,
    `RFN_IDENTIFICADOR=${equipamento.identificador || ''}`,
    'RFN_LOGIN_DIR=/www',
    'RFN_LOGIN_ALVOS=/www/webpages/login.html,/usr/www/login.html,/www/login.html',
    'RFN_CACHE=/mnt/rfn/cache.env',
    'RFN_TENTATIVAS=60',
    'RFN_INTERVALO=30',
    `RFN_ACS_URL=${acsUrl}`,
    `RFN_ACS_USER=${acsUsuario}`,
    `RFN_ACS_PASS=${acsSenha}`,
    '',
  ].join('\n')

  const config = {
    serial: equipamento.serial,
    identificador: equipamento.identificador,
    marca: branding.marca,
    wan: {
      modo: perfil.wan.modo,
      modoUci: perfil.wan.modo === 'pppoe' ? 'pppoe' : perfil.wan.modo === 'ip-estatico' ? 'static' : 'dhcp',
      usuario: perfil.wan.usuario || '',
      senha: perfil.wan.senha || '',
      vlan: perfil.wan.vlan || 0,
      mtu: perfil.wan.mtu || 1500,
    },
    lan: {
      gateway: perfil.lan.gateway || '',
      faixa: perfil.lan.faixa || '',
      mascara: '255.255.255.0',
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
      acsUrl,
      acsUsuario,
      acsSenha,
      intervaloMin: perfil.gestao.intervaloMin || 60,
      metodoRestore: perfil.gestao.metodoRestore || 'tr069-acs',
      urlBootstrap: perfil.gestao.urlBootstrap || '',
      dhcpOption60: perfil.gestao.dhcpOption60 || '',
      senhaAdmin: politica.senhaAdminPadrao || '',
    },
  }
  const comandos = comandosUci(config)

  const aplicar = [
    '#!/bin/sh',
    '# Aplica a configuracao do provedor manualmente (util para diagnostico).',
    'set -eu',
    '',
    ...comandos.map((c) => `uci set ${c.chave}=${aspa(c.valor)}`),
    'uci commit network 2>/dev/null || true',
    'uci commit wireless 2>/dev/null || true',
    "uci set rfn=rfn 2>/dev/null || true",
    `uci set rfn.identificador=${aspa(equipamento.identificador || '')} 2>/dev/null || true`,
    'uci commit rfn 2>/dev/null || true',
    '',
    '/etc/init.d/network restart',
    '',
  ].join('\n')

  const cwmpd = [
    '# Cliente TR-069 do equipamento (OpenWrt: /etc/config/cwmpd).',
    "uci set cwmpd.@cwmpd[0].enabled='1'",
    `uci set cwmpd.@cwmpd[0].url=${aspa(acsUrl)}`,
    `uci set cwmpd.@cwmpd[0].username=${aspa(acsUsuario)}`,
    `uci set cwmpd.@cwmpd[0].password=${aspa(acsSenha)}`,
    `uci set cwmpd.@cwmpd[0].periodic_inform_interval=${Math.max(60, (perfil.gestao.intervaloMin || 60) * 60)}`,
    "uci set cwmpd.@cwmpd[0].use_digest='1'",
    'uci commit cwmpd',
    '',
  ].join('\n')

  const leiaMe = [
    `Kit de implantacao - ${equipamento.serial}`,
    `Modelo: ${equipamento.modelo || 'nao informado'}`,
    `Perfil: ${perfil.nome} (hash ${hash})`,
    `Identificador de provisionamento: ${equipamento.identificador || 'nao informado'}`,
    `Servidor do provedor: ${servidor}`,
    '',
    '1) Copie os arquivos para o equipamento (ssh/scp, console ou pendrive):',
    '     scp rfn-bootstrap.sh rfn-agent.conf rfn-agent.init login.html root@<ip-do-equipamento>:/tmp/',
    '',
    '2) No equipamento:',
    '     cp /tmp/rfn-bootstrap.sh /usr/bin/rfn-bootstrap && chmod +x /usr/bin/rfn-bootstrap',
    '     cp /tmp/rfn-agent.conf /etc/rfn-agent.conf',
    '     mkdir -p /mnt/rfn && chmod 700 /mnt/rfn',
    '     mkdir -p /www && cp /tmp/login.html /www/rfn-login.html',
    '   Se o modelo servir a tela de login em outro caminho (ex.:',
    '   /www/webpages/login.html), copie o mesmo arquivo para la.',
    '',
    '3) Instale o servico de inicializacao:',
    '     cp /tmp/rfn-agent.init /etc/init.d/rfn-agent && chmod +x /etc/init.d/rfn-agent',
    '     /etc/init.d/rfn-agent enable && /etc/init.d/rfn-agent start',
    '',
    '4) Aponte o cliente TR-069 para o ACS do provedor (recomendado):',
    '     sh cwmpd.uci',
    '',
    '5) Teste a restauracao pos-reset:',
    '     /usr/bin/rfn-bootstrap',
    '   O agente baixa a configuracao, aplica no equipamento e publica o login.',
    '',
    '6) IMPORTANTE - sobreviver ao reset de fabrica:',
    '   O reset de fabrica apaga /etc e /www. O agente so sobrevive se estiver',
    '   gravado em uma particao persistente (ex.: /mnt/rfn) ou se o firmware do',
    '   equipamento for customized com o agente. A opcao mais robusta e o ACS:',
    '   com a opcao 43/60 do DHCP apontando para o ACS, o equipamento volta a',
    '   falar com o provedor mesmo depois de resetado, sem depender do agente.',
    '',
  ].join('\n')

  const arquivos = [
    arquivoTexto('rfn-bootstrap.sh', scriptAgente, 0o755),
    arquivoTexto('rfn-agent.init', scriptInit, 0o755),
    arquivoTexto('rfn-agent.conf', conf),
    arquivoTexto('login.html', html),
    arquivoTexto('aplicar-uci.sh', aplicar, 0o755),
    arquivoTexto('cwmpd.uci', cwmpd),
    arquivoTexto('LEIA-ME.txt', leiaMe),
  ]

  const tar = criarTar(arquivos)
  const gzip = zlib.gzipSync(tar, { level: 9 })

  return {
    arquivos: arquivos.map((a) => ({ nome: a.nome, bytes: Buffer.byteLength(a.conteudo) })),
    hash,
    tar,
    gzip,
    conteudo: {
      'rfn-bootstrap.sh': scriptAgente,
      'rfn-agent.init': scriptInit,
      'rfn-agent.conf': conf,
      'login.html': html,
      'aplicar-uci.sh': aplicar,
      'cwmpd.uci': cwmpd,
      'LEIA-ME.txt': leiaMe,
    },
  }
}
