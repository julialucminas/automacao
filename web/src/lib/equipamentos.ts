import type { Cliente, Equipamento, Frota, FrotaOficina } from '../types';
import { hojeIso } from './calendario';

export type Situacao = 'locada' | 'oficina' | 'disponivel' | 'reservada' | 'baixada';

export const SITUACOES: Record<Situacao, { rotulo: string; tom: 'ok' | 'warn' | 'info' | 'neutro' | 'bad' }> = {
  locada: { rotulo: 'Locada', tom: 'ok' },
  oficina: { rotulo: 'Na oficina', tom: 'warn' },
  disponivel: { rotulo: 'Disponível', tom: 'info' },
  reservada: { rotulo: 'Reservada', tom: 'neutro' },
  baixada: { rotulo: 'Vendida / baixada', tom: 'neutro' },
};

export const COMBUSTIVEIS: Record<string, string> = { eletrica: 'Elétrica', glp: 'GLP (gás)', diesel: 'Diesel', gasolina: 'Gasolina' };
export const TIPOS_VISITA: Record<string, string> = { CF: 'Conferência', CR: 'Corretiva', B: 'Preventiva B', C: 'Preventiva C', D: 'Preventiva D', 'PREV. C': 'Preventiva C' };

export type LinhaEquipamento = {
  frota: string;
  ficha: Equipamento | null;
  cliente: Cliente | null;
  locacao: Frota | null;
  oficina: FrotaOficina | null;
  situacao: Situacao;
  /** contrato com vencimento já passado */
  contratoVencido: boolean;
};

const comparaFrota = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });

/**
 * Junta tudo o que o sistema sabe de cada frota: a ficha, o cliente com quem está (cadastro) e a oficina.
 * Situação: baixada > oficina > locada > reservada > disponível.
 */
export function montarEquipamentos(fichas: Equipamento[], clientes: Cliente[], oficina: FrotaOficina[], hoje = hojeIso()): LinhaEquipamento[] {
  const numeros = new Set<string>();
  const porFicha = new Map(fichas.map((f) => [f.frota, f]));
  const locacao = new Map<string, { c: Cliente; f: Frota }>();
  for (const c of clientes)
    if (c.ativo)
      for (const f of c.frotas) {
        numeros.add(f.numero);
        if (!locacao.has(f.numero)) locacao.set(f.numero, { c, f });
      }
  const naOficina = new Map(oficina.map((o) => [o.frota, o]));
  for (const f of fichas) numeros.add(f.frota);
  for (const o of oficina) numeros.add(o.frota);

  return [...numeros].sort(comparaFrota).map((frota) => {
    const ficha = porFicha.get(frota) ?? null;
    const l = locacao.get(frota);
    const o = naOficina.get(frota) ?? null;
    const guardada = ficha?.situacao;
    const situacao: Situacao = guardada === 'baixada' ? 'baixada' : o ? 'oficina' : l ? 'locada' : guardada === 'reservada' ? 'reservada' : 'disponivel';
    return {
      frota,
      ficha,
      cliente: l?.c ?? null,
      locacao: l?.f ?? null,
      oficina: o,
      situacao,
      contratoVencido: !!(l && ficha?.contratoVencimento && ficha.contratoVencimento < hoje),
    };
  });
}

/** "HYSTER 50 FT" ou a descrição da planilha */
export const nomeEquipamento = (l: Pick<LinhaEquipamento, 'ficha' | 'locacao'>) => {
  const f = l.ficha;
  const mm = [f?.marca, f?.modelo].filter(Boolean).join(' ');
  return mm || f?.descricao || l.locacao?.descricao || '';
};

/** Horas que faltam para a próxima preventiva (negativo = passou). */
export const horasParaPreventiva = (f: Equipamento | null) => (f?.proximaPreventiva != null && f.horimetro != null ? Math.round(f.proximaPreventiva - f.horimetro) : null);
