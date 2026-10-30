#!/usr/bin/env bash
# Usuários do sistema. Rodar no Web console do servidor, como root:
#   bash /opt/faturas/deploy/usuario.sh criar  email@lucminas.com.br "Nome da pessoa"
#   bash /opt/faturas/deploy/usuario.sh senha  email@lucminas.com.br     (gera senha nova)
#   bash /opt/faturas/deploy/usuario.sh desativar email@lucminas.com.br
#   bash /opt/faturas/deploy/usuario.sh reativar  email@lucminas.com.br
#   bash /opt/faturas/deploy/usuario.sh listar
set -euo pipefail
docker compose -f /opt/faturas/deploy/docker-compose.yml exec -T api node dist/cli.js "$@"
