# Contexto do sistema (leia antes de mexer)

Sistema interno da **Lucminas Empilhadeiras** (locação de empilhadeiras, Contagem/MG).
Começou como "Envio de Faturas" e vai crescer para o sistema da empresa toda
(ordens de serviço, frota/equipamentos, operação). Quem conduz: Júlia (juliamaria@lucminas.com.br).
Toda a comunicação com o time é em **português**, sem jargão técnico, com passo a passo exato.

## Pessoas e perfis
| Pessoa | Login | Perfil | O que faz |
|---|---|---|---|
| Júlia | juliamaria@lucminas.com.br | admin | administra o sistema (Usuários e permissões) |
| Angelise ("Angeli") | lucminas@lucminas.com.br | financeiro | faturas, envio, aprova alterações de Operações |
| Júnior | locacao@lucminas.com.br | operacoes | movimentações, conferência de frotas, oficina; **não** vê somas de valores; alterações de cadastro vão para aprovação |

Técnicos (a cadastrar, perfil `tecnico`): Eduardo Silva, Eduardo DLuca ("Dudu"), Eneiton, Fabrício. Dono: perfil `diretoria`.

Permissões (desde nov/2026): tabela `perfis` (migração 13) com nível por aba — 0 não vê, 1 vê, 2 edita —
e "vê valores". Lista de abas em `api/src/permissoes.ts` (servidor, confere toda rota com `exigir(nivel, ...abas)`)
e `web/src/lib/acesso.ts` (menu, rotas, tela). A Júlia muda tudo na tela **Usuários e permissões**.
Regras: quem tem `aprovacoes` = 2 registra direto; os outros mandam para aprovação. Valor de cada frota só vai
para quem vê valores ou faz Conferência (o técnico recebe 0). O servidor nunca deixa o sistema sem administrador.

## Arquitetura
- `web/` React 19 + Vite + TypeScript + Tailwind 3, HashRouter. `VITE_API=http` usa a API real;
  sem ela roda o modo demonstração (`web/src/api/mock.ts`, usado no GitHub Pages).
- `api/` Node 22 + Fastify 5 + better-sqlite3 (SQLite). Migrações **só por acréscimo** no array
  `MIGRACOES` de `api/src/db.ts` (`PRAGMA user_version`). Nunca editar migração já publicada.
- Valores em **centavos** (inteiros). Datas como texto `AAAA-MM-DD`.
- Log de alterações: tabela `historico_clientes` (campo `area`), exibido na aba Registro.
- E-mail: UOL Mail Pro, conta financeiro@lucminas.com.br. SMTP smtps.uhserver.com:465, IMAP
  imap.uhserver.com:993, pasta "Itens Enviados". Senha **só no servidor** (`/opt/faturas-dados/email-conta.json`,
  gravada por `deploy/configurar-email.sh`). Toda conexão IMAP passa por `naFilaImap` + `comPrazo` +
  `semQuedas` (um erro de socket sem listener derrubava o servidor).
- Monitor da caixa de entrada (`api/src/monitor.ts`) a cada 5 min: devoluções e confirmações de leitura.

## Servidor e publicação
- VPS Hostinger (Ubuntu 24.04), IP 187.41.106.94, domínio **faturas.lucminas.com.br** (DNS no Registro.br).
- Código em `/opt/faturas`, dados em `/opt/faturas-dados` (banco `faturas.db`, PDFs enviados em `envios/`).
- Docker compose: `caddy` (HTTPS automático) + `api`. Timer systemd `faturas-atualizar` puxa o GitHub
  a cada 5 min e roda `deploy/atualizar.sh` (testes + build). Push na `main` = publicado em até 5 min.
- A tela se recarrega sozinha quando sai versão nova (`web/src/lib/versao.ts`).
- Comandos no terminal do servidor (Web console da Hostinger):
  - `bash /opt/faturas/deploy/atualizar.sh` — publicar agora
  - `bash /opt/faturas/deploy/usuario.sh criar email "Nome" --chamar Apelido --senha [--perfil operacoes]`
  - `bash /opt/faturas/deploy/usuario.sh listar | senha | perfil | desativar | reativar`
  - `bash /opt/faturas/deploy/configurar-email.sh` — guardar/trocar a senha do e-mail

## Como testar localmente
- `cd api && npx vitest run` / `cd web && npx vitest run && npx tsc -b`
- Ponta a ponta: API com `BANCO=<arquivo> COOKIE_SEGURO=0 npx tsx src/servidor.ts`, web com
  `VITE_API=http npx vite build && npx vite preview --port 4174` (proxy de /api para :3333), Playwright.

## Regras combinadas com a Júlia
- Não preencher datas de faturamento/locação automaticamente (só sugerir; a pessoa confirma).
- Não subir dados reais de clientes/planilhas para o repositório (é público).
- Nunca pedir senha de root nem senha de e-mail no chat.
- Commits terminam com as linhas de coautoria do Claude.
- Antes de mudanças grandes, mostrar o plano e esperar aprovação.

## Módulos hoje
Envio do mês (lote de PDFs → e-mail), Calendário (faturas + fim de locação), Frotas (relação, oficina,
relatório PDF, Excel), Clientes, Solicitações, Movimentações (locação/troca/devolução), Conferência
(mensal de frotas), Aprovações, Histórico (envios, leitura, devolução), Registro, Configurações (texto do e-mail).

## Navegação
Menu lateral com 6 grupos (Início, Operação, Frota, Financeiro, Clientes, Administração), Painel do dia em
`/inicio` (cartões conforme o perfil) e busca no topo (`components/BuscaGeral.tsx`; as telas leem `?busca=`).

## Próximo passo (nov/2026)
Fase 1 (navegação e permissões) feita. Próximas: 2 equipamentos (importar Quadro Geral Manutenção: relação
de frota, valor frota, contratos, histórico Auvo), 3 painel de manutenção (aba Programação; tipos CF 30 dias,
CR corretiva, B 350 h, C 500 h, D 1000 h, editáveis em Configurações), 4 app do dono (busca "motor de partida
frota 40"), 5 ordens de serviço no celular dos técnicos (offline), 6 serviços externos (só etapas, sem automação).
Sem integração com o Auvo. A planilha real do Júnior NÃO vai para o repositório. Requisitos levantados com base em Auvo,
Produttivo, Field Control e softwares de locação — ver documento de requisitos.
