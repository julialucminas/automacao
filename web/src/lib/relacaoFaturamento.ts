/*
 * Relação de faturamento do mês: o que cobrar de cada cliente, locação por locação.
 *
 * Diferente da Relação das locações (onde cada máquina está AGORA), aqui entra tudo o que esteve
 * em algum cliente em algum momento do mês:
 * - locações que seguem no cliente (mês inteiro, ou desde o dia em que entraram);
 * - devolvidas e vendidas no mês (cobra até o dia da devolução informado);
 * - trocas e reajustes no meio do mês viram trechos com valores diferentes.
 *
 * Valor sugerido: proporcional sobre 30 dias (mês comercial). O último dia do mês conta como dia 30;
 * o mês inteiro dá sempre o valor cheio. A Angelise confere e corrige (o ajuste fica salvo).
 *
 * Situação da fatura:
 * - locação que segue no cliente: a do cliente no mês (situacaoDaLocacao: entrou depois da fatura = a faturar);
 * - devolvida/vendida: "a faturar" desde a devolução, até sair uma fatura do cliente com data na devolução ou depois.
 */
import type { Cliente, Envio, Faturamento, Frota, Movimentacao } from '../types';
import { situacaoDaLocacao, situacaoFaturas, type EstadoFatura, type SituacaoFatura } from './faturado';
import { diasNoMes } from './calendario';

export type TipoLinha = 'mes' | 'entrou' | 'devolvida' | 'vendida';
export type Trecho = { de: string; ate: string; dias: number; valor: number; cobrar: number };
export type Evento = { data: string; tipo: 'troca' | 'reajuste'; texto: string };

export type LinhaFaturamento = {
  chave: string;
  clienteId: string;
  clienteNome: string;
  /** máquina no fim do período (na troca, a que entrou) */
  frota: string;
  /** frotas que passaram por esta locação no mês, em ordem (troca: FT12 → FT33) */
  frotas: string[];
  tipo: TipoLinha;
  modalidade: '' | 'contrato' | 'esporadico';
  /** período cobrado dentro do mês */
  de: string;
  ate: string;
  dias: number;
  /** valor mensal no fim do período */
  valorMensal: number;
  trechos: Trecho[];
  eventos: Evento[];
  sugerido: number;
  /** sem movimentação de locação: começou antes do sistema/mês, conta desde o dia 1 */
  inicioIncerto: boolean;
  estado: EstadoFatura;
  /** data da fatura que cobriu (se faturado) */
  faturadoEm: string | null;
};

const ultimoDia = (mes: string) => `${mes}-${String(diasNoMes(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)))).padStart(2, '0')}`;
/** dia no mês comercial de 30 dias (o último dia do mês é o 30) */
function dia30(iso: string): number {
  if (iso === ultimoDia(iso.slice(0, 7))) return 30;
  return Math.min(Number(iso.slice(8, 10)), 30);
}
/** dias cobrados entre duas datas do mesmo mês, contando as duas pontas, sobre 30 */
export function dias30(de: string, ate: string): number {
  return Math.max(0, dia30(ate) - dia30(de) + 1);
}
const diaAnterior = (iso: string) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
const proporcional = (valor: number, dias: number) => (dias >= 30 ? valor : Math.round((valor * dias) / 30));
const ft = (n: string) => `FT${n}`;
const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Divide o período em trechos pelos eventos que mudam o valor (troca com valor novo, reajuste). */
function montarTrechos(de: string, ate: string, valorInicial: number, mudancas: { data: string; valor: number }[]): Trecho[] {
  const t: Trecho[] = [];
  let ini = de;
  let v = valorInicial;
  for (const m of [...mudancas].sort((a, b) => a.data.localeCompare(b.data))) {
    if (m.data > ate) break;
    if (m.data > ini) {
      const fim = diaAnterior(m.data);
      const d = dias30(ini, fim);
      t.push({ de: ini, ate: fim, dias: d, valor: v, cobrar: proporcional(v, d) });
      ini = m.data;
    }
    v = m.valor;
  }
  const d = dias30(ini, ate);
  t.push({ de: ini, ate, dias: d, valor: v, cobrar: proporcional(v, d) });
  return t.filter((x) => x.dias > 0);
}

/**
 * Volta nas movimentações para achar quando a locação desta máquina começou no cliente,
 * atravessando trocas (FT33 entrou no lugar da FT12, que tinha sido locada em tal dia).
 */
function historico(movs: Movimentacao[], frota: string, clienteId: string, ate: string) {
  const trocas: Movimentacao[] = [];
  const frotas = [frota];
  let atual = frota;
  const ordenadas = movs.filter((m) => m.dados.data <= ate).sort((a, b) => b.dados.data.localeCompare(a.dados.data) || b.criadaEm.localeCompare(a.criadaEm));
  for (const m of ordenadas) {
    if (m.tipo === 'locacao' && m.frota === atual && m.clienteId === clienteId) return { inicio: m.dados.data, trocas, frotas };
    if (m.tipo === 'troca' && m.frotaNova === atual && m.clienteId === clienteId) {
      trocas.push(m);
      atual = m.frota;
      frotas.unshift(atual);
    }
    // a máquina saiu deste cliente antes: daqui para trás é outra locação
    if ((m.tipo === 'devolucao' || m.tipo === 'venda') && m.frota === atual && m.dados.data < ate) break;
  }
  return { inicio: null as string | null, trocas, frotas };
}

/** Cliente de quem a máquina saiu numa venda (a movimentação de venda guarda o comprador). */
function clienteDaVenda(movs: Movimentacao[], m: Movimentacao): string | null {
  const antes = movs
    .filter((x) => x.dados.data <= m.dados.data && ((x.tipo === 'locacao' && x.frota === m.frota) || (x.tipo === 'troca' && x.frotaNova === m.frota)))
    .sort((a, b) => b.dados.data.localeCompare(a.dados.data));
  return antes[0]?.clienteId ?? m.clienteId;
}

export function montarFaturamento(
  mes: string,
  clientes: Cliente[],
  movimentacoes: Movimentacao[],
  envios: Envio[],
  faturamentos: Faturamento[],
): LinhaFaturamento[] {
  const S = `${mes}-01`;
  const E = ultimoDia(mes);
  const movs = movimentacoes.filter((m) => m.status === 'aprovada');
  const noMes = (d: string) => d >= S && d <= E;
  const porId = new Map(clientes.map((c) => [c.id, c]));
  const sit = situacaoFaturas(clientes, envios, faturamentos, mes);

  // datas de fatura de cada cliente (qualquer mês), para saber se a devolução já foi cobrada
  const faturasDe = (clienteId: string) =>
    [
      ...envios.filter((e) => e.clienteId === clienteId && e.status !== 'falhou').map((e) => ({ data: e.enviadoEm.slice(0, 10), voltou: e.status === 'devolvido' })),
      ...faturamentos.filter((f) => f.clienteId === clienteId).map((f) => ({ data: f.data, voltou: false })),
    ].sort((a, b) => a.data.localeCompare(b.data));

  const reajustes = (clienteId: string, frotas: string[], de: string, ate: string) =>
    movs
      .filter((m) => m.tipo === 'reajuste' && m.clienteId === clienteId && m.dados.data > de && m.dados.data <= ate)
      .flatMap((m) =>
        (m.dados.itens ?? [])
          .filter((i) => frotas.includes(i.frota))
          .map((i) => ({ data: m.dados.data, antes: i.antes ?? null, depois: i.novo, frota: i.frota })),
      );

  const linhas: LinhaFaturamento[] = [];

  const montar = (o: {
    c: Cliente | undefined;
    clienteId: string;
    clienteNome: string;
    frota: string;
    tipo: TipoLinha;
    modalidade: Frota['modalidade'];
    inicio: string | null;
    ate: string;
    valorFinal: number;
    hist: ReturnType<typeof historico>;
    estado: { estado: EstadoFatura; faturadoEm: string | null };
  }) => {
    const de = o.inicio && o.inicio > S ? o.inicio : S;
    if (de > o.ate) return;
    const trocasMes = o.hist.trocas.filter((t) => t.dados.data > de && t.dados.data <= o.ate);
    const reajs = reajustes(o.clienteId, o.hist.frotas, de, o.ate);
    const mudancas = [
      ...trocasMes.filter((t) => t.dados.valor != null && t.dados.valor !== t.dados.valorAnterior).map((t) => ({ data: t.dados.data, valor: t.dados.valor!, antes: t.dados.valorAnterior ?? null })),
      ...reajs.map((r) => ({ data: r.data, valor: r.depois, antes: r.antes })),
    ].sort((a, b) => a.data.localeCompare(b.data));
    // valor do começo: o "antes" da primeira mudança (senão, o valor de agora)
    const valorInicial = mudancas[0]?.antes ?? o.valorFinal;
    const trechos = montarTrechos(de, o.ate, valorInicial, mudancas);
    const eventos: Evento[] = [
      ...trocasMes.map((t) => ({
        data: t.dados.data,
        tipo: 'troca' as const,
        texto: `Troca em ${dm(t.dados.data)}: ${ft(t.frota)} → ${ft(t.frotaNova ?? '')}${t.dados.valor != null && t.dados.valor !== t.dados.valorAnterior ? ` (${brl(t.dados.valorAnterior ?? 0)} → ${brl(t.dados.valor)})` : ''}`,
      })),
      ...reajs.map((r) => ({ data: r.data, tipo: 'reajuste' as const, texto: `Reajuste em ${dm(r.data)}${r.antes != null ? `: ${brl(r.antes)} → ${brl(r.depois)}` : ''}` })),
    ].sort((a, b) => a.data.localeCompare(b.data));
    const frotasMes = trocasMes.length ? o.hist.frotas.slice(o.hist.frotas.length - trocasMes.length - 1) : [o.frota];
    linhas.push({
      chave: `${o.clienteId}|${frotasMes[0]}|${de}|${o.tipo}`,
      clienteId: o.clienteId,
      clienteNome: o.clienteNome,
      frota: o.frota,
      frotas: frotasMes,
      tipo: o.tipo,
      modalidade: o.modalidade ?? '',
      de,
      ate: o.ate,
      dias: dias30(de, o.ate),
      valorMensal: o.valorFinal,
      trechos,
      eventos,
      sugerido: trechos.reduce((s, t) => s + t.cobrar, 0),
      inicioIncerto: !o.inicio,
      estado: o.estado.estado,
      faturadoEm: o.estado.faturadoEm,
    });
  };

  // 1) locações que seguem no cliente
  for (const c of clientes) {
    for (const f of c.frotas) {
      if (f.inicio && f.inicio > E) continue;
      const hist = historico(movs, f.numero, c.id, E);
      const inicio = f.inicio ?? hist.inicio;
      const s = situacaoDaLocacao(sit.get(c.id), f.inicio) as SituacaoFatura | undefined;
      montar({
        c,
        clienteId: c.id,
        clienteNome: c.nome,
        frota: f.numero,
        tipo: inicio && inicio > S ? 'entrou' : 'mes',
        modalidade: f.modalidade,
        inicio,
        ate: E,
        valorFinal: f.valor,
        hist,
        estado: { estado: s?.estado ?? 'pendente', faturadoEm: s?.estado === 'pendente' ? null : (s?.quando ?? null) },
      });
    }
  }

  // 2) devolvidas e vendidas no mês: cobra até o dia informado
  for (const m of movs) {
    if ((m.tipo !== 'devolucao' && m.tipo !== 'venda') || !noMes(m.dados.data) || m.dados.valorAnterior == null) continue;
    const clienteId = m.tipo === 'venda' ? clienteDaVenda(movs, m) : m.clienteId;
    if (!clienteId) continue;
    const c = porId.get(clienteId);
    const hist = historico(movs, m.frota, clienteId, m.dados.data);
    // modalidade: a da movimentação de locação que começou isto
    const loc = movs.find((x) => x.tipo === 'locacao' && x.clienteId === clienteId && x.frota === hist.frotas[0] && x.dados.data === hist.inicio);
    const depois = faturasDe(clienteId).filter((f) => f.data >= m.dados.data);
    const ok = depois.find((f) => !f.voltou);
    montar({
      c,
      clienteId,
      clienteNome: c?.nome ?? m.clienteNome,
      frota: m.frota,
      tipo: m.tipo === 'venda' ? 'vendida' : 'devolvida',
      modalidade: loc?.dados.modalidade ?? '',
      inicio: hist.inicio,
      ate: m.dados.data,
      valorFinal: m.dados.valorAnterior,
      hist,
      estado: ok ? { estado: 'faturado', faturadoEm: ok.data } : depois.length ? { estado: 'devolvido', faturadoEm: depois[0].data } : { estado: 'pendente', faturadoEm: null },
    });
  }

  return linhas.sort((a, b) => a.clienteNome.localeCompare(b.clienteNome) || a.de.localeCompare(b.de) || a.frota.localeCompare(b.frota, 'pt-BR', { numeric: true }));
}

export const ROTULO_TIPO: Record<TipoLinha, string> = { mes: 'Mês inteiro', entrou: 'Entrou', devolvida: 'Devolvida', vendida: 'Vendida' };
