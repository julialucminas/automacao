import type { Cliente } from '../types';
import { descreverRegra, paraData, proximasDatas, regraDoCliente } from './calendario';

/*
 * Planilha para o setor de Operações conferir: frotas, clientes e valores.
 * Monta só os dados (testável); quem grava o .xlsx é a função gerarExcelOperacoes.
 */

type Celula = { value: string | number | Date | null; type?: StringConstructor | NumberConstructor | DateConstructor; format?: string; fontWeight?: 'bold'; backgroundColor?: string; color?: string; wrap?: boolean };
type Linha = Celula[];

const MOEDA = '"R$" #,##0.00';
const DATA = 'dd/mm/yyyy';
const CAB = (t: string): Celula => ({ value: t, fontWeight: 'bold', backgroundColor: '#FFC400' });
const txt = (v: string | null | undefined): Celula => ({ value: v ? v : null, type: String });
const num = (v: number): Celula => ({ value: v, type: Number });
const reais = (centavos: number): Celula => ({ value: centavos / 100, type: Number, format: MOEDA });
const data = (iso: string | null): Celula => (iso ? { value: paraData(iso), type: Date, format: DATA } : { value: null });

const comparaNumero = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });

export function pendencias(c: Cliente): string[] {
  const l: string[] = [];
  if (!c.para.length) l.push('sem e-mail');
  if (!c.frotas.length) l.push('sem frota');
  if (!regraDoCliente(c)) l.push('sem data de fatura');
  if (c.frotas.some((f) => !f.valor)) l.push('frota sem valor');
  return l;
}

export function montarPlanilhaOperacoes(todos: Cliente[], hoje: string) {
  const clientes = todos.filter((c) => c.ativo).sort((a, b) => a.nome.localeCompare(b.nome));
  const proxima = (c: Cliente) => {
    const r = regraDoCliente(c);
    return r ? proximasDatas(r, 1, hoje)[0] ?? null : null;
  };

  const contagem = new Map<string, number>();
  for (const c of clientes) for (const f of c.frotas) contagem.set(f.numero, (contagem.get(f.numero) ?? 0) + 1);

  // ---- Frotas ----
  const frotas: Linha[] = [['Frota', 'Cliente', 'Descrição', 'Valor', 'Regra de faturamento', 'Próxima fatura', 'E-mails (Para)', 'Observação'].map(CAB)];
  const linhasFrota = clientes
    .flatMap((c) => c.frotas.map((f) => ({ c, f })))
    .sort((a, b) => comparaNumero(a.f.numero, b.f.numero) || a.c.nome.localeCompare(b.c.nome));
  for (const { c, f } of linhasFrota) {
    const obs = [(contagem.get(f.numero) ?? 0) > 1 ? 'FROTA EM MAIS DE UM CLIENTE' : '', !f.valor ? 'sem valor' : ''].filter(Boolean).join('; ');
    frotas.push([
      /^\d+$/.test(f.numero) ? num(Number(f.numero)) : txt(f.numero),
      txt(c.nome),
      txt(f.descricao),
      f.valor ? reais(f.valor) : txt(null),
      txt(regraDoCliente(c) ? descreverRegra(regraDoCliente(c)) : ''),
      data(proxima(c)),
      txt(c.para.join('; ')),
      obs ? { value: obs, type: String, color: '#9B2318' } : txt(null),
    ]);
  }

  // ---- Clientes ----
  const cli: Linha[] = [
    ['Cliente', 'Qtd. frotas', 'Frotas', 'Valor total', 'Regra de faturamento', 'Próxima fatura', 'E-mails (Para)', 'Cópia (Cc)', 'Pendências', 'Observações'].map(CAB),
  ];
  for (const c of clientes) {
    const total = c.frotas.reduce((s, f) => s + f.valor, 0);
    const pend = pendencias(c);
    cli.push([
      txt(c.nome),
      num(c.frotas.length),
      txt([...c.frotas].sort((a, b) => comparaNumero(a.numero, b.numero)).map((f) => f.numero).join(', ')),
      c.frotas.length ? reais(total) : txt(null),
      txt(regraDoCliente(c) ? descreverRegra(regraDoCliente(c)) : ''),
      data(proxima(c)),
      txt(c.para.join('; ')),
      txt(c.cc.join('; ')),
      pend.length ? { value: pend.join(', '), type: String, color: '#9A3A00' } : txt(null),
      txt(c.observacoes),
    ]);
  }

  // ---- Resumo ----
  const valorTotal = linhasFrota.reduce((s, l) => s + l.f.valor, 0);
  const contar = (p: string) => clientes.filter((c) => pendencias(c).includes(p)).length;
  const [a, m, d] = hoje.split('-');
  const resumo: Linha[] = [
    [{ value: 'Lucminas Empilhadeiras · Frotas, clientes e valores', fontWeight: 'bold' }, txt(null)],
    [txt('Gerado em'), txt(`${d}/${m}/${a}`)],
    [txt(null), txt(null)],
    [CAB('Indicador'), CAB('Quantidade / valor')],
    [txt('Clientes ativos'), num(clientes.length)],
    [txt('Frotas locadas (números diferentes)'), num(contagem.size)],
    [txt('Valor total das frotas'), reais(valorTotal)],
    [txt('Clientes sem e-mail'), num(contar('sem e-mail'))],
    [txt('Clientes sem frota'), num(contar('sem frota'))],
    [txt('Clientes sem data de fatura'), num(contar('sem data de fatura'))],
    [txt('Frotas sem valor'), num(linhasFrota.filter((l) => !l.f.valor).length)],
    [txt('Frotas em mais de um cliente'), num([...contagem.values()].filter((n) => n > 1).length)],
  ];

  return {
    dados: [resumo, frotas, cli],
    sheets: ['Resumo', 'Frotas', 'Clientes'],
    columns: [
      [{ width: 38 }, { width: 22 }],
      [{ width: 8 }, { width: 28 }, { width: 26 }, { width: 14 }, { width: 34 }, { width: 14 }, { width: 50 }, { width: 30 }],
      [{ width: 28 }, { width: 10 }, { width: 22 }, { width: 14 }, { width: 34 }, { width: 14 }, { width: 50 }, { width: 36 }, { width: 34 }, { width: 40 }],
    ],
  };
}

/** Gera e baixa o .xlsx (carrega a biblioteca só quando precisa). */
export async function gerarExcelOperacoes(clientes: Cliente[], hoje: string) {
  const { default: writeXlsxFile } = await import('write-excel-file');
  const p = montarPlanilhaOperacoes(clientes, hoje);
  await writeXlsxFile(p.dados as never, {
    sheets: p.sheets,
    columns: p.columns,
    stickyRowsCount: 1,
    fontFamily: 'Calibri',
    fontSize: 11,
    fileName: `frotas-clientes-valores-${hoje}.xlsx`,
  } as never);
}
