# Envio de Faturas · Lucminas Empilhadeiras

Sistema para enviar por e-mail as faturas de locação e os boletos (PDF) aos clientes,
a partir de financeiro@lucminas.com.br, com cópia na pasta Enviados e histórico de rastreamento.

## Estado atual

- **Servidor (faturas.lucminas.com.br):** interface + API com banco SQLite e login. Envio real ainda desligado.
- **Prévia no GitHub Pages:** mesma interface em modo demonstração (dados só no navegador).

O modo é escolhido no build: `VITE_API=http` usa a API; sem a variável, usa `web/src/api/mock.ts`.

## Rodar

```bash
cd web
npm install
npm run dev     # http://localhost:5173
npm test        # testes do pareamento
npm run build   # gera web/dist
```

Na tela de login, qualquer e-mail e senha entram (demonstração).
Na tela "Envio do mês", o botão **Usar arquivos de exemplo** carrega um lote fictício com todos os casos.

## Estrutura

```
web/src/
  api/          contrato da API (index.ts) + implementação simulada (mock.ts)
  lib/
    pareamento.ts   regras de nome, junção fatura+boleto, busca do cliente  (com testes)
    normalizar.ts   comparação de nomes: ignora acento, pontuação, LTDA/ME/SA
    leitura.ts      lê pasta, arrastar-e-soltar e .zip (inclui nomes CP850 de zips do Windows)
    email.ts        assunto/corpo do e-mail, remetente, datas
    exemplo.ts      PDFs fictícios para demonstração
  pages/        Login, Envio (Carregar + Conferência), Clientes, Histórico
  components/   Layout, formulário de cliente, modal/gaveta, ícones
  state.tsx     estado global (usuário, clientes, lote em conferência, envios)
```

## Regras de nome

| Arquivo | Padrão | Aceita também |
|---|---|---|
| Fatura | `1234 NOME DA EMPRESA.PDF` | minúsculas, `1234 - NOME`, `1234_NOME`, zeros à esquerda |
| Boleto | `BOLETO 1234.PDF` | `BOLETO-1234`, `BOLETO1234`, zeros à esquerda |

## Importar clientes

Aba Clientes → **Importar planilha** (.xlsx ou .csv). Aceita o formato simples
(`Cliente | Email`, com várias linhas por cliente e o nome só na primeira) ou o modelo completo
(`Nome no arquivo | Outros nomes | CNPJ | Para | Cópia | Observações`). Mostra prévia antes de gravar,
aponta e-mails inválidos e domínios com provável erro de digitação, e nunca apaga e-mails já cadastrados.

**Não coloque a planilha real de clientes neste repositório** (ele é público).

Situações na conferência: pronto · fatura sem boleto · empresa sem cadastro ·
boleto sem fatura · número repetido · já enviada antes (fica desmarcada).

## API (`api/`)

Node + Fastify + SQLite (better-sqlite3). Banco no servidor em `/opt/faturas-dados/faturas.db`
(fora da pasta do código). Login por cookie de sessão (httpOnly, SameSite=Strict), senhas com scrypt,
limite de tentativas. Toda alteração em cliente fica registrada em `historico_clientes`.

```bash
cd api && npm install && npm test
npm run dev      # API em http://localhost:3333 (banco em api/dados-dev)
cd ../web && VITE_API=http npm run dev   # interface usando a API
```

Usuários (no servidor):
`bash /opt/faturas/deploy/usuario.sh criar email "Nome" --chamar Apelido --senha`
(`--senha` pede a senha escondida; sem ela, o sistema gera uma). Outros comandos: `senha`, `chamar`,
`desativar`, `reativar`, `listar`. Cada pessoa também troca a própria senha no sistema (“Trocar senha”).

## Servidor (faturas.lucminas.com.br)

VPS Hostinger (Ubuntu 24.04). Instalação, uma vez, como root no Web console:

```bash
curl -fsSL https://raw.githubusercontent.com/julialucminas/automacao/main/deploy/instalar.sh | bash
```

- `deploy/instalar.sh`: firewall, fail2ban, atualizações automáticas, Docker, publicação
- `deploy/atualizar.sh`: verifica o GitHub a cada 5 min; se mudou, roda os testes, monta e publica
  (se um teste falhar, a versão anterior continua no ar). Logs: `journalctl -u faturas-atualizar -n 50`
- `deploy/docker-compose.yml` + `deploy/caddy/Caddyfile`: HTTPS automático e encaminhamento de /api

## Próximos passos

3. Envio real pelo UOL (SMTP) + cópia em Enviados (IMAP)
4. Leitura da caixa: devoluções e confirmações de leitura
5. Hospedagem (VPS) em faturas.lucminas.com.br + backup no Google Drive
