import type { AvisoOk, Envio } from '../types';

/** Chaves do "ok" nas pendências (iguais às do servidor). */
export const chaveEnvio = (e: Pick<Envio, 'id'>) => `envio:${e.id}`;
export const chaveContrato = (frota: string, vence: string) => `contrato:${frota}:${vence}`;

/** E-mails de fatura devolvidos ou que não saíram e que ninguém deu ok ainda. */
export const emailsComProblema = (envios: Envio[], ok: Map<string, AvisoOk>) =>
  envios.filter((e) => (e.status === 'devolvido' || e.status === 'falhou') && !ok.has(chaveEnvio(e)));

/** "ok por Angelise em 12/11" */
export const textoOk = (a: AvisoOk) =>
  `ok por ${a.feitoPor || '—'} em ${new Date(a.feitoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}${a.obs ? ` · ${a.obs}` : ''}`;
