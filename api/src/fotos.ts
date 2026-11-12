import type { Banco } from './db.js';

/*
 * Foto mensal do negócio: receita de locação, máquinas locadas, frota e clientes.
 * O sistema só guarda o "agora" (as frotas de cada cliente); para o dono ver a evolução,
 * a linha do mês corrente é regravada a cada poucas horas e, quando o mês vira, a do mês
 * anterior fica congelada com o último valor.
 */
export type FotoMensal = { mes: string; receita: number; receitaContrato: number; locadas: number; frota: number; clientes: number; atualizadaEm: string };

export function fotos(db: Banco) {
  const calcular = () => {
    const clientes = db.prepare('SELECT frotas FROM clientes WHERE ativo = 1').all() as { frotas: string }[];
    const locadas = new Map<string, { valor: number; modalidade?: string }>();
    let comFrota = 0;
    for (const c of clientes) {
      const lista = JSON.parse(c.frotas || '[]') as { numero: string; valor: number; modalidade?: string }[];
      if (lista.length) comFrota++;
      for (const f of lista) if (!locadas.has(f.numero)) locadas.set(f.numero, { valor: f.valor || 0, modalidade: f.modalidade });
    }
    const numeros = new Set(locadas.keys());
    for (const r of db.prepare('SELECT frota, dados FROM equipamentos').all() as { frota: string; dados: string }[]) {
      let situacao = '';
      try {
        situacao = (JSON.parse(r.dados || '{}') as { situacao?: string }).situacao ?? '';
      } catch {
        /* ficha sem dados */
      }
      if (situacao !== 'baixada') numeros.add(r.frota);
      else numeros.delete(r.frota);
    }
    for (const r of db.prepare('SELECT frota FROM oficina').all() as { frota: string }[]) numeros.add(r.frota);
    let receita = 0;
    let receitaContrato = 0;
    for (const f of locadas.values()) {
      receita += f.valor;
      if (f.modalidade === 'contrato') receitaContrato += f.valor;
    }
    return { receita, receitaContrato, locadas: locadas.size, frota: numeros.size, clientes: comFrota };
  };

  return {
    /** Regrava a linha do mês (padrão: o mês de hoje). */
    gravar(hoje = new Date()) {
      const mes = new Date(hoje.getTime() - 3 * 3_600_000).toISOString().slice(0, 7); // horário de Brasília
      const v = calcular();
      db.prepare(
        `INSERT INTO fotos_mensais (mes, receita, receita_contrato, locadas, frota, clientes, atualizada_em) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(mes) DO UPDATE SET receita = excluded.receita, receita_contrato = excluded.receita_contrato, locadas = excluded.locadas,
           frota = excluded.frota, clientes = excluded.clientes, atualizada_em = excluded.atualizada_em`,
      ).run(mes, v.receita, v.receitaContrato, v.locadas, v.frota, v.clientes, hoje.toISOString());
      return mes;
    },
    listar(): FotoMensal[] {
      return (db.prepare('SELECT * FROM fotos_mensais ORDER BY mes').all() as Record<string, unknown>[]).map((r) => ({
        mes: r.mes as string,
        receita: r.receita as number,
        receitaContrato: r.receita_contrato as number,
        locadas: r.locadas as number,
        frota: r.frota as number,
        clientes: r.clientes as number,
        atualizadaEm: r.atualizada_em as string,
      }));
    },
  };
}
