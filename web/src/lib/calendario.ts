/*
 * Datas de faturamento. Datas são texto "AAAA-MM-DD" e as contas são feitas em UTC,
 * para não ter erro de fuso horário/horário de verão.
 *
 * Regras:
 *  - dia fixo: todo mês no dia D (se o mês não tem o dia, usa o último dia: dia 31 em fevereiro → 28/29)
 *  - período: a partir do início da locação, a cada N dias (a 1ª fatura é no início + N dias)
 */

export type RegraFaturamento =
  | { tipo: 'dia'; dia: number }
  | { tipo: 'periodo'; inicio: string; dias: number };

const DIA_MS = 86_400_000;

export const paraData = (iso: string) => new Date(iso + 'T00:00:00Z');
export const paraIso = (d: Date) => d.toISOString().slice(0, 10);

export function hojeIso(agora = new Date()): string {
  // data local (Brasil), não UTC
  const p = (n: number) => String(n).padStart(2, '0');
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
}

export const diasNoMes = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate(); // mes 1-12

export function dataValida(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = paraData(iso);
  return !isNaN(d.getTime()) && paraIso(d) === iso;
}

/** Datas de faturamento entre "de" e "ate" (inclusive). */
export function datasNoIntervalo(regra: RegraFaturamento, de: string, ate: string): string[] {
  const out: string[] = [];
  if (regra.tipo === 'dia') {
    if (!(regra.dia >= 1 && regra.dia <= 31)) return out;
    let a = Number(de.slice(0, 4));
    let m = Number(de.slice(5, 7));
    for (let guard = 0; guard < 400; guard++) {
      const d = Math.min(regra.dia, diasNoMes(a, m));
      const iso = `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (iso > ate) break;
      if (iso >= de) out.push(iso);
      m++;
      if (m > 12) {
        m = 1;
        a++;
      }
    }
    return out;
  }
  if (!(regra.dias >= 1) || !dataValida(regra.inicio)) return out;
  const inicio = paraData(regra.inicio).getTime();
  const passo = regra.dias * DIA_MS;
  // primeira ocorrência >= de (k >= 1)
  const desde = paraData(de).getTime();
  let k = Math.max(1, Math.ceil((desde - inicio) / passo));
  for (let guard = 0; guard < 2000; guard++, k++) {
    const iso = paraIso(new Date(inicio + k * passo));
    if (iso > ate) break;
    if (iso >= de) out.push(iso);
  }
  return out;
}

/** Próximas N datas a partir de hoje (para mostrar no cadastro). */
export function proximasDatas(regra: RegraFaturamento, n: number, desde = hojeIso()): string[] {
  const ate = paraIso(new Date(paraData(desde).getTime() + 800 * DIA_MS));
  return datasNoIntervalo(regra, desde, ate).slice(0, n);
}

export function intervaloDoMes(ano: number, mes: number): { de: string; ate: string } {
  const p = (n: number) => String(n).padStart(2, '0');
  return { de: `${ano}-${p(mes)}-01`, ate: `${ano}-${p(mes)}-${p(diasNoMes(ano, mes))}` };
}

/** Semanas do mês para a grade (domingo a sábado). Dias de fora do mês vêm como null. */
export function gradeDoMes(ano: number, mes: number): (string | null)[][] {
  const primeiro = new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay(); // 0 = domingo
  const total = diasNoMes(ano, mes);
  const celulas: (string | null)[] = Array(primeiro).fill(null);
  for (let d = 1; d <= total; d++) celulas.push(`${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  while (celulas.length % 7) celulas.push(null);
  const semanas: (string | null)[][] = [];
  for (let i = 0; i < celulas.length; i += 7) semanas.push(celulas.slice(i, i + 7));
  return semanas;
}

export const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** "10/10/2026", "2026-10-10", data do Excel → "2026-10-10" (ou null). */
export function lerData(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return paraIso(new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate())));
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return dataValida(s) ? s : null;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const iso = `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return dataValida(iso) ? iso : null;
  }
  return null;
}

/** Regra de faturamento de um cliente, ou null se ainda não foi preenchida. */
export function regraDoCliente(c: { regra: 'dia' | 'periodo'; diaEmissao: number | null; inicioLocacao: string | null; periodoDias: number | null }): RegraFaturamento | null {
  if (c.regra === 'periodo') return c.inicioLocacao && c.periodoDias ? { tipo: 'periodo', inicio: c.inicioLocacao, dias: c.periodoDias } : null;
  return c.diaEmissao ? { tipo: 'dia', dia: c.diaEmissao } : null;
}

export function descreverRegra(r: RegraFaturamento | null): string {
  if (!r) return 'Sem data de faturamento';
  if (r.tipo === 'dia') return `Todo dia ${r.dia} do mês`;
  return `A cada ${r.dias} dias desde ${dataBr(r.inicio)}`;
}
