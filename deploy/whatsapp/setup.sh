#!/usr/bin/env bash
# Prepara a ponte do WhatsApp do netzsales neste servidor.
# Uso: bash setup.sh            (primeira vez: cria o .env e sobe a ponte)
#      bash setup.sh vercel     (mostra de novo o que colar na Vercel)
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  read -rp "Endereço do netzsales [https://controle-vendas-estoque.vercel.app]: " url
  read -rp "Token do túnel da Cloudflare (começa com eyJ): " token
  umask 077
  cat > .env <<ENV
NETZSALES_URL=${url:-https://controle-vendas-estoque.vercel.app}
TUNNEL_TOKEN=${token}
GOWA_BASIC_USER=netzsales
GOWA_BASIC_PASSWORD=$(openssl rand -hex 24)
GOWA_WEBHOOK_SECRET=$(openssl rand -hex 32)
ENV
  chmod 600 .env
  echo "Arquivo .env criado (só este servidor lê)."
fi

if [ "${1:-}" != "vercel" ]; then
  docker compose up -d
  docker compose ps
fi

# shellcheck disable=SC1091
set -a; . ./.env; set +a
cat <<MSG

Pronto. Agora cole na Vercel (Settings › Environment Variables):

  WHATSAPP_GOWA_URL         = o endereço público do túnel (ex.: https://whatsapp.seudominio.com.br)
  WHATSAPP_GOWA_USER        = ${GOWA_BASIC_USER}
  WHATSAPP_GOWA_PASSWORD    = ${GOWA_BASIC_PASSWORD}
  WHATSAPP_WEBHOOK_SECRET   = ${GOWA_WEBHOOK_SECRET}

Depois publique de novo o netzsales e conecte o número em Plataforma › WhatsApp.
MSG
