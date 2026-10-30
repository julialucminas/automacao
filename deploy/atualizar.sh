#!/usr/bin/env bash
# Puxa a versão mais nova do GitHub e, se mudou, testa, monta e publica.
# Roda sozinho a cada 5 minutos (faturas-atualizar.timer).
# Manual:  bash /opt/faturas/deploy/atualizar.sh --forcar
# Logs:    journalctl -u faturas-atualizar -n 50
set -euo pipefail

# Tudo dentro de uma função: este arquivo pode ser substituído pelo "git reset" abaixo enquanto roda,
# e o bash só executa a função depois de ler o arquivo inteiro.
principal() {
  local DIR="/opt/faturas"
  local DADOS="/opt/faturas-dados"
  local COMPOSE="$DIR/deploy/docker-compose.yml"
  cd "$DIR"

  # evita duas atualizações ao mesmo tempo
  exec 9>/var/lock/faturas-atualizar.lock
  flock -n 9 || { echo "Atualização já em andamento."; return 0; }

  local ANTES DEPOIS
  ANTES=$(git rev-parse HEAD)
  git fetch -q origin main
  git reset -q --hard origin/main
  DEPOIS=$(git rev-parse HEAD)

  if [ "$ANTES" = "$DEPOIS" ] && [ "${1:-}" != "--forcar" ]; then
    return 0
  fi

  echo "Publicando: $(git log -1 --format='%h %s')"

  # pasta do banco de dados (fora do código; o usuário "node" do container é o 1000)
  mkdir -p "$DADOS"
  chown 1000:1000 "$DADOS"

  # 1) monta a API primeiro (roda os testes dela); se falhar, nada muda no ar
  docker compose -f "$COMPOSE" build api

  # 2) monta a interface (testes + build); se falhar, a versão anterior continua no ar
  docker run --rm -e VITE_API=http -v "$DIR/web:/app" -w /app node:22-alpine \
    sh -c "npm ci --no-audit --no-fund && npm test && npx vite build --outDir dist-nova --emptyOutDir"
  rm -rf "$DIR/web/dist-anterior"
  if [ -d "$DIR/web/dist" ]; then mv "$DIR/web/dist" "$DIR/web/dist-anterior"; fi
  mv "$DIR/web/dist-nova" "$DIR/web/dist"

  # 3) sobe tudo
  docker compose -f "$COMPOSE" up -d --remove-orphans
  docker compose -f "$COMPOSE" exec -T caddy caddy reload --config /etc/caddy/Caddyfile </dev/null >/dev/null 2>&1 || true
  docker image prune -f >/dev/null 2>&1 || true

  echo "Publicado."
}

principal "$@" </dev/null
