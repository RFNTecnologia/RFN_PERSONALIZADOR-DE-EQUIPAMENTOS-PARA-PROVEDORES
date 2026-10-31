/**
 * Monta o pacote de instalacao do painel do provedor (ACS + painel web).
 *
 * O pacote e um .tar.gz com tudo o que e preciso para subir o servidor em
 * uma maquina do provedor:
 *
 *   server/            codigo do servidor (ACS TR-069, bootstrap, API)
 *   dist/              painel compilado (quando existe build)
 *   instalar.sh        instala em /opt/rfn-painel e cria o servico systemd
 *   iniciar.sh         sobe o servidor em primeiro plano
 *   rfn-painel.service unidade systemd
 *   env.exemplo        variaveis de ambiente
 *   Dockerfile         imagem de container (Node 20 alpine, sem dependencias)
 *   docker-compose.yml
 *   docs/              guias de implantacao
 *   LEIA-ME.txt        passo a passo resumido
 *
 * O tar e escrito a mao (sem dependencias externas) e comprimido com o zlib
 * nativo do Node, igual ao kit de implantacao de cada equipamento.
 */

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { criarTar } from './kit.mjs'
import { criarZip } from './zip.mjs'

const IGNORAR = new Set(['node_modules', '.git', '.vite', 'data', 'coverage'])

/** Arquivos que existem no repositorio e sao gerados outra vez na raiz do pacote. */
const IGNORAR_NO_SERVIDOR = new Set(['iniciar.sh', 'env.exemplo'])

function executavel(caminho) {
  try {
    const modo = fs.statSync(caminho).mode
    return (modo & 0o111) !== 0
  } catch {
    return false
  }
}

/** Percorre um diretorio e devolve a lista de arquivos (texto ou binario). */
function percorrer(diretorio, base = '') {
  const arquivos = []
  let entradas
  try {
    entradas = fs.readdirSync(diretorio, { withFileTypes: true })
  } catch {
    return arquivos
  }
  for (const entrada of entradas) {
    if (IGNORAR.has(entrada.name) || entrada.name.startsWith('.')) continue
    if (base === 'server' && IGNORAR_NO_SERVIDOR.has(entrada.name)) continue
    const caminho = path.join(diretorio, entrada.name)
    const nome = base ? `${base}/${entrada.name}` : entrada.name
    if (entrada.isDirectory()) {
      arquivos.push(...percorrer(caminho, nome))
    } else if (entrada.isFile()) {
      const conteudo = fs.readFileSync(caminho)
      arquivos.push({
        nome,
        conteudo,
        modo: executavel(caminho) ? 0o755 : 0o644,
      })
    }
  }
  return arquivos
}

function texto(nome, conteudo, modo = 0o644) {
  return { nome, conteudo: Buffer.from(conteudo, 'utf8'), modo }
}

const INSTALAR = `#!/bin/sh
# Instala o painel RFN (ACS TR-069 + painel web) no servidor do provedor.
#
#   sudo sh instalar.sh
#
# Variaveis aceitas:
#   RFN_PREFIXO   diretorio de instalacao (padrao /opt/rfn-painel)
#   RFN_PORTA     porta do servidor (padrao 8080)
#   RFN_USUARIO   usuario do sistema do servico (padrao rfn)

set -eu

PREFIXO=\${RFN_PREFIXO:-/opt/rfn-painel}
PORTA=\${RFN_PORTA:-8080}
USUARIO=\${RFN_USUARIO:-rfn}
ORIGEM=$(cd "$(dirname "$0")" && pwd)

echo "Instalando o painel RFN em $PREFIXO"

if [ "$(id -u)" != "0" ]; then
  echo "erro: execute como root (sudo sh instalar.sh)" >&2
  exit 1
fi

command -v node >/dev/null 2>&1 || {
  echo "erro: node (18 ou superior) nao encontrado no PATH" >&2
  exit 1
}

mkdir -p "$PREFIXO"
cp -R "$ORIGEM/server" "$PREFIXO/"
[ -d "$ORIGEM/dist" ] && cp -R "$ORIGEM/dist" "$PREFIXO/"
[ -d "$ORIGEM/docs" ] && cp -R "$ORIGEM/docs" "$PREFIXO/"
cp "$ORIGEM/env.exemplo" "$PREFIXO/env.exemplo" 2>/dev/null || true
[ -f "$PREFIXO/env" ] || cp "$PREFIXO/env.exemplo" "$PREFIXO/env" 2>/dev/null || true
cp "$ORIGEM/iniciar.sh" "$PREFIXO/iniciar.sh" 2>/dev/null || true
cp "$ORIGEM/Dockerfile" "$PREFIXO/Dockerfile" 2>/dev/null || true
cp "$ORIGEM/docker-compose.yml" "$PREFIXO/docker-compose.yml" 2>/dev/null || true
chmod +x "$PREFIXO/iniciar.sh" 2>/dev/null || true

if ! id "$USUARIO" >/dev/null 2>&1; then
  useradd --system --home "$PREFIXO" --shell /usr/sbin/nologin "$USUARIO" 2>/dev/null || true
fi

mkdir -p "$PREFIXO/data"
chown -R "$USUARIO:$USUARIO" "$PREFIXO"

sed -e "s|@PREFIXO@|$PREFIXO|g" -e "s|@USUARIO@|$USUARIO|g" -e "s|@PORTA@|$PORTA|g" \\
  "$ORIGEM/rfn-painel.service" > /etc/systemd/system/rfn-painel.service

systemctl daemon-reload
systemctl enable rfn-painel.service >/dev/null 2>&1 || true
systemctl restart rfn-painel.service || systemctl start rfn-painel.service

echo
echo "Painel instalado e em execucao."
echo "  URL:      http://<ip-do-servidor>:$PORTA"
echo "  Logs:     journalctl -u rfn-painel -f"
echo "  Token:    cat $PREFIXO/data/token.txt"
echo
echo "Antes de usar em campo, defina RFN_PUBLIC_URL e os certificados em $PREFIXO/env."
`

const SERVICO = `[Unit]
Description=RFN Painel do provedor (ACS TR-069 + painel)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=@USUARIO@
WorkingDirectory=@PREFIXO@
EnvironmentFile=-@PREFIXO@/env
ExecStart=/usr/bin/env node @PREFIXO@/server/index.mjs
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
StateDirectory=rfn-painel
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
`

const INICIAR = `#!/bin/sh
# Sobe o painel RFN em primeiro plano (utile para teste e containers).
set -eu
cd "$(dirname "$0")"
exec node server/index.mjs "\${@}"
`

const ENV_EXEMPLO = `# Configuracao do servidor RFN. Copie para "env" e ajuste.
# (o service systemd le o arquivo "$PREFIXO/env")

# Porta e interface de escuta
RFN_PORT=8080
RFN_HOST=0.0.0.0

# URL publica do provedor: e o endereco que o equipamento usa para falar
# com o ACS e com o endpoint de bootstrap. Use HTTPS em producao.
RFN_PUBLIC_URL=https://acs.seuprovedor.com.br:8080

# Tokens de acesso
# RFN_TOKEN            token do painel (gerado e salvo em data/token.txt se ausente)
# RFN_DEVICE_TOKEN    token usado pelos equipamentos (bootstrap/firmware)

# Credenciais do TR-069 (ACS)
RFN_ACS_USERNAME=admin
RFN_ACS_PASSWORD=troque-esta-senha

# HTTPS: caminhos dos certificados (quando presentes, o servidor usa TLS)
# RFN_TLS_CERT=/etc/ssl/rfn/cert.pem
# RFN_TLS_KEY=/etc/ssl/rfn/key.pem

# Onde os dados (estado, tokens, firmwares) ficam gravados
# RFN_DATA_DIR=/var/lib/rfn-painel
`

const DOCKERFILE = `# Painel RFN do provedor: ACS TR-069 + painel web.
# Sem dependencias externas: apenas o runtime do Node.
FROM node:20-alpine

WORKDIR /opt/rfn-painel
COPY . .

ENV RFN_HOST=0.0.0.0 \\
    RFN_PORT=8080 \\
    RFN_DATA_DIR=/data

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8080

CMD ["node", "server/index.mjs"]
`

const DOCKER_COMPOSE = `# RFN - Painel do provedor (ACS TR-069 + painel web)
# Windows (Docker Desktop) / Linux / macOS:
#   docker compose up -d --build
#   docker compose logs -f
#
services:
  rfn-painel:
    build: .
    image: rfn-painel:1.0.0
    container_name: rfn-painel
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      RFN_PORT: "8080"
      RFN_HOST: "0.0.0.0"
      RFN_DATA_DIR: "/data"
      # RFN_PUBLIC_URL: "https://acs.seuprovedor.com.br:8080"
      # RFN_TOKEN: "token do painel"
      # RFN_DEVICE_TOKEN: "token dos equipamentos"
      # RFN_ACS_USERNAME: "admin"
      # RFN_ACS_PASSWORD: "senha do TR-069"
      # RFN_TLS_CERT: "/certs/cert.pem"
      # RFN_TLS_KEY: "/certs/key.pem"
    volumes:
      - rfn-dados:/data
      # - ./certs:/certs:ro

    # Para a varredura de rede (SSDP/UPnP) enxergar a LAN de acesso como a
    # maquina host, ative a rede host (Docker Desktop 4.34+) e comente o
    # bloco "ports" acima:
    #
    # network_mode: host

volumes:
  rfn-dados:
`

const LEIA_ME = `Painel RFN do provedor — pacote de instalacao
================================================

Conteudo
--------
  instalar.sh          instala o servidor e cria o servico systemd
  iniciar.sh           roda o servidor em primeiro plano
  rfn-painel.service   unidade systemd (gerada pelo instalador)
  env.exemplo          variaveis de ambiente (copie para "env")
  server/              codigo do servidor: ACS TR-069, bootstrap e API
  dist/                painel web compilado (se houver build)
  docs/                guias de implantacao

Instalacao em Windows (Docker Desktop) - recomendado
---------------------------------------------------
  1. Baixe o arquivo rfn-painel-1.0.0.zip (o painel oferece o .zip e o .tar.gz).
  2. Extraia: clique com o botao direito > "Extrair tudo", ou no PowerShell:
       Expand-Archive .\rfn-painel-1.0.0.zip -DestinationPath C:\rfn
  3. Entre na pasta extraida (C:\rfn\rfn-painel) e rode:
       docker compose up -d --build

  Se voce baixou o .tar.gz e o tar.exe do Windows reclamou
  ("Unrecognized archive format"), use o .zip ou o 7-Zip: o tar do Windows e o
  bsdtar, que exige o formato POSIX valido.

  Guia completo em docs/WINDOWS.md.

Instalacao em maquina Linux
---------------------------
  tar -xzf rfn-painel-1.0.0.tar.gz
  cd rfn-painel
  sudo sh instalar.sh

  Requer Node 18 ou superior. O instalador cria o usuario de sistema
  "rfn", grava os dados em /opt/rfn-painel/data e habilita o servico.

  Verifique:
    systemctl status rfn-painel
    journalctl -u rfn-painel -f
    cat /opt/rfn-painel/data/token.txt

  Teste automatico do servidor (sobe uma instancia isolada e checa a API,
  a varredura e a geracao do pacote):
    cd $PREFIXO && node server/verificar.mjs

  O token do painel e a chave que o painel web usa para falar com o
  servidor. Cole-o na tela "Conexao" do painel.

Container
---------
  docker compose up -d --build
  (os dados ficam no volume rfn-dados)

  No Windows (Docker Desktop), veja docs/WINDOWS.md: como obter o token
  (docker exec rfn-painel cat /data/token.txt), como configurar o env e
  como ativar a rede host para a varredura SSDP.

Proximos passos
---------------
  1. Defina RFN_PUBLIC_URL com o endereco publico do servidor.
  2. Aponte o DHCP da rede (option 43/60) para o ACS.
  3. No painel, cadastre os equipamentos (serial e identificador
     de provisionamento no formato grupo::modelo-carimbo-uid).
  4. Baixe o kit de implantacao de cada equipamento e aplique-o.
  5. Teste o ciclo completo na tela "Simulador" e depois em campo.
`

/** Monta o pacote completo de instalacao do painel. */
export function montarPacote({ raiz, versao = '1.0.0' } = {}) {
  const arquivos = arquivosDoPacote({ raiz })

  const tar = criarTar(arquivos)
  const gzip = zlib.gzipSync(tar, { level: 9 })
  const zip = criarZip(arquivos)

  return {
    versao,
    arquivos: arquivos.map((a) => ({ nome: a.nome, bytes: a.conteudo.length })),
    bytes: gzip.length,
    bytesZip: zip.length,
    tar,
    gzip,
    zip,
  }
}

/** Lista de arquivos que compoem o pacote de instalacao. */
export function arquivosDoPacote({ raiz } = {}) {
  const base = raiz || process.cwd()
  const arquivos = []

  const servidor = path.join(base, 'server')
  for (const arquivo of percorrer(servidor, 'server')) arquivos.push(arquivo)

  const dist = path.join(base, 'dist')
  if (fs.existsSync(dist)) {
    for (const arquivo of percorrer(dist, 'dist')) arquivos.push(arquivo)
  }

  const docs = path.join(base, 'docs')
  if (fs.existsSync(docs)) {
    for (const arquivo of percorrer(docs, 'docs')) arquivos.push(arquivo)
  }

  const readme = path.join(base, 'README.md')
  if (fs.existsSync(readme)) {
    arquivos.push({ nome: 'README.md', conteudo: fs.readFileSync(readme), modo: 0o644 })
  }

  arquivos.push(texto('instalar.sh', INSTALAR, 0o755))
  arquivos.push(texto('iniciar.sh', INICIAR, 0o755))
  arquivos.push(texto('rfn-painel.service', SERVICO))
  arquivos.push(texto('env.exemplo', ENV_EXEMPLO))
  arquivos.push(texto('Dockerfile', DOCKERFILE))
  arquivos.push(texto('docker-compose.yml', DOCKER_COMPOSE))
  arquivos.push(texto('LEIA-ME.txt', LEIA_ME))

  return arquivos
}
