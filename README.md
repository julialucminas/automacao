# Envio de Faturas · Lucminas Empilhadeiras

Sistema para enviar por e-mail as faturas de locação e os boletos (PDF) aos clientes,
a partir de financeiro@lucminas.com.br, com cópia na pasta Enviados e histórico de rastreamento.

## Estado atual

**Interface pronta, com dados simulados.** Nenhum e-mail sai: a camada `web/src/api/mock.ts`
guarda clientes e histórico no navegador. O backend (Node + SMTP/IMAP do UOL) entra depois,
trocando apenas `web/src/api/index.ts`.

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

## Próximos passos

2. Backend: API (Fastify + SQLite), login real, upload dos PDFs
3. Envio real pelo UOL (SMTP) + cópia em Enviados (IMAP)
4. Leitura da caixa: devoluções e confirmações de leitura
5. Hospedagem (VPS) em faturas.lucminas.com.br + backup no Google Drive
