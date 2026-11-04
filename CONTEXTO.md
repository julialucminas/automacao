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

## Equipamentos (fase 2, nov/2026)
Tabela `equipamentos` (ficha em JSON por frota, campos em `api/src/equipamentos.ts`) e `historico_pecas`
(Auvo; importar de novo substitui a origem 'auvo'). Locação continua em `clientes.frotas`; a situação
(locada/oficina/disponível/reservada/baixada) é calculada em `web/src/lib/equipamentos.ts`.
Importação do Quadro Geral pela tela (`components/ImportarQuadro.tsx` + `lib/quadroGeral.ts`); o leitor
`lib/xlsxLeve.ts` existe porque a aba do Auvo declara 16 mil colunas e trava o read-excel-file.
Na Programação, "DUDU" = Eduardo DLuca e "EDUARDO" = Eduardo Silva; no Auvo, "Eduardo" fica como está (não dá para saber).

## Painel de manutenção (fase 3, nov/2026)
Rota `/manutencao`, aba de permissão `manutencao` (perfis antigos ganham o nível padrão de abas novas
automaticamente em `permissoes.ts`). Regras em Configurações (`manutencao.tipos`, `manutencao.perifericos`, JSON
validado em `api/src/manutencao.ts`). Status da linha = visita (dias desde a última > intervalo) e preventiva
(horas faltam < 0); periféricos vencidos aparecem à parte. Pendências: tabela `pendencias` (migração 15);
reimportar a planilha troca só as abertas de origem 'planilha' e não reabre as resolvidas. Registrar visita
grava na ficha e lança no histórico com origem 'sistema' (a importação do Auvo não apaga).

## App do dono (fase 4, nov/2026)
Rota `/app` (fora do Layout, layout de celular com abas Hoje, Buscar, Dinheiro, Gastos, Avisos), aba de permissão
`appDono` (só Administrador e Diretoria). Quem só consulta (sem nível 2 nas abas de trabalho) abre direto em `/app`.
Busca em linguagem falada: `web/src/lib/buscaDono.ts` ("motor de partida frota 40"). Gastos por frota:
`GET /api/historico-pecas/por-frota?desde=`. Instalável no celular (manifest + ícones em `web/public`).
Dono: Arnaldo, arnaldo@lucminas.com.br, perfil diretoria.

## Ordens de serviço (fase 5, nov/2026)
Tabela `ordens` (migração 16), módulo `api/src/ordens.ts`, aba de permissão `ordens`. Fluxo: aberta → agendada →
execução (check-in com GPS) ⇄ aguardando peça → concluída (técnico) → encerrada (escritório: atualiza ficha,
histórico origem 'os', fecha a pendência; manda o PDF ao cliente pelo e-mail da empresa via `envio.enviarAvulso`).
Técnico (ordens 2 sem manutencao 2) só vê as dele e abre direto em `/campo` (celular). Escritório: `/ordens`.
Fotos e assinatura em `/opt/faturas-dados/ordens/<id>/`. PDF gerado no navegador (`web/src/lib/ordens.ts`).
Sem internet: fila no IndexedDB (`web/src/lib/filaOffline.ts`), service worker `web/public/sw.js`, e o último
usuário fica guardado para abrir sem sinal. Checklists por tipo em `CHECKLISTS` (código).
Relatório ao cliente desligado por padrão (config `os.relatorioCliente`, Configurações → Manutenção).
Modelos de OS (migração 17, `api/src/modelos.ts`, tela `/modelos-os`): cada tipo de OS com seu formulário
(seção, checklist, sim/não, texto, número, lista, múltipla, data, foto), horímetro/assinatura/fotos mínimas
configuráveis. A OS guarda uma cópia do formulário (`execucao.formulario`) e as respostas (`execucao.respostas`);
mudar o modelo não mexe nas OS já abertas. OS antigas seguem com o `checklist` fixo.
Cópias do banco: uma por dia em `/opt/faturas-dados/copias` (30 dias) + botão de baixar (Usuários e permissões).

## Serviços externos (fase 6, nov/2026)
Tabela `servicos_externos` (migração 18), módulo `api/src/externos.ts`, aba de permissão `externos`, tela `/externos`
(quadro por etapa). Etapas: pedido → orçamento → enviado → aprovado/recusado → execução → concluído (a cobrar) → cobrado.
Sem automação (nada de e-mail ou boleto): só etapa, responsável, previsão, nº da OS e histórico de quem mudou.
Valor do orçamento só para quem vê valores (os outros recebem null e não conseguem mudar).

## Navegação
Menu lateral com 6 grupos (Início, Operação, Frota, Financeiro, Clientes, Administração), Painel do dia em
`/inicio` (cartões conforme o perfil) e busca no topo (`components/BuscaGeral.tsx`; as telas leem `?busca=`).

## Próximo passo (nov/2026)
Fases 1 (navegação e permissões), 2 (equipamentos + importação) e 3 (painel de manutenção) feitas. Fases 4 (app do dono) e 5 (ordens de serviço, com modelos de OS) feitas. Fase 6 (serviços externos) feita. Todas as fases do documento de requisitos estão entregues; próximos ajustes vêm do uso.
Sem integração com o Auvo. A planilha real do Júnior NÃO vai para o repositório. Requisitos levantados com base em Auvo,
Produttivo, Field Control e softwares de locação — ver documento de requisitos.
