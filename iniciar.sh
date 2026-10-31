#!/usr/bin/env bash
# Sobe o painel + ACS do provedor em um comando so.
# Uso: sh iniciar.sh   (ou: ./iniciar.sh)
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18 ou superior e necessario." >&2
  exit 1
fi

VERSAO=$(node -p "process.versions.node.split('.')[0]")
if [ "${VERSAO:-0}" -lt 18 ]; then
  echo "Node.js 18 ou superior e necessario (encontrado $(node -v))." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "==> Instalando dependencias do painel..."
  npm install
fi

if [ ! -f dist/index.html ] || [ -n "$(find src index.html vite.config.ts -newer dist/index.html 2>/dev/null || true)" ]; then
  echo "==> Compilando o painel..."
  npm run build
fi

echo "==> Subindo painel + ACS (Ctrl+C para parar)"
exec node server/index.mjs
