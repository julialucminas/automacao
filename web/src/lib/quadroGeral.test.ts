import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { abrirXlsx } from './xlsxLeve';
import { acharDivergencias, lerDataPlanilha, lerHistoricoAuvo, lerHorimetro, lerQuadroGeral, nomeTecnico } from './quadroGeral';
import type { Cliente } from '../types';

/** Monta um .xlsx mínimo: cada aba é uma lista de linhas; texto vai para sharedStrings. */
async function xlsx(abas: Record<string, (string | number | null)[][]>, colunasExtras = 0) {
  const zip = new JSZip();
  const ss: string[] = [];
  const idx = (t: string) => (ss.includes(t) ? ss.indexOf(t) : ss.push(t) - 1);
  const letra = (i: number) => {
    let s = '';
    for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  };
  const nomes = Object.keys(abas);
  nomes.forEach((nome, n) => {
    const linhas = abas[nome]
      .map((l, r) => {
        const cels = l
          .map((v, c) => (v === null ? '' : typeof v === 'number' ? `<c r="${letra(c)}${r + 1}"><v>${v}</v></c>` : `<c r="${letra(c)}${r + 1}" t="s"><v>${idx(v)}</v></c>`))
          .join('');
        // células vazias depois do fim, como a planilha real (16 mil colunas)
        const extra = Array.from({ length: colunasExtras }, (_, k) => `<c r="${letra(l.length + k + 20)}${r + 1}" s="1"/>`).join('');
        return `<row r="${r + 1}">${cels}${extra}</row>`;
      })
      .join('');
    zip.file(`xl/worksheets/sheet${n + 1}.xml`, `<worksheet><sheetData>${linhas}</sheetData></worksheet>`);
  });
  zip.file(
    'xl/workbook.xml',
    `<workbook><sheets>${nomes.map((x, n) => `<sheet name="${x.replace(/&/g, '&amp;')}" sheetId="${n + 1}" r:id="rId${n + 1}"/>`).join('')}</sheets></workbook>`,
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<Relationships>${nomes.map((_, n) => `<Relationship Id="rId${n + 1}" Target="worksheets/sheet${n + 1}.xml"/>`).join('')}</Relationships>`,
  );
  zip.file('xl/sharedStrings.xml', `<sst>${ss.map((t) => `<si><t>${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`).join('')}</sst>`);
  return zip.generateAsync({ type: 'uint8array' });
}

const cli = (nome: string, frotas: string[], apelidos: string[] = []) =>
  ({
    id: nome,
    nome,
    apelidos,
    cnpj: '',
    para: [],
    cc: [],
    observacoes: '',
    regra: 'dia',
    diaEmissao: null,
    inicioLocacao: null,
    periodoDias: null,
    ativo: true,
    atualizadoEm: '',
    frotas: frotas.map((numero) => ({ numero, valor: 0, descricao: '' })),
  }) as Cliente;

describe('leitor de xlsx', () => {
  it('lê texto, número e ignora as colunas vazias do fim', async () => {
    const p = await abrirXlsx(await xlsx({ 'A & B': [['x', 1, null, 'y'], [], ['z']] }, 50));
    expect(p.abas).toEqual(['A & B']);
    expect(await p.ler('A & B', 5)).toEqual([['x', 1, null, 'y'], [], ['z']]);
  });
});

describe('Quadro Geral Manutenção', () => {
  it('datas, horímetro e nomes de técnico', () => {
    expect(lerDataPlanilha(46274)).toBe('2026-09-09');
    expect(lerDataPlanilha('18/01/2024')).toBe('2024-01-18');
    expect(lerDataPlanilha('Total')).toBeNull();
    expect(lerHorimetro(24.622)).toBe(24622);
    expect(lerHorimetro('24.622')).toBe(24622);
    expect(lerHorimetro(2518)).toBe(2518);
    expect(lerHorimetro(0)).toBeNull();
    expect(['FABRICIO', 'Fabrício', 'EDUARDO D LUCA', 'Eduardo DLuca', 'DUDU', 'JUNIOR MORAIS', 'roberto'].map(nomeTecnico)).toEqual([
      'Fabrício',
      'Fabrício',
      'Eduardo DLuca',
      'Eduardo DLuca',
      'Eduardo DLuca',
      'Júnior Morais',
      'Roberto',
    ]);
  });

  it('histórico do Auvo: valores em centavos, frota do ativo, linha de total fora', () => {
    const h = lerHistoricoAuvo([
      [null, 'Data', 'Cliente', 'Ativo', 'Técnico', 'Ficou pendência?', 'Código da Peça', 'Lista de Peças Utilizadas', 'Quantidade', 'Valor Unitario', 'Valor Total', 'HORIMETRO'],
      [null, '22/01/2024', 'Bold', 'FT 27', 'JUNIOR MORAIS', 'FREIOS COM PROBLEMA', '20W50', 'OLEO DO MOTOR 20W50', '1,0', 28.47, 28.47, 24.622],
      [null, '10/07/2025', 'Capivari', 'FT-40', 'Fabrício', null, '1368860', 'SUPORTE DE ESCOVAS', '2.0', '75,06', 150.12, null],
      [null, '01/02/2024', 'Lucminas', 'PWW6D56', 'Gestor', null, null, 'TROCA DE ÓLEO', 1, 0, 0, null],
      [null, 'Total', null, null, null, null, null, null, null, null, 1234, null],
    ]);
    expect(h.map((x) => [x.data, x.frota, x.tecnico, x.quantidade, x.valorUnitario, x.valorTotal, x.horimetro])).toEqual([
      ['2024-01-22', '27', 'Júnior Morais', 1, 2847, 2847, 24622],
      ['2025-07-10', '40', 'Fabrício', 2, 7506, 15012, null],
      ['2024-02-01', null, 'Gestor', 1, 0, 0, null],
    ]);
  });

  it('junta as abas numa ficha por frota e aponta divergências com o cadastro', async () => {
    const arq = await xlsx({
      'RELAÇÃO DE FROTA': [
        ['RELAÇÃO FROTA'],
        ['FROTA', 'Cliente / Localização', 'FROTA', 'Descrição', 'Marca', 'Modelo', 'Ano \nFabricação', 'Capacidade', 'Torre', 'Série'],
        [null, 'CAPIVARI', 40, 'HYSTER H50FT', 'HYSTER', '50 FT', 2012, 2500, 4118, 'A977Y15142K'],
        [null, 'OFICINA', 2, 'BURRINHA', 'PALETRAMS', null, null, 1500, 'NÃO APLICA', null],
        [null, 'MÉDIA', 'MÉDIA', null, null, null, null, null, null, null],
      ],
      'VALOR FROTA': [
        ['FROTA', 'Cliente / Localização', 'Nº', 'FROTA', 'Marca', 'Modelo', 'Série', 'Ano \nFabricação', 'Capacidade', 'NF', 'Ano \nAquisição.', 'VALOR', 'FORNECEDOR'],
        [40, '#N/A', 1, 40, 'HYSTER', '50 FT', 'X', 2012, 2500, 30901, 42545, 37000, 'BRASIF RENTAL'],
      ],
      PROGRAMAÇÃO: [
        [null, 'PROGRAMAÇÃO DE PREVENTIVA'],
        [null, 'CLIENTE', 'FROTA', 'ST', 'DATA', 'HORÍMETRO', 'PROXIMA \nPREV. B', 'HORAS\nFALTANTES', 'MANUTENTOR', 'MÉDIA \nDIA', 'DIAS', 'PROX.\n DATA', 'Coluna1', 'REGIÃO'],
        [null, 'CAPIVARI', 40, 'CF', 46316, 25786, 25961, 175, 'EDUARDO', 2, null, null, null, 1],
      ],
      'QUADRO PREVENTIVA (ELETRICA)': [
        ['PROGRAMAÇÃO'],
        ['FT', 'CLIENTE', 'RG', 'TIPO', 'DATA', 'STATUS', 'TEMPO\nVISITA', 'HOR.', 'Coluna1'],
        [95, 'PANEX', 0, 'CF', 46296, 'EM DIA', 3, 5044, 30],
      ],
      'CONTRATOS CONF. 30.10': [
        [null, 'CHECK LIST CONTRATOS'],
        [null, 'FT', 'CLIENTE', 'MARCA\nMODELO', 'VALOR\n CONTRATO', 'Nº \nCONTRATO', 'SOLICITAÇÃO REAJUSTE.', 'DELTA', '%', 'VENCIMENTO \nCONTRATO', 'STATUS', 'OBSERVAÇÕES'],
        [null, 40, 'CAPIVARI', 'HYSTER', 3750, '040.02.2025C', 0, 0, 0, 46054, 'VENCIDO', 'IGMP - NEGATIVO'],
        [null, 2, 'ATUAL VIDROS', null, 900, 'FAZER CONTRATO', null, 0, 0, 46388, 'OK', null],
      ],
      'HISTORICO auvo': [
        [
          null,
          'Data',
          'Cliente',
          'Ativo',
          'Técnico',
          'Ficou pendência?',
          'Código da Peça',
          'Lista de Peças Utilizadas',
          'Quantidade',
          'Valor Unitario',
          'Valor Total',
          'HORIMETRO',
        ],
        [null, '28/11/2025', 'Capivari', 'FT 40', 'Eduardo DLuca', null, '13514', 'REVISÃO MOTOR DE PARTIDA', 1, 120, 120, null],
      ],
    });
    const r = await lerQuadroGeral(arq, [cli('CAPIVARI LTDA', ['40']), cli('ATUAL VIDROS', ['2']), cli('PANEX', ['95'])], []);
    expect(r.avisos).toEqual(['Não achei a aba "Quadro preventiva".', 'Não achei a aba "Periféricos".', 'Não achei a aba "Pendência".']);
    expect(r.fichas.map((f) => f.frota)).toEqual(['2', '40', '95']);
    expect(r.fichas[1].dados).toEqual({
      descricao: 'HYSTER H50FT',
      marca: 'HYSTER',
      modelo: '50 FT',
      ano: 2012,
      capacidade: 2500,
      torre: '4118',
      serie: 'A977Y15142K',
      compraValor: 3700000,
      compraNf: '30901',
      compraData: '2016-06-24',
      fornecedor: 'BRASIF RENTAL',
      tipoVisita: 'CF',
      ultimaVisita: '2026-10-21',
      horimetro: 25786,
      horimetroEm: '2026-10-21',
      proximaPreventiva: 25961,
      tecnico: 'Eduardo Silva',
      mediaDia: 2,
      regiao: '1',
      contratoNumero: '040.02.2025C',
      contratoValor: 375000,
      contratoVencimento: '2026-02-01',
      contratoObs: 'IGMP - NEGATIVO',
    });
    expect(r.fichas[0].dados.torre).toBeUndefined();
    expect(r.fichas[0].dados).toMatchObject({ contratoObs: 'Contrato a fazer', contratoValor: 90000 });
    expect(r.fichas[2].dados).toMatchObject({ combustivel: 'eletrica', intervaloVisitaDias: 30 });
    expect(r.historico).toHaveLength(1);
    // a FT2 está na oficina pela planilha, mas com a ATUAL VIDROS no sistema
    expect(r.divergencias).toEqual([{ frota: '2', naPlanilha: 'OFICINA', noSistema: 'ATUAL VIDROS' }]);
  });

  it('divergências: cliente diferente, frota sem cliente no sistema', () => {
    const fichas = [
      { frota: '1', dados: {}, clientePlanilha: 'FORMARE' },
      { frota: '2', dados: {}, clientePlanilha: 'HIGRA' },
      { frota: '3', dados: {}, clientePlanilha: 'MADEREIRA NOVA LIMA' },
    ];
    expect(acharDivergencias(fichas, [cli('FORMARE INDUSTRIA', ['1']), cli('TELHADO', ['3'], ['MADEREIRA NOVA LIMA'])], [])).toEqual([
      { frota: '2', naPlanilha: 'HIGRA', noSistema: 'sem cliente' },
    ]);
  });
});
