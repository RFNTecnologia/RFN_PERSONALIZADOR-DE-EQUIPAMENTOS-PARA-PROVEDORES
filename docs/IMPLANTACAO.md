# Implantação em campo

Guia para colocar o painel do provedor em produção e fazer o equipamento voltar
para a configuração do provedor depois de um reset de fábrica.

## 1. Servidor do provedor

### Windows (Docker Desktop) — recomendado

Veja [WINDOWS.md](WINDOWS.md). Resumo:

```powershell
tar -xzf rfn-painel-1.0.0.tar.gz
cd rfn-painel
docker compose up -d --build
docker exec rfn-painel cat /data/token.txt
```

O painel fica em `http://localhost:8080` e os dados no volume `rfn-dados`.

### Linux (systemd)

```sh
tar -xzf rfn-painel-1.0.0.tar.gz
cd rfn-painel
sudo sh instalar.sh
```

O instalador cria o usuário de sistema `rfn`, grava tudo em `/opt/rfn-painel`,
cria o serviço `rfn-painel.service` (systemd) e o diretório de dados.

Verificação:

```sh
systemctl status rfn-painel
journalctl -u rfn-painel -f
curl -s http://127.0.0.1:8080/api/health
cat /opt/rfn-painel/data/token.txt
```

Verificação completa da API (sobe uma instância isolada e testa sessão
automática, varredura e pacote de download):

```sh
cd /opt/rfn-painel && node server/verificar.mjs
```

Alternativa com container:

```sh
docker compose up -d --build
```

### Variáveis que precisam ser ajustadas

`/opt/rfn-painel/env`:

| Variável | Por quê |
| --- | --- |
| `RFN_PUBLIC_URL` | Endereço **público** do servidor. É ele que vai para `Device.X.Provisioning.ACS.URL` e para o option 43 do DHCP. Se o CPE não achieve o servidor, nada funciona. |
| `RFN_ACS_USERNAME` / `RFN_ACS_PASSWORD` | Credenciais que o equipamento usa no TR-069. Troque o padrão. |
| `RFN_TOKEN` / `RFN_DEVICE_TOKEN` | Token do painel e token dos equipamentos. Se não definir, são gerados e salvos em `data/token.txt`. |
| `RFN_TLS_CERT` / `RFN_TLS_KEY` | Com certificados, o servidor passa a falar HTTPS — recomendado. |

Reinicie depois de alterar: `sudo systemctl restart rfn-painel`.

## 2. Rede: como o equipamento encontra o provedor depois do reset

O reset de fábrica apaga a configuração do equipamento, inclusive o endereço do
ACS. Por isso o caminho de volta precisa vir da **rede**, não do equipamento.

### Option 43/60 do DHCP (recomendado)

No servidor DHCP da rede de acesso:

```
option vendor-encapsulated-options 43;
option vendor-encapsulated-options "https://acs.seuprovedor.com.br:8080/acs/tr069";
set vendor-class-identifier = "FibraSul-CPE";
```

Em OpenWrt, em `/etc/config/dhcp`:

```
config dhcp 'lan'
    option dhcp_option '43,https://acs.seuprovedor.com.br:8080/acs/tr069'
    option dhcp_option '60,FibraSul-CPE'
```

A tela **Conexão** do painel mostra o exemplo pronto, com a URL do ACS e os
valores por perfil.

### URL de bootstrap

Alguns modelos aceitam uma URL de bootstrap (campo *Provisioning URL* do
fabricante). Aponte para:

```
https://acs.seuprovedor.com.br:8080/bootstrap?serial=<serial>&token=<token do equipamento>
```

### Agente dentro do equipamento

Para equipamentos derivados de OpenWrt, o kit de implantação traz o agente
`rfn-bootstrap.sh`. Ele roda no boot, busca a configuração em
`/bootstrap/env`, aplica via UCI e publica a tela de login em
`/www/rfn-login.html`.

```sh
cp rfn-bootstrap.sh /usr/bin/rfn-bootstrap && chmod +x /usr/bin/rfn-bootstrap
cp rfn-agent.conf /etc/rfn-agent.conf
mkdir -p /mnt/rfn && chmod 700 /mnt/rfn
cp rfn-agent.init /etc/init.d/rfn-agent && chmod +x /etc/init.d/rfn-agent
/etc/init.d/rfn-agent enable && /etc/init.d/rfn-agent start
```

**Atenção:** o reset de fábrica apaga `/etc` e `/www`. O agente só sobrevive se
morar em partição persistente (ex.: `/mnt/rfn`) ou se o firmware for
customizado. Por isso a recomendação de campo continua sendo o ACS via
option 43/60: ele funciona mesmo em equipamento nunca preparado pelo provedor.

## 3. Identificação do equipamento

O painel liga o equipamento ao perfil por três chaves, em ordem de confiança:

1. **Identificador de provisionamento** — `grupo::modelo-carimbo-uid`
   (ex.: `gru1::cx588-1793224550476-38f3d149b1ba`). É escrito no
   `Device.X.DeviceInfo.ProvisioningCode` e sobrevive ao reset. Registre o valor
   no equipamento (campo *Provisioning Code* do fabricante ou
   `uci set rfn.identificador=...`).
2. **MAC (DeviceId)** — sobrevive ao reset mesmo sem identificador.
3. **Serial de fábrica** — alguns modelos apagam o serial no reset.

Cadastre pela aba **Conexão → Cadastrar equipamento** ou deixe o próprio ACS
fazer o cadastro automático na primeira conexão.

## 4. Teste do ciclo completo

1. Abra o equipamento na aba **Simulador** do painel e execute o reset do
   cliente: o painel mostra a cadeia bootstrap → validação → aplicação do
   perfil → publicação da tela de login.
2. Em campo: reinicie o CPE em modo fábrica (botão de reset) e acompanhe na aba
   **Auditoria** — deve aparecer `Reset de fábrica executado` seguido de
   `Configuração reenviada`.
3. Confirme que a tela de login do equipamento é a do provedor (branding,
   campos e textos) e que o WAN/LAN/Wi-Fi são os do perfil.

## 5. Localizar os equipamentos na rede real

A varredura é feita pelo servidor do provedor (é ele que enxerga a LAN dos
CPEs) e é somente leitura.

1. Abra a aba **Varredura** no painel.
2. No card **Servidor do provedor**, informe a URL do servidor
   (ex.: `http://10.0.0.10:8080`). Deixe o token em branco: quando o painel é
   servido pelo próprio servidor, a sessão é obtida sozinha. Se o painel estiver
   em outra máquina, cole o token de `data/token.txt`.
3. Escolha a faixa (o servidor lista as redes que ele alcança) e clique em
   **Iniciar varredura**.
4. Ao final, **Importar para a frota**: os equipamentos entram no painel como
   “em recuperação”, prontos para receber o perfil do provedor.

O histórico fica em `data/varreduras.json` e é reaberto pela tabela
**Varreduras anteriores**.

Além da sondagem por portas, há a **descoberta UPnP/SSDP** (botão
**Descobrir por UPnP (SSDP)**): o servidor envia um `M-SEARCH` na multicast e
lê o `rootDesc.xml` dos aparelhos que se anunciam. Serve para achar CPEs que
não abrem porta para a varredura. O resultado cai na mesma tabela e pode ser
importado para a frota. A varredura por portas já inclui essa descoberta.

Dica de campo: se o servidor não alcança a LAN do CPE (VPN ou segmentação),
rode a varredura a partir de uma máquina dentro da rede de acesso ou use o
descoberta SSDP a partir do próprio servidor, que faz parte da rede de
acesso.

## 6. Checklist de campo

- [ ] `node server/verificar.mjs` sem falhas no servidor
- [ ] `RFN_PUBLIC_URL` apontando para um endereço alcançável a partir do CPE
- [ ] Senhas do TR-069 trocadas e HTTPS habilitado
- [ ] Option 43/60 configurado no DHCP da rede de acesso
- [ ] Varredura de rede executada e equipamentos importados para a frota
- [ ] Identificador de provisionamento gravado em cada equipamento
- [ ] Perfil correto por modelo (WAN, VLAN, MTU, Wi-Fi, management)
- [ ] Tela de login conferida no equipamento real
- [ ] Backup do estado do servidor (`data/estado.json`) versionado
- [ ] Firmware publicado em `/api/firmware` e versão alvo definida no perfil

## 7. Operação

- **Sincronizar** (aba Conexão): reenvia o perfil ao equipamento; o ACS detecta a
  divergência pelo hash da configuração e reaplica.
- **Reiniciar**: comando de reboot remoto.
- **Firmwares**: publique o arquivo em `/api/firmware`; a URL é entregue ao CPE
  em `Device.X.Firmware.1.DownloadURL`.
- **Backup**: copie `data/estado.json` (estado do painel) e, se quiser levar a
  configuração para outro servidor, use **Exportar JSON** / **Importar**.
