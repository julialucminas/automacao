#!/usr/bin/env bash
# Instalação do servidor do Envio de Faturas (Lucminas Empilhadeiras).
# Rodar UMA vez, como root, num Ubuntu 24.04 novo:
#   curl -fsSL https://raw.githubusercontent.com/julialucminas/automacao/main/deploy/instalar.sh | bash
# Pode ser rodado de novo sem problema (não apaga nada).
set -euo pipefail

REPO="https://github.com/julialucminas/automacao.git"
DIR="/opt/faturas"
DOMINIO="faturas.lucminas.com.br"

passo() { echo; echo "==> $*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Rode como root." >&2
  exit 1
fi
export DEBIAN_FRONTEND=noninteractive

passo "1/6 Atualizando o sistema (pode levar alguns minutos)"
apt-get update -y
apt-get -o Dpkg::Options::=--force-confold upgrade -y
apt-get install -y git curl ca-certificates ufw fail2ban unattended-upgrades

passo "2/6 Segurança: firewall, bloqueio de ataques e atualizações automáticas"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
systemctl enable --now fail2ban
echo 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";' > /etc/apt/apt.conf.d/20auto-upgrades

passo "3/6 Instalando o Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

passo "4/6 Baixando o sistema do GitHub"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q origin main
  git -C "$DIR" reset -q --hard origin/main
else
  git clone -q "$REPO" "$DIR"
fi

passo "5/6 Montando e publicando o sistema"
bash "$DIR/deploy/atualizar.sh" --forcar

passo "6/6 Ligando a atualização automática (verifica o GitHub a cada 5 minutos)"
cat > /etc/systemd/system/faturas-atualizar.service <<EOF
[Unit]
Description=Atualiza o Envio de Faturas a partir do GitHub
After=network-online.target docker.service

[Service]
Type=oneshot
ExecStart=/bin/bash $DIR/deploy/atualizar.sh
EOF
cat > /etc/systemd/system/faturas-atualizar.timer <<'EOF'
[Unit]
Description=Verifica atualizações do Envio de Faturas a cada 5 minutos

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now faturas-atualizar.timer

echo
echo "============================================================"
echo " PRONTO! Instalação concluída."
echo " Endereço: https://$DOMINIO"
echo " (o certificado HTTPS sai sozinho assim que o DNS propagar;"
echo "  se ainda não abrir, espere alguns minutos)"
echo "============================================================"
