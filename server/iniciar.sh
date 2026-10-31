#!/bin/sh
# Sobe o painel RFN (ACS TR-069 + painel web) em primeiro plano.
# Util para teste local e para rodar dentro de container.
#
#   sh server/iniciar.sh
#
# As variaveis sao lidas do arquivo "env" na raiz do projeto, quando existe.
set -eu

cd "$(dirname "$0")/.."

if [ -f "./env" ]; then
  set -a
  . "./env"
  set +a
fi

exec node server/index.mjs "$@"
