import type { AvisoOk, Envio, Movimentacao } from '../types';

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
export const urgentesEmAberto = (movs: Movimentacao[], ok: Map<string, AvisoOk>) =>
  movs.filter((m) => m.dados.obsUrgente && m.dados.observacoes && m.status !== 'rejeitada' && !ok.has(chaveObs(m)));
