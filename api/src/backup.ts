/*
 * Cópias de segurança do banco: uma por dia em /opt/faturas-dados/copias (guardadas por 30 dias),
 * feitas com o banco em uso (o SQLite copia sem parar o sistema).
 * Elas ficam no mesmo servidor: protegem contra erro e apagamento, não contra perder o servidor.
 * Para isso existe o botão "Baixar cópia do banco" (Usuários e permissões) e o backup da Hostinger.
 */
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Banco } from './db.js';

export const PASTA_COPIAS = 'copias';
const MANTER_DIAS = 30;

export async function copiaDoDia(db: Banco, pastaDados: string, hoje = new Date()) {
  const pasta = join(pastaDados, PASTA_COPIAS);
  mkdirSync(pasta, { recursive: true });
  const dia = hoje.toISOString().slice(0, 10);
  const arq = join(pasta, `faturas-${dia}.db`);
  let feita = false;
  try {
    statSync(arq);
  } catch {
    await db.backup(arq);
    feita = true;
  }
  // apaga as mais antigas
  const limite = new Date(hoje.getTime() - MANTER_DIAS * 86_400_000).toISOString().slice(0, 10);
  for (const f of readdirSync(pasta)) {
    const m = /^faturas-(\d{4}-\d{2}-\d{2})\.db$/.exec(f);
    if (m && m[1] < limite) unlinkSync(join(pasta, f));
  }
  return { arquivo: arq, feita };
}

export function listarCopias(pastaDados: string) {
  try {
    return readdirSync(join(pastaDados, PASTA_COPIAS))
      .filter((f) => /^faturas-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort()
      .reverse()
      .map((f) => ({ arquivo: f, bytes: statSync(join(pastaDados, PASTA_COPIAS, f)).size }));
  } catch {
    return [];
  }
}

/** Roda agora e depois a cada 6 horas (só grava uma por dia). */
export function agendarCopias(db: Banco, pastaDados: string, log: (m: string) => void) {
  const rodar = () => copiaDoDia(db, pastaDados).then((r) => r.feita && log(`cópia de segurança gravada: ${r.arquivo}`), (e) => log(`falha na cópia de segurança: ${e}`));
  void rodar();
  const t = setInterval(rodar, 6 * 3_600_000);
  return () => clearInterval(t);
}
