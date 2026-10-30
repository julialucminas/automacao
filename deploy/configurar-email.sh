#!/usr/bin/env bash
# Guarda no servidor a senha do e-mail que envia as faturas. Rodar no Web console do servidor:
#   bash /opt/faturas/deploy/configurar-email.sh
# Usa financeiro@lucminas.com.br (outra conta: --conta outra@lucminas.com.br).
# A senha é digitada escondida, conferida no UOL e só então guardada.
set -euo pipefail
docker compose -f /opt/faturas/deploy/docker-compose.yml exec api node dist/cli.js configurar-email "$@"
