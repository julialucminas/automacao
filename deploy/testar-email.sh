#!/usr/bin/env bash
# Teste de envio real pelo e-mail da empresa (UOL). Rodar no Web console do servidor:
#   bash /opt/faturas/deploy/testar-email.sh
# Pede a conta, a senha (escondida, não fica salva) e um e-mail de destino para o teste.
set -euo pipefail
docker compose -f /opt/faturas/deploy/docker-compose.yml exec api node dist/cli.js testar-email
