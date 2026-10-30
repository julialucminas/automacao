#!/usr/bin/env bash
# Teste de envio real pelo e-mail da empresa (UOL). Rodar no Web console do servidor:
#   bash /opt/faturas/deploy/testar-email.sh seu-email@gmail.com
# Envia de financeiro@lucminas.com.br (outra conta: --conta outra@lucminas.com.br).
# Só pergunta a senha (escondida, não fica salva).
set -euo pipefail
docker compose -f /opt/faturas/deploy/docker-compose.yml exec api node dist/cli.js testar-email "$@"
