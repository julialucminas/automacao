import type { AvisoOk, Envio, Movimentacao, NotaMov } from '../types';

/** Chaves do "ok" nas pendências (iguais às do servidor). */
export const chaveEnvio = (e: Pick<Envio, 'id'>) => `envio:${e.id}`;
export const chaveContrato = (frota: string, vence: string) => `contrato:${frota}:${vence}`;

/** E-mails de fatura devolvidos ou que não saíram e que ninguém deu ok ainda. */
export const emailsComProblema = (envios: Envio[], ok: Map<string, AvisoOk>) =>
  envios.filter((e) => (e.status === 'devolvido' || e.status === 'falhou') && !ok.has(chaveEnvio(e)));

/** "ok por Angelise em 12/11" */
export const textoOk = (a: AvisoOk) =>
  `ok por ${a.feitoPor || '—'} em ${new Date(a.feitoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}${a.obs ? ` · ${a.obs}` : ''}`;

/** Observação urgente de uma movimentação: balãozinho até alguém dar ok. */
export const chaveObs = (m: Pick<Movimentacao, 'id'>) => `obs:${m.id}`;
/** observação acrescentada depois (cada uma tem o seu ok) */
export const chaveNota = (m: Pick<Movimentacao, 'id'>, nota: Pick<NotaMov, 'id'>) => `obs:${m.id}:${nota.id}`;

/** Uma observação urgente: a do lançamento ou uma acrescentada depois. */
export type Urgencia = { m: Movimentacao; chave: string; texto: string; por: string; em: string };

/** Todas as observações urgentes de uma movimentação (abertas ou já com ok). */
export function urgenciasDe(m: Movimentacao): Urgencia[] {
  if (m.status === 'rejeitada') return [];
  const l: Urgencia[] = [];
  if (m.dados.obsUrgente && m.dados.observacoes) l.push({ m, chave: chaveObs(m), texto: m.dados.observacoes, por: m.criadaPorNome, em: m.criadaEm });
  for (const n of m.dados.notas ?? []) if (n.urgente) l.push({ m, chave: chaveNota(m, n), texto: n.texto, por: n.porNome, em: n.em });
  return l;
}

/** Observações urgentes que ninguém deu ok ainda (as mais novas primeiro). */
export const urgenciasEmAberto = (movs: Movimentacao[], ok: Map<string, AvisoOk>) =>
  movs
    .flatMap(urgenciasDe)
    .filter((u) => !ok.has(u.chave))
    .sort((a, b) => b.em.localeCompare(a.em));
