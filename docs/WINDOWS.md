# Instalação no Windows com Docker

Guia para subir o painel do provedor (ACS TR-069 + painel web) em um servidor
Windows usando **Docker Desktop** ou **Docker Engine + WSL2**.

## 1. Pré-requisitos

- Docker Desktop instalado e rodando (Windows 10 21H2+ / Windows 11, 64 bits).
  Em *Settings > General*, deixe **Use the WSL 2 based engine** ligado.
- Espaco em disco para a imagem (~400 MB) e para os dados do painel.

## 2. Obter o código

Baixe o pacote pelo painel (aba **Conexão → Baixar pacote (.zip)**) ou clone o
repositório. No PowerShell:

```powershell
mkdir C:\rfn
cd C:\rfn
# se baixou o .zip pelo navegador:
Expand-Archive .\rfn-painel-1.0.0.zip -DestinationPath C:\rfn
cd C:\rfn\rfn-painel
```

> Se o `tar.exe` do Windows reclamou **"Unrecognized archive format"**, o
> arquivo baixado não é um tar válido (ou veio truncado). Use o `.zip` — que o
> Windows abre nativamente — ou extraia com o 7-Zip. Também é possível que o
> navegador tenha salvo a resposta de erro do servidor em vez do pacote:
> confira o tamanho do arquivo e baixe pelo botão do painel.

O pacote já vem com `Dockerfile` e `docker-compose.yml`.

## 3. Subir o container

```powershell
docker compose up -d --build
docker compose logs -f
```

O build compila o painel (`npm run build`) e empacota tudo numa imagem
`rfn-painel:1.0.0`. Ao final o serviço fica em
<http://localhost:8080>.

Para ver o log de inicialização (imprime a URL e os tokens):

```powershell
docker compose logs rfn-painel
```

## 4. Token do painel

O token é gerado no primeiro start e gravado no volume `rfn-dados`:

```powershell
docker exec rfn-painel cat /data/token.txt
```

Abra <http://localhost:8080> no navegador: quando o painel é servido pelo
próprio servidor, a sessão/token é obtida automaticamente (aba **Conexão** e
**Varredura**). Se você publicar o painel em outro host, cole o token na aba
**Conexão**.

## 5. Configurar o servidor

Copie o exemplo e ajuste (PowerShell):

```powershell
Copy-Item .\server\env.exemplo .\env
notepad .\env
```

Ajustes importantes:

| Variável | Por quê |
| --- | --- |
| `RFN_PUBLIC_URL` | Endereço **público** do servidor (o CPE usa este para falar com o ACS e recebe no option 43 do DHCP). |
| `RFN_ACS_USERNAME` / `RFN_ACS_PASSWORD` | Credenciais do TR-069. Troque o padrão. |
| `RFN_TOKEN` / `RFN_DEVICE_TOKEN` | Se não definir, são gerados e salvos em `/data/token.txt`. |
| `RFN_TLS_CERT` / `RFN_TLS_KEY` | Com certificados, o servidor passa a falar HTTPS. Monte `./certs` no container e aponte para `/certs/...`. |

Depois, suba de novo para aplicar as variáveis:

```powershell
docker compose up -d
```

## 6. Varredura dos equipamentos na rede real

A varredura é feita pelo **servidor** (o navegador não enxerga a LAN). O
container precisa alcançar a rede de acesso dos CPEs:

1. **Opção recomendada — rede host**: em *Docker Desktop > Settings > Resources >
   Network*, habilite *Host networking* (Docker Desktop 4.34+). Depois, edite o
   `docker-compose.yml`, comente o bloco `ports:` e descomente
   `network_mode: host`. Com isso o container usa a rede da própria máquina
   Windows e a descoberta **UPnP/SSDP** funciona.
2. **Sem rede host**: o container usa NAT e a **sondagem de portas** funciona
   normalmente; a multicast SSDP pode não atravessar o NAT.

Depois, no painel: aba **Varredura** → **Descobrir por UPnP (SSDP)** ou
**Iniciar varredura** → **Importar para a frota**.

Se o servidor Windows estiver atrás de VPN ou segmentado em relação à rede de
acesso, rode a varredura a partir de uma máquina dentro dessa rede.

## 7. Onde ficam os dados

- `rfn-dados` (volume Docker): estado do painel, tokens, firmware, histórico de
  varreduras e kits gerados.
- Backup: `docker run --rm -v rfn-painel_rfn-dados:/data -v ${PWD}:/backup
  alpine tar czf /backup/rfn-dados.tar.gz -C /data .`

Para levar tudo para outro servidor: `docker run --rm -v
  rfn-painel_rfn-dados:/data -v ${PWD}:/backup alpine sh -c "cd /data && tar czf
  /backup/rfn-dados.tar.gz ."`

## 8. Comandos do dia a dia

```powershell
docker compose ps              # status
docker compose logs -f         # logs
docker compose restart         # reiniciar
docker compose down            # parar (mantem os dados)
docker compose up -d --build   # recompilar apos mudancas
```

## 9. Sem Docker (alternativa)

Se não puder usar Docker, instale o **Node 18+** e rode direto no Windows:

```powershell
npm install
npm run build
node server\index.mjs
```

O servidor funciona igual; perde-se apenas o isolamento do container. O
`instalar.sh` (systemd) é exclusivo de Linux.
