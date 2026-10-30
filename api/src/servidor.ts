import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { abrirBanco } from './db.js';
import { criarApp } from './app.js';

const caminho = process.env.BANCO ?? '/dados/faturas.db';
mkdirSync(dirname(caminho), { recursive: true });

const db = abrirBanco(caminho);
const app = criarApp(db, { cookieSeguro: process.env.COOKIE_SEGURO !== '0', logger: true, pastaDados: dirname(caminho), monitorar: true });

const encerrar = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', encerrar);
// rede de segurança: um erro solto (ex.: queda de conexão com o e-mail) não pode derrubar o sistema
process.on('uncaughtException', (e) => app.log.error({ err: e }, 'erro não tratado (servidor continua no ar)'));
process.on('unhandledRejection', (e) => app.log.error({ err: e }, 'promessa rejeitada sem tratamento (servidor continua no ar)'));
process.on('SIGINT', encerrar);

await app.listen({ host: '0.0.0.0', port: Number(process.env.PORTA ?? 3333) });
