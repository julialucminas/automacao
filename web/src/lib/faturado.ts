/*
 * "Já foi faturado no mês?" por locação. A fatura é por cliente (o envio não diz quais frotas estão nela),
 * então todas as frotas do cliente ficam com a situação do cliente no mês:
 * - faturado: tem envio de fatura com aquela referência (que não falhou) ou foi marcado como faturado no calendário;
 * - e-mail voltou: o envio existe, mas todos os e-mails daquele mês voltaram;
 * - a faturar: nada ainda.
 * Máquina que entrou no cliente DEPOIS da fatura do mês não está nela: fica "a faturar" (situacaoDaLocacao).
 */
import type { Cliente, Envio, Faturamento } from '../types';

export type EstadoFatura = 'faturado' | 'devolvido' | 'pendente';
export type SituacaoFatura = { estado: EstadoFatura; quando: string | null; numeros: string[]; manual: boolean; entrouDepois?: boolean; /** data da fatura mais recente do mês (envio ou lançada à mão) */ ultima?: string | null };

export const ROTULO_FATURA: Record<EstadoFatura, string> = { faturado: 'Faturado', devolvido: 'E-mail voltou', pendente: 'A faturar' };

/** Situação de cada cliente no mês (AAAA-MM). */
export function situacaoFaturas(clientes: Pick<Cliente, 'id'>[], envios: Envio[], faturamentos: Faturamento[], mes: string): Map<string, SituacaoFatura> {
  const r = new Map<string, SituacaoFatura>();
  for (const c of clientes) {
    const doMes = envios.filter((e) => e.clienteId === c.id && e.referencia === mes && e.status !== 'falhou').sort((a, b) => a.enviadoEm.localeCompare(b.enviadoEm));
    const entregues = doMes.filter((e) => e.status !== 'devolvido');
    const marcados = faturamentos.filter((f) => f.clienteId === c.id && f.data.startsWith(mes)).sort((a, b) => a.data.localeCompare(b.data));
    const marcado = marcados[0];
    const ultima = [...doMes.map((e) => e.enviadoEm.slice(0, 10)), ...marcados.map((f) => f.data)].sort().pop() ?? null;
    if (entregues.length) r.set(c.id, { estado: 'faturado', quando: entregues[0].enviadoEm.slice(0, 10), numeros: doMes.map((e) => e.numero), manual: false, ultima });
    else if (doMes.length) r.set(c.id, { estado: 'devolvido', quando: doMes[0].enviadoEm.slice(0, 10), numeros: doMes.map((e) => e.numero), manual: false, ultima });
    else if (marcado) r.set(c.id, { estado: 'faturado', quando: marcado.data, numeros: [], manual: marcado.origem === 'manual', ultima });
    else r.set(c.id, { estado: 'pendente', quando: null, numeros: [], manual: false });
  }
  return r;
}

/**
 * Situação de UMA locação: a do cliente, menos quando a máquina começou depois da fatura já emitida
 * (ex.: FT50 foi para a Esquipa no dia 17 e a fatura da Esquipa saiu no dia 5 → a FT50 está "a faturar").
 */
export function situacaoDaLocacao(sitCliente: SituacaoFatura | undefined, inicio: string | null | undefined): SituacaoFatura | undefined {
  const ultima = sitCliente?.ultima ?? sitCliente?.quando;
  if (!sitCliente || sitCliente.estado === 'pendente' || !inicio || !ultima) return sitCliente;
  if (inicio > ultima) return { estado: 'pendente', quando: null, numeros: [], manual: false, entrouDepois: true };
  return sitCliente;
}

export type ResumoFaturas = {
  locacoes: number;
  /** faturadas com o e-mail entregue (ou marcadas no calendário) */
  faturadas: number;
  devolvidas: number;
  pendentes: number;
  valorTotal: number;
  /** só os entregues (sem os de e-mail que voltou) */
  valorFaturado: number;
  valorDevolvido: number;
  valorPendente: number;
  clientesPendentes: number;
};

/** Totais do mês sobre as locações (frota × cliente). */
export function resumirFaturas(linhas: { clienteId: string; valor: number; inicio?: string | null }[], sit: Map<string, SituacaoFatura>): ResumoFaturas {
  const r: ResumoFaturas = { locacoes: linhas.length, faturadas: 0, devolvidas: 0, pendentes: 0, valorTotal: 0, valorFaturado: 0, valorDevolvido: 0, valorPendente: 0, clientesPendentes: 0 };
  const pendentes = new Set<string>();
  for (const l of linhas) {
    const e = situacaoDaLocacao(sit.get(l.clienteId), l.inicio)?.estado ?? 'pendente';
    r.valorTotal += l.valor;
    if (e === 'pendente') {
      r.pendentes++;
      r.valorPendente += l.valor;
      pendentes.add(l.clienteId);
    } else if (e === 'devolvido') {
      r.devolvidas++;
      r.valorDevolvido += l.valor;
    } else {
      r.faturadas++;
      r.valorFaturado += l.valor;
    }
  }
  r.clientesPendentes = pendentes.size;
  return r;
}
