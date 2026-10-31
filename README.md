# RFN — Painel do provedor para equipamentos de rede

Painel do provedor para personalizar equipamentos de rede (roteadores e ONTs) e
garantir que, **depois de um reset de fábrica feito pelo cliente, o equipamento
volte para a configuração do provedor** — e não para o padrão de fábrica — com a
interface de login do provedor já aplicada.

## O que tem aqui

| Parte | Onde | O que faz |
| --- | --- | --- |
| Painel web | `src/` | Frota, perfis de configuração, personalização da tela de login, política de restauração, auditoria e conexão com o servidor |
| Servidor do provedor | `server/` | API do painel, ACS (TR-069/CWMP), endpoint de bootstrap e publicação de firmware — sem dependências externas |
| Agente do equipamento | `server/agente/rfn-bootstrap.sh` | Roda dentro do CPE: busca a configuração, aplica e publica a tela de login |
| Guias | `docs/` | Implantação em campo, rede, segurança e checklist |

## Como rodar o servidor

### Docker (Windows com Docker Desktop, Linux ou macOS) — recomendado

O repositório já traz `Dockerfile` e `docker-compose.yml`: o build compila o
painel e a imagem sobe o servidor (ACS + painel) com os dados em um volume
(`rfn-dados`).

```sh
docker compose up -d --build
docker compose logs -f
docker exec rfn-painel cat /data/token.txt   # token do painel
```

O painel fica em `http://localhost:8080`. O guia completo para Windows
(Docker Desktop, WSL2, rede host para a varredura SSDP, backup do volume) está
em [docs/WINDOWS.md](docs/WINDOWS.md).

### Node direto (sem container)

Requisito: **Node 18 ou superior**. O servidor não usa dependências externas; o
painel só precisa do `npm install` para ser compilado (o `iniciar.sh` faz isso
sozinho).

```sh
sh iniciar.sh
# ou, separadamente
node server/index.mjs
# ou
sh server/iniciar.sh
```

`iniciar.sh` (na raiz) faz tudo em um comando: instala as dependências se
faltarem, compila o painel (`dist/`) e sobe o servidor. Ao final ele mostra a
URL de acesso, o token do painel e o token de dispositivo.

O servidor sobe o painel (pasta `dist/`), a API, o ACS em `/acs/tr069` e o
endpoint de bootstrap em `/bootstrap`. Ele imprime no console o token do painel e
o token de dispositivo; o token do painel também fica em `data/token.txt`.

Para conferir se está tudo de pé (sobe uma instância isolada, testa a API, a
sessão automática, a varredura contra a própria máquina e a geração do pacote
de download):

```sh
node server/verificar.mjs
```

Variáveis relevantes (veja `server/env.exemplo`):

- `RFN_PORT` / `RFN_HOST` — escuta do serviço
- `RFN_PUBLIC_URL` — endereço público que o **equipamento** usa para falar com o ACS
- `RFN_TOKEN` / `RFN_DEVICE_TOKEN` — tokens do painel e dos equipamentos
- `RFN_ACS_USERNAME` / `RFN_ACS_PASSWORD` — credenciais do TR-069
- `RFN_TLS_CERT` / `RFN_TLS_KEY` — quando presentes, o servidor passa a usar HTTPS
- `RFN_DATA_DIR` — onde ficam estado, tokens e firmwares

## Painel web (desenvolvimento)

```sh
npm install
npm run dev
```

Para gerar os arquivos estáticos servidos pelo servidor: `npm run build` (a saída
vai para `dist/`).

## Como o equipamento volta para a configuração do provedor

Três caminhos, usable juntos:

1. **ACS / TR-069** — o equipamento aponta para o ACS do provedor (por DHCP
   option 43/60 ou por configuração). Depois do reset ele informa `FACTORYRESET`,
   o ACS reconhece o equipamento (pelo identificador de provisionamento
   `grupo::modelo-carimbo-uid`, pelo MAC ou pelo serial) e reenvia o perfil.
2. **Bootstrap HTTP** — o agente dentro do equipamento busca a configuração em
   `/bootstrap/env` e a tela de login em `/bootstrap/login.html`.
3. **Cache offline** — o agente guarda a última configuração em `/mnt/rfn` e
   reaplica mesmo sem internet.

O detalhe de cada método, os parâmetros de rede e o checklist estão em
[docs/IMPLANTACAO.md](docs/IMPLANTACAO.md).

## Localizar os equipamentos na rede real (varredura)

A aba **Varredura** do painel localiza os CPEs que já estão na rede do provedor.
Quem varre é o **servidor** (o navegador não enxerga a LAN): ele sonda as portas
típicas (web, TR-069 7547, SSH/Telnet), lê o título/Server da página do
equipamento, consulta o CPE por CWMP com as credenciais do ACS para obter
serial, MAC, modelo e firmware, e cruza com a tabela ARP do sistema.

A varredura é **somente leitura** e não altera nada no equipamento.

1. Em **Varredura**, preencha o card **Servidor do provedor** com a URL do
   servidor (ex.: `http://10.0.0.10:8080`). Deixe o token em branco e o painel
   obtém a sessão sozinho quando ele é servido pelo próprio servidor; caso
   contrário, cole o token de `data/token.txt`.
2. Escolha a faixa (o servidor lista as redes que ele alcança) e clique em
   **Iniciar varredura**.
3. Acompanhe o progresso e, ao final, use **Importar para a frota**: os
   equipamentos encontrados entram no painel como “em recuperação”, prontos para
   receber o perfil do provedor (e o identificador de provisionamento).
4. As varreduras ficam gravadas em `data/varreduras.json`: o histórico
   sobrevive a reinício do servidor e pode ser reaberto pela tabela
   **Varreduras anteriores**.

O MAC de cada equipamento vem da tabela ARP do servidor (`/proc/net/arp` e
`ip neigh`), lida depois da sondagem — que é o momento em que o sistema
resolve o endereço do host na rede local.

Além da sondagem por portas, a varredura também faz **descoberta UPnP/SSDP**
(botão **Descobrir por UPnP (SSDP)**): o servidor envia um `M-SEARCH` na
multicast e coleta os equipamentos que se anunciam, lendo o `rootDesc.xml` para
marca, modelo e nome do aparelho. É o caminho que encontra CPEs que não
abrem porta para a varredura. O resultado aparece na mesma tabela e pode ser
importado para a frota como qualquer varredura.

A varredura também roda como *plug-in* da própria varredura por portas: cada
execução já inclui a descoberta UPnP/SSDP antes da sondagem.

## Download

Pelo painel, na aba **Conexão**:

- **Kit de implantação** (por equipamento): agente, configuração, tela de login,
  comandos UCI e o LEIA-ME — em `.tar.gz` (e também em `.zip`).
- **Pacote do servidor** (painel compilado, servidor, instalador systemd,
  `Dockerfile`, `docker-compose.yml` e a documentação) para instalar no servidor
  do provedor — disponível em **`.zip`** (abre nativamente no Windows) e em
  `.tar.gz`. No Windows: `Expand-Archive .\rfn-painel-1.0.0.zip -DestinationPath C:\rfn`
  e depois `docker compose up -d --build`. Guia completo em `docs/WINDOWS.md`.
- **Exportar JSON**: configuração completa (branding, perfis, política, frota),
  para backup ou para importar em outro servidor.

## Segurança

- Tokens separados para painel e equipamento; comparação em tempo constante.
- O ACS exige autenticação Digest; o bootstrap exige token de dispositivo.
- Em produção use HTTPS (`RFN_TLS_CERT`/`RFN_TLS_KEY`) e troque as senhas
  padrão do TR-069.
