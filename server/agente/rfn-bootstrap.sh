#!/bin/sh
# rfn-bootstrap — agente de restauracao do provedor.
#
# Roda dentro do CPE (OpenWrt/Linux embarcado) na inicializacao. Se o
# equipamento foi resetado pelo cliente, o agente busca a configuracao do
# provedor no endpoint de bootstrap, reaplica o perfil e publica a tela de
# login personalizada. Nao depende de jq, python ou node.
#
# Variaveis (em /etc/rfn-agent.conf, opcionalmente /etc/rfn-agent.local.conf):
#   RFN_SERVER        http://servidor:8080   (obrigatorio)
#   RFN_TOKEN         token do dispositivo     (obrigatorio)
#   RFN_SERIAL        serial, quando nao for detectavel
#   RFN_IDENTIFICADOR identificador de provisionamento (grupo::modelo-carimbo-uid)
#   RFN_LOGIN_DIR     diretorio do web server do CPE (padrao /www)
#   RFN_LOGIN_ALVOS   caminhos extras onde a tela de login deve ser publicada
#                     (separados por virgula). Ex.: /www/webpages/login.html
#   RFN_CACHE         arquivo de cache offline (padrao /mnt/rfn/cache.env)
#   RFN_TENTATIVAS    numero de tentativas de bootstrap (padrao 30)
#   RFN_INTERVALO     segundos entre tentativas (padrao 30)
#
# O cache fica em /mnt/rfn para sobreviver a um reset de fabrica: o diretorio
# /tmp e apagado no reboot e o /etc volta ao estado de fabrica. Sem cache o
# agente so consegue restaurar quando o servidor do provedor esta acessivel.

set -eu

CONF=${RFN_CONF:-/etc/rfn-agent.conf}
[ -f "$CONF" ] && . "$CONF"
[ -f /etc/rfn-agent.local.conf ] && . /etc/rfn-agent.local.conf

: "${RFN_SERVER:?defina RFN_SERVER em $CONF}"
: "${RFN_TOKEN:?defina RFN_TOKEN em $CONF}"

LOG=${RFN_LOG:-/var/log/rfn-agent.log}
ENV_LOCAL=${RFN_ENV_LOCAL:-/tmp/rfn-env.env}
CACHE_DIR=${RFN_CACHE_DIR:-/mnt/rfn}
CACHE=${RFN_CACHE:-$CACHE_DIR/cache.env}
LOGIN_DIR=${RFN_LOGIN_DIR:-/www}
LOGIN_ALVOS=${RFN_LOGIN_ALVOS:-/www/webpages/login.html,/usr/www/login.html,/www/login.html}
LOGIN_FILE="$LOGIN_DIR/rfn-login.html"
TENTATIVAS=${RFN_TENTATIVAS:-30}
INTERVALO=${RFN_INTERVALO:-30}

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Deteccao de identidade do equipamento
# ---------------------------------------------------------------------------

detect_serial() {
  if [ -n "${RFN_SERIAL:-}" ]; then
    printf '%s' "$RFN_SERIAL"
    return
  fi
  for arquivo in \
    /proc/sys/kernel/serialno \
    /sys/class/dmi/id/product_serial \
    /tmp/sysinfo/model \
    /tmp/sysinfo/serial \
    /proc/device-tree/serial-number; do
    [ -r "$arquivo" ] || continue
    valor=$(tr -d '\r\n' < "$arquivo" 2>/dev/null || true)
    if [ -n "$valor" ]; then
      printf '%s' "$valor"
      return
    fi
  done
  valor=$(sed -n 's/.*"serial_number"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' /etc/board.json 2>/dev/null | head -n 1)
  if [ -n "$valor" ]; then
    printf '%s' "$valor"
    return
  fi
  printf '%s' "$(hostname 2>/dev/null || echo rfn-cpe)"
}

detect_identificador() {
  if [ -n "${RFN_IDENTIFICADOR:-}" ]; then
    printf '%s' "$RFN_IDENTIFICADOR"
    return
  fi
  valor=$(uci -q get rfn.identificador 2>/dev/null || true)
  printf '%s' "$valor"
}

# O MAC sobrevive ao reset de fabrica e permite ao servidor reconhecer o
# equipamento mesmo quando o serial e apagado.
detect_mac() {
  for arquivo in /sys/class/net/*/address; do
    [ -r "$arquivo" ] || continue
    valor=$(tr -d '\r\n' < "$arquivo" 2>/dev/null || true)
    case "$valor" in
      *:*) printf '%s' "$valor"; return ;;
    esac
  done
  printf ''
}

# ---------------------------------------------------------------------------
# Comunicacao com o servidor do provedor
# ---------------------------------------------------------------------------

download() {
  url="$1"
  destino="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 20 "$url" -o "$destino"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -T 20 -O "$destino" "$url"
  else
    return 1
  fi
}

# Envia o resultado da restauracao para o painel.
reportar() {
  resultado="$1"
  detalhe="$2"
  serial="$3"
  identificador="$4"
  mac="$5"
  corpo="{\"resultado\":\"$resultado\",\"detalhe\":\"$detalhe\",\"serial\":\"$serial\",\"identificador\":\"$identificador\",\"mac\":\"$mac\"}"
  url="$RFN_SERVER/bootstrap/status?token=$RFN_TOKEN"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 15 -X POST -H 'content-type: application/json' -d "$corpo" "$url" >/dev/null 2>&1 || true
  elif command -v wget >/dev/null 2>&1; then
    wget -q -T 15 --header='content-type: application/json' --post-data="$corpo" -O /dev/null "$url" 2>/dev/null || true
  fi
}

buscar_env() {
  serial="$1"
  identificador="$2"
  mac="$3"
  url="$RFN_SERVER/bootstrap/env?token=$RFN_TOKEN"
  [ -n "$serial" ] && url="$url&serial=$serial"
  [ -n "$identificador" ] && url="$url&identificador=$identificador"
  [ -n "$mac" ] && url="$url&mac=$mac"
  download "$url" "$ENV_LOCAL" || return 1
  [ -s "$ENV_LOCAL" ] || return 1
  grep -q '^RFN_WAN_PROTO=' "$ENV_LOCAL" || return 1
  return 0
}

# ---------------------------------------------------------------------------
# Aplicacao da configuracao
# ---------------------------------------------------------------------------

aplicar_uci() {
  # shellcheck disable=SC1090
  . "$ENV_LOCAL"
  command -v uci >/dev/null 2>&1 || {
    log "uci ausente: configuracao nao pode ser aplicada"
    return 0
  }

  uci set network.wan.proto="$RFN_WAN_PROTO" 2>/dev/null || true
  [ -n "$RFN_WAN_USER" ] && uci set network.wan.username="$RFN_WAN_USER" 2>/dev/null || true
  [ -n "$RFN_WAN_PASS" ] && uci set network.wan.password="$RFN_WAN_PASS" 2>/dev/null || true
  [ "$RFN_WAN_VLAN" != "0" ] && uci set network.wan.vlan="$RFN_WAN_VLAN" 2>/dev/null || true
  [ -n "$RFN_WAN_MTU" ] && uci set network.wan.mtu="$RFN_WAN_MTU" 2>/dev/null || true
  [ -n "$RFN_LAN_IP" ] && uci set network.lan.ipaddr="$RFN_LAN_IP" 2>/dev/null || true
  [ -n "$RFN_LAN_MASK" ] && uci set network.lan.netmask="$RFN_LAN_MASK" 2>/dev/null || true
  [ -n "$RFN_LAN_DNS" ] && uci set network.lan.dns="$RFN_LAN_DNS" 2>/dev/null || true
  uci commit network 2>/dev/null || true

  if [ -d /etc/config/wireless ]; then
    uci set wireless.@wifi[0].ssid="$RFN_WIFI_SSID" 2>/dev/null || true
    [ -n "$RFN_WIFI_PASS" ] && uci set wireless.@wifi[0].key="$RFN_WIFI_PASS" 2>/dev/null || true
    [ -n "$RFN_WIFI_HIDDEN" ] && uci set wireless.@wifi[0].hidden="$RFN_WIFI_HIDDEN" 2>/dev/null || true
    uci commit wireless 2>/dev/null || true
  fi

  # Reponto o TR-069 do proprio equipamento para o ACS do provedor.
  if [ -f /etc/config/cwmpd ]; then
    [ -n "$RFN_ACS_URL" ] && uci set cwmpd.@cwmpd[0].url="$RFN_ACS_URL" 2>/dev/null || true
    [ -n "$RFN_ACS_USER" ] && uci set cwmpd.@cwmpd[0].username="$RFN_ACS_USER" 2>/dev/null || true
    [ -n "$RFN_ACS_PASS" ] && uci set cwmpd.@cwmpd[0].password="$RFN_ACS_PASS" 2>/dev/null || true
    uci commit cwmpd 2>/dev/null || true
  fi

  # Guarda o identificador de provisionamento para os proximos resets.
  uci set rfn=rfn 2>/dev/null || true
  [ -n "$RFN_IDENTIFICADOR" ] && uci set rfn.identificador="$RFN_IDENTIFICADOR" 2>/dev/null || true
  uci commit rfn 2>/dev/null || true

  log "configuracao aplicada (proto=$RFN_WAN_PROTO ssid=$RFN_WIFI_SSID ip=$RFN_LAN_IP)"
}

publicar_login() {
  serial="$1"
  identificador="$2"
  mac="$3"
  url="$RFN_SERVER/bootstrap/login.html?token=$RFN_TOKEN"
  [ -n "$serial" ] && url="$url&serial=$serial"
  [ -n "$identificador" ] && url="$url&identificador=$identificador"
  [ -n "$mac" ] && url="$url&mac=$mac"
  mkdir -p "$LOGIN_DIR" 2>/dev/null || true
  if download "$url" "$LOGIN_FILE"; then
    log "tela de login publicada em $LOGIN_FILE"
    # Alguns equipamentos servem a tela de login em caminho proprio: publica
    # nos diretorios que existem no equipamento.
    for alvo in $(printf '%s' "$LOGIN_ALVOS" | tr ',' ' '); do
      [ -n "$alvo" ] || continue
      [ "$alvo" = "$LOGIN_FILE" ] && continue
      diretorio=$(dirname "$alvo")
      [ -d "$diretorio" ] || continue
      if cp "$LOGIN_FILE" "$alvo" 2>/dev/null; then
        log "tela de login tambem publicada em $alvo"
      fi
    done
  else
    log "falha ao publicar tela de login"
  fi
}

principal() {
  serial=$(detect_serial)
  identificador=$(detect_identificador)
  mac=$(detect_mac)
  log "agente iniciado (serial=$serial identificador=$identificador mac=$mac)"

  mkdir -p "$CACHE_DIR" 2>/dev/null || true
  chmod 700 "$CACHE_DIR" 2>/dev/null || true

  tentativa=1
  while [ "$tentativa" -le "$TENTATIVAS" ]; do
    if buscar_env "$serial" "$identificador" "$mac"; then
      log "configuracao obtida no servidor do provedor"
      cp "$ENV_LOCAL" "$CACHE" 2>/dev/null || true
      aplicar_uci
      publicar_login "$serial" "$identificador" "$mac"
      reportar "sucesso" "configuracao do provedor aplicada e tela de login publicada" "$serial" "$identificador" "$mac"
      log "restauracao concluida"
      exit 0
    fi
    log "tentativa $tentativa/$TENTATIVAS: servidor do provedor indisponivel"
    tentativa=$((tentativa + 1))
    sleep "$INTERVALO"
  done

  if [ -s "$CACHE" ]; then
    log "servidor indisponivel: restaurando a partir do cache offline"
    cp "$CACHE" "$ENV_LOCAL"
    aplicar_uci
    publicar_login "$serial" "$identificador" "$mac"
    reportar "sucesso" "restauracao concluida a partir do cache offline" "$serial" "$identificador" "$mac"
    log "restauracao concluida via cache"
    exit 0
  fi

  log "sem cache disponivel: equipamento permanece no padrao de fabrica"
  reportar "falha" "servidor do provedor inacessivel e sem cache offline" "$serial" "$identificador" "$mac"
  exit 1
}

principal "$@"
