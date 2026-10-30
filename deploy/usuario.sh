#!/usr/bin/env bash
# Usuários do sistema. Rodar no Web console do servidor, como root:
#   bash /opt/faturas/deploy/usuario.sh criar  email@lucminas.com.br "Nome" --chamar Apelido --senha
#   bash /opt/faturas/deploy/usuario.sh senha  email@lucminas.com.br --senha
#   bash /opt/faturas/deploy/usuario.sh chamar email@lucminas.com.br Apelido
#   bash /opt/faturas/deploy/usuario.sh desativar | reativar email@lucminas.com.br
#   bash /opt/faturas/deploy/usuario.sh listar
# --senha: você digita a senha (não aparece na tela). Sem --senha: o sistema gera uma.
set -euo pipefail
COMPOSE=/opt/faturas/deploy/docker-compose.yml
if [ -t 0 ]; then
  docker compose -f "$COMPOSE" exec api node dist/cli.js "$@"
else
  docker compose -f "$COMPOSE" exec -T api node dist/cli.js "$@"
fi
