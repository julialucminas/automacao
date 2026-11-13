/*
 * Contratos: um por cliente, com várias máquinas. Os dados ficam na ficha de cada máquina (número, início,
 * vencimento, observação); aqui as máquinas do mesmo cliente com o mesmo número (ou, sem número, o mesmo
 * vencimento) viram um contrato. O valor é o da locação de cada máquina no cliente.
 */
import type { Cliente, Equipamento, Frota, Movimentacao } from '../types';
import { somarDias } from './manutencao';
import { somarMeses } from './movimentacao';

export const DIAS_AVISO = 60;
export type StatusContrato = 'vencido' | 'vencendo' | 'vigente';

export type Contrato = {
  chave: string;
  cliente: Cliente;
  numero: string;
  inicio: string | null;
  vencimento: string;
  obs: string;
  maquinas: Frota[];
  valor: number;
  status: StatusContrato;
  diasParaVencer: number;
  /** máquinas do contrato com vencimentos diferentes (a ficha de alguma ficou desatualizada) */
  datasDiferentes: boolean;
  ultimoReajuste: string | null;
  proximoReajuste: string | null;
  reajusteAtrasado: boolean;
  /** todas as máquinas do contrato marcadas como assinadas */
  assinado: boolean;
  /** só parte das máquinas está marcada */
  assinaturaParcial: boolean;
  assinadoEm: string | null;
  /** arquivo do contrato assinado (o mais recente entre as máquinas) */
  arquivoId: string | null;
};
export type SemContrato = { cliente: Cliente; maquinas: Frota[]; valor: number };

const dias = (de: string, ate: string) => Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000);

export function montarContratos(clientes: Cliente[], fichas: Equipamento[], movs: Movimentacao[], hoje: string) {
  const ficha = new Map(fichas.map((f) => [f.frota, f]));
  // último reajuste aprovado de cada frota
  const reajuste = new Map<string, string>();
  for (const m of movs)
    if (m.tipo === 'reajuste' && m.status === 'aprovada') for (const i of m.dados.itens ?? []) if ((reajuste.get(i.frota) ?? '') < m.dados.data) reajuste.set(i.frota, m.dados.data);

  const contratos: Contrato[] = [];
  const semContrato: SemContrato[] = [];
  const esporadicas: SemContrato[] = [];
  for (const c of clientes) {
    if (!c.ativo || !c.frotas.length) continue;
    const grupos = new Map<string, Frota[]>();
    const sem: Frota[] = [];
    const esp: Frota[] = [];
    for (const f of c.frotas) {
      const fi = ficha.get(f.numero);
      if (fi?.contratoVencimento) {
        const k = fi.contratoNumero?.trim() ? `n:${fi.contratoNumero.trim().toUpperCase()}` : `v:${fi.contratoVencimento}`;
        grupos.set(k, [...(grupos.get(k) ?? []), f]);
      } else if (f.modalidade === 'esporadico') esp.push(f);
      else sem.push(f);
    }
    for (const [k, maquinas] of grupos) {
      const fs = maquinas.map((m) => ficha.get(m.numero)!);
      const vencs = [...new Set(fs.map((x) => x.contratoVencimento!))].sort();
      const vencimento = vencs[0];
      const inicio = fs.map((x) => x.contratoInicio).filter((x): x is string => !!x).sort()[0] ?? null;
      const ultimoReajuste = maquinas.map((m) => reajuste.get(m.numero)).filter((x): x is string => !!x).sort().pop() ?? null;
      // base do reajuste: o início do contrato (ou, sem ele, o início da locação) ou o último reajuste, o que for mais recente
      const inicioLocacao = maquinas.map((m) => m.inicio ?? null).filter((x): x is string => !!x).sort()[0] ?? null;
      const base = [ultimoReajuste, inicio ?? inicioLocacao].filter((x): x is string => !!x).sort().pop() ?? null;
      const proximoReajuste = base ? somarMeses(base, 12) : null;
      const d = dias(hoje, vencimento);
      contratos.push({
        chave: `${c.id}|${k}`,
        cliente: c,
        numero: fs.find((x) => x.contratoNumero)?.contratoNumero ?? '',
        inicio,
        vencimento,
        obs: fs.find((x) => x.contratoObs)?.contratoObs ?? '',
        maquinas,
        valor: maquinas.reduce((s, m) => s + m.valor, 0),
        status: d < 0 ? 'vencido' : d <= DIAS_AVISO ? 'vencendo' : 'vigente',
        diasParaVencer: d,
        datasDiferentes: vencs.length > 1,
        ultimoReajuste,
        proximoReajuste,
        reajusteAtrasado: !!proximoReajuste && proximoReajuste < hoje,
        assinado: fs.every((x) => x.contratoAssinado === 'sim'),
        assinaturaParcial: fs.some((x) => x.contratoAssinado === 'sim') && !fs.every((x) => x.contratoAssinado === 'sim'),
        assinadoEm: fs.map((x) => x.contratoAssinadoEm).filter((x): x is string => !!x).sort().pop() ?? null,
        arquivoId: fs.find((x) => x.contratoArquivo)?.contratoArquivo ?? null,
      });
    }
    if (sem.length) semContrato.push({ cliente: c, maquinas: sem, valor: sem.reduce((s, m) => s + m.valor, 0) });
    if (esp.length) esporadicas.push({ cliente: c, maquinas: esp, valor: esp.reduce((s, m) => s + m.valor, 0) });
  }
  contratos.sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.cliente.nome.localeCompare(b.cliente.nome));
  semContrato.sort((a, b) => b.valor - a.valor);
  return { contratos, semContrato, esporadicas };
}

/** Sugestão de novo vencimento ao renovar: mais 12 meses a partir do vencimento atual (ou de hoje, se já venceu há tempo). */
export const sugestaoRenovacao = (vencimento: string, hoje: string) => somarMeses(vencimento < somarDias(hoje, -90) ? hoje : vencimento, 12);
