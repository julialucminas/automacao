#!/usr/bin/env bash
# Puxa a versão mais nova do GitHub e, se mudou, monta e publica.
# Roda sozinho a cada 5 minutos (faturas-atualizar.timer).
# Manual:  bash /opt/faturas/deploy/atualizar.sh --forcar
# Logs:    journalctl -u faturas-atualizar -n 50
set -euo pipefail

DIR="/opt/faturas"
cd "$DIR"

# evita duas atualizações ao mesmo tempo
exec 9>/var/lock/faturas-atualizar.lock
flock -n 9 || { echo "Atualização já em andamento."; exit 0; }

ANTES=$(git rev-parse HEAD)
git fetch -q origin main
git reset -q --hard origin/main
DEPOIS=$(git rev-parse HEAD)

if [ "$ANTES" = "$DEPOIS" ] && [ "${1:-}" != "--forcar" ]; then
  exit 0
fi

echo "Publicando: $(git log -1 --format='%h %s')"

# monta a interface num container (não precisa instalar Node no servidor);
# se algum teste falhar, para aqui e a versão anterior continua no ar
docker run --rm -v "$DIR/web:/app" -w /app node:22-alpine \
  sh -c "npm ci --no-audit --no-fund && npm test && npx vite build --outDir dist-nova --emptyOutDir"
rm -rf "$DIR/web/dist-anterior"
[ -d "$DIR/web/dist" ] && mv "$DIR/web/dist" "$DIR/web/dist-anterior"
mv "$DIR/web/dist-nova" "$DIR/web/dist"

docker compose -f "$DIR/deploy/docker-compose.yml" up -d --remove-orphans
docker compose -f "$DIR/deploy/docker-compose.yml" exec -T caddy caddy reload --config /etc/caddy/Caddyfile </dev/null >/dev/null 2>&1 || true

echo "Publicado."
