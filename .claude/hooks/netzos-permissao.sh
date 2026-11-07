#!/usr/bin/env bash
# NetzOS: pedidos de permissão do Claude Code chegam no celular do dono.
#
# Hook PermissionRequest do Claude Code. Manda o pedido para o NetzOS e espera
# a resposta (Permitir ou Negar). Sem resposta no prazo, sai sem decidir e o
# Claude pergunta na tela dele, como sempre. Precisa só de bash e curl.
#
# Configuração (em .claude/settings.local.json, que não vai para o GitHub):
#   NETZOS_HOOK_URL      endereço do sistema, ex.: https://<painel>/core-api/hooks/systems/<id>
#   NETZOS_SYSTEM_TOKEN  token do conector do sistema (nzsys_…), gerado na ficha do sistema
#   NETZOS_WAIT          segundos esperando a resposta (padrão 120)
set -u
URL="${NETZOS_HOOK_URL:-}"
TOKEN="${NETZOS_SYSTEM_TOKEN:-}"
WAIT="${NETZOS_WAIT:-120}"
[ -n "$URL" ] && [ -n "$TOKEN" ] || exit 0
command -v curl >/dev/null 2>&1 || exit 0
URL="${URL%/}/permissions"

created=$(curl -sS --max-time 10 -X POST "$URL" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data-binary @- 2>/dev/null) || exit 0
id=$(printf '%s' "$created" | sed -n 's/.*"id":"\(cperm_[A-Za-z0-9-]*\)".*/\1/p')
[ -n "$id" ] || exit 0

deadline=$(( $(date +%s) + WAIT ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  sleep 2
  body=$(curl -sS --max-time 10 -w '\n%{http_code}' -H "Authorization: Bearer $TOKEN" "$URL/$id" 2>/dev/null) || continue
  code=${body##*$'\n'}
  answer=${body%$'\n'*}
  case "$code" in
    200) printf '%s\n' "$answer"; exit 0 ;;
    202) ;;
    *) exit 0 ;;
  esac
done
curl -sS --max-time 5 -X POST -H "Authorization: Bearer $TOKEN" "$URL/$id/expire" >/dev/null 2>&1
exit 0
