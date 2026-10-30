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
process.on('SIGINT', encerrar);

await app.listen({ host: '0.0.0.0', port: Number(process.env.PORTA ?? 3333) });
