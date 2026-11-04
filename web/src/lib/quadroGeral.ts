/*
 * Importação da planilha "Quadro Geral Manutenção" (controle do Júnior):
 * fichas dos equipamentos (Relação de frota, Valor frota, Programação, Contratos, Preventiva elétrica)
 * e o histórico de peças e serviços do Auvo.
 * Cada aba é procurada pelo cabeçalho, então colunas a mais ou a menos não quebram a leitura.
 */
import type { Cliente, DadosEquipamento, FrotaOficina, NovaPeca, NovaPendencia, PerifericoId } from '../types';
import { abrirXlsx, serialParaIso, type Valor } from './xlsxLeve';
import { chaveEmpresa, semAcento } from './normalizar';

export const normalizarFrota = (v: Valor | undefined) =>
  String(v ?? '')
    .trim()
    .toUpperCase()
    .replace(/^(FROTA|FT)[\s-]*/, '')
    .replace(/\.0+$/, '');

const cab = (v: Valor | undefined) =>
  semAcento(String(v ?? ''))
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Acha a linha de cabeçalho (a primeira que tem todos os nomes pedidos) e devolve a posição de cada coluna. */
export function acharCabecalho(linhas: Valor[][], obrigatorios: string[]): { linha: number; col: (nome: string, n?: number) => number } | null {
  for (let i = 0; i < Math.min(linhas.length, 15); i++) {
    const nomes = (linhas[i] ?? []).map(cab);
    if (obrigatorios.every((o) => nomes.includes(o))) {
      return {
        linha: i,
        // n = qual ocorrência (a "Relação de frota" tem duas colunas FROTA)
        col: (nome, n = 0) => {
          let vistos = 0;
          for (let j = 0; j < nomes.length; j++) if (nomes[j] === nome && vistos++ === n) return j;
          return -1;
        },
      };
    }
  }
  return null;
}

const texto = (v: Valor | undefined): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || /^(#N\/A|#REF!|S\/REGISTRO|N[ÃA]O APLICA|Ñ APLICA|-)$/i.test(s)) return null;
  return s;
};
const numero = (v: Valor | undefined): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = texto(v);
  if (!s) return null;
  const n = Number(
    s
      .replace(/\s/g, '')
      .replace(/\.(?=\d{3}(\D|$))/g, '')
      .replace(',', '.'),
  );
  return Number.isFinite(n) ? n : null;
};
const inteiro = (v: Valor | undefined) => {
  const n = numero(v);
  return n === null ? null : Math.round(n);
};
const reaisParaCentavos = (v: Valor | undefined) => {
  const n = numero(v);
  return n === null || n <= 0 ? null : Math.round(n * 100);
};
/** Data em número de série do Excel ou dd/mm/aaaa → AAAA-MM-DD */
export const lerDataPlanilha = (v: Valor | undefined): string | null => {
  if (typeof v === 'number' && v > 20000 && v < 80000) return serialParaIso(v);
  const s = texto(v);
  const m = s && /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (s && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
};
/** No Auvo o horímetro às vezes vem "24.622" querendo dizer 24622 horas. */
export const lerHorimetro = (v: Valor | undefined): number | null => {
  const s = typeof v === 'string' ? v.trim() : v;
  if (typeof s === 'string' && /^\d{1,3}\.\d{3}$/.test(s)) return Number(s.replace('.', ''));
  const n = numero(s);
  if (n === null || n <= 0) return null;
  if (!Number.isInteger(n) && Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6 && n < 1000) return Math.round(n * 1000);
  return n;
};

const TECNICOS: [RegExp, string][] = [
  [/^EDUARDO\s*D\.?\s*LUCA$|^DUDU$/, 'Eduardo DLuca'],
  [/^EDUARDO SILVA$/, 'Eduardo Silva'],
  [/^FABRICIO$/, 'Fabrício'],
  [/^ENEITON$/, 'Eneiton'],
  [/^JUNIOR( MORAIS)?$/, 'Júnior Morais'],
  [/^EDUARDO$/, 'Eduardo'],
];
/** Junta os jeitos diferentes de escrever o nome do mesmo técnico ("FABRICIO" e "Fabrício"). */
export function nomeTecnico(v: Valor | undefined): string {
  const s = texto(v);
  if (!s) return '';
  const k = semAcento(s).toUpperCase().replace(/\s+/g, ' ').trim();
  for (const [re, nome] of TECNICOS) if (re.test(k)) return nome;
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((p) => (p.length > 2 ? p[0].toUpperCase() + p.slice(1) : p))
    .join(' ');
}

export type FichaImportada = { frota: string; dados: DadosEquipamento; clientePlanilha: string | null };
export type Divergencia = { frota: string; naPlanilha: string; noSistema: string };
export type LeituraQuadro = {
  fichas: FichaImportada[];
  historico: NovaPeca[];
  pendencias: NovaPendencia[];
  abasLidas: string[];
  avisos: string[];
  divergencias: Divergencia[];
};

const juntar = (m: Map<string, FichaImportada>, frota: string, dados: DadosEquipamento, cliente?: string | null) => {
  // linhas de total ("MÉDIA", "TOTAL") não são frotas
  if (!frota || frota.length > 20 || !/\d/.test(frota)) return;
  const atual = m.get(frota) ?? { frota, dados: {}, clientePlanilha: null };
  for (const [k, v] of Object.entries(dados)) if (v !== null && v !== undefined) (atual.dados as Record<string, unknown>)[k] = v;
  if (cliente && !atual.clientePlanilha) atual.clientePlanilha = cliente;
  m.set(frota, atual);
};

export function lerRelacaoFrota(linhas: Valor[][], m: Map<string, FichaImportada>) {
  const h = acharCabecalho(linhas, ['FROTA', 'DESCRICAO', 'MARCA', 'MODELO']);
  if (!h) return 0;
  const cFrota = h.col('FROTA', 1) >= 0 ? h.col('FROTA', 1) : h.col('FROTA');
  let n = 0;
  for (const l of linhas.slice(h.linha + 1)) {
    const frota = normalizarFrota(l[cFrota]);
    if (!frota || frota === 'FROTA') continue;
    const ano = inteiro(l[h.col('ANO FABRICACAO')]);
    juntar(
      m,
      frota,
      {
        descricao: texto(l[h.col('DESCRICAO')]),
        marca: texto(l[h.col('MARCA')]),
        modelo: texto(l[h.col('MODELO')]),
        ano: ano && ano > 1950 && ano < 2100 ? ano : null,
        capacidade: inteiro(l[h.col('CAPACIDADE')]),
        torre: texto(l[h.col('TORRE')]),
        serie: texto(l[h.col('SERIE')]),
      },
      texto(l[h.col('CLIENTE / LOCALIZACAO')]),
    );
    n++;
  }
  return n;
}

export function lerValorFrota(linhas: Valor[][], m: Map<string, FichaImportada>) {
  const h = acharCabecalho(linhas, ['FROTA', 'VALOR', 'FORNECEDOR']);
  if (!h) return 0;
  const cFrota = h.col('FROTA', 1) >= 0 ? h.col('FROTA', 1) : h.col('FROTA');
  let n = 0;
  for (const l of linhas.slice(h.linha + 1)) {
    const frota = normalizarFrota(l[cFrota]);
    if (!frota) continue;
    const nf = texto(l[h.col('NF')]);
    juntar(m, frota, {
      compraValor: reaisParaCentavos(l[h.col('VALOR')]),
      compraNf: nf && !/^S\/?NF$/i.test(nf) ? nf : null,
      compraData: lerDataPlanilha(l[h.col('ANO AQUISICAO.')] ?? l[h.col('ANO AQUISICAO')]),
      fornecedor: texto(l[h.col('FORNECEDOR')]),
      serie: m.get(frota)?.dados.serie ? null : texto(l[h.col('SERIE')]) === '0' ? null : texto(l[h.col('SERIE')]),
    });
    n++;
  }
  return n;
}

export function lerProgramacao(linhas: Valor[][], m: Map<string, FichaImportada>) {
  const h = acharCabecalho(linhas, ['CLIENTE', 'FROTA', 'HORIMETRO']);
  if (!h) return 0;
  let n = 0;
  for (const l of linhas.slice(h.linha + 1)) {
    const frota = normalizarFrota(l[h.col('FROTA')]);
    if (!frota) continue;
    const data = lerDataPlanilha(l[h.col('DATA')]);
    const horas = lerHorimetro(l[h.col('HORIMETRO')]);
    const regiao = texto(l[h.col('REGIAO')]);
    // na Programação, "DUDU" é o Eduardo DLuca, então "EDUARDO" é o Eduardo Silva
    const t = nomeTecnico(l[h.col('MANUTENTOR')]);
    const tecnico = t === 'Eduardo' ? 'Eduardo Silva' : t;
    juntar(
      m,
      frota,
      {
        tipoVisita: texto(l[h.col('ST')]),
        ultimaVisita: data,
        horimetro: horas,
        horimetroEm: horas ? data : null,
        proximaPreventiva: numero(l[h.col('PROXIMA PREV. B')]),
        tecnico: tecnico && tecnico !== 'Oficina' ? tecnico : null,
        mediaDia: numero(l[h.col('MEDIA DIA')]),
        regiao: regiao && regiao !== '0' ? regiao : null,
        serie: m.get(frota)?.dados.serie ? null : texto(l[h.col('SERIE')]) === '0' ? null : texto(l[h.col('SERIE')]),
        descricao: m.get(frota)?.dados.descricao ? null : texto(l[h.col('DESCRICAO')]),
      },
      texto(l[h.col('CLIENTE')]),
    );
    n++;
  }
  return n;
}

/** Quadro preventiva (combustão ou elétrica): intervalo de visita (15 ou 30 dias) e, na elétrica, o tipo. */
export function lerQuadroPreventiva(linhas: Valor[][], m: Map<string, FichaImportada>, eletrica: boolean) {
  const h = acharCabecalho(linhas, ['FT', 'CLIENTE', 'TIPO']);
  if (!h) return 0;
  let n = 0;
  for (const l of linhas.slice(h.linha + 1)) {
    const frota = normalizarFrota(l[h.col('FT')]);
    if (!frota) continue;
    const dias = inteiro(l[h.col('COLUNA1')]);
    juntar(m, frota, { intervaloVisitaDias: dias && dias > 0 && dias <= 365 ? dias : null, combustivel: eletrica ? 'eletrica' : null });
    n++;
  }
  return n;
}

export function lerContratos(linhas: Valor[][], m: Map<string, FichaImportada>) {
  const h = acharCabecalho(linhas, ['FT', 'CLIENTE', 'VENCIMENTO CONTRATO']);
  if (!h) return 0;
  let n = 0;
  for (const l of linhas.slice(h.linha + 1)) {
    const frota = normalizarFrota(l[h.col('FT')]);
    if (!frota) continue;
    const numeroContrato = texto(l[h.col('N° CONTRATO')] ?? l[h.col('Nº CONTRATO')]) ?? texto(l[h.col('NO CONTRATO')]);
    const semContrato = numeroContrato && /FAZER/i.test(numeroContrato);
    const obs = [semContrato ? 'Contrato a fazer' : null, texto(l[h.col('OBSERVACOES')]), texto(l[h.col('ADITIVO')]) && `Aditivo: ${texto(l[h.col('ADITIVO')])}`]
      .filter(Boolean)
      .join(' · ');
    juntar(m, frota, {
      contratoNumero: semContrato ? null : numeroContrato,
      contratoValor: reaisParaCentavos(l[h.col('VALOR CONTRATO')]),
      contratoReajuste: reaisParaCentavos(l[h.col('SOLICITACAO REAJUSTE.')]),
      contratoVencimento: lerDataPlanilha(l[h.col('VENCIMENTO CONTRATO')]),
      contratoObs: obs || null,
    });
    n++;
  }
  return n;
}

/** Ordem dos blocos na aba Periféricos. Motor de partida e filtro de ar vencem por data; os outros por horímetro. */
const BLOCOS_PERIFERICOS: { id: PerifericoId; porData: boolean }[] = [
  { id: 'motorPartida', porData: true },
  { id: 'filtroAr', porData: true },
  { id: 'correia', porData: false },
  { id: 'oleoTransmissao', porData: false },
  { id: 'oleoHidraulico', porData: false },
];

/** Periféricos: última troca (data e horímetro) e a próxima, por frota. "Ñ APLICA" vira "não se aplica". */
export function lerPerifericos(linhas: Valor[][], m: Map<string, FichaImportada>) {
  const h = acharCabecalho(linhas, ['FROTA', 'CLIENTE', 'HORIMETRO', 'TIPO', 'DATA', 'PROXIMA TROCA']);
  if (!h) return 0;
  const cFrota = h.col('FROTA', 1) >= 0 ? h.col('FROTA', 1) : h.col('FROTA');
  // DATA nº 0 é a última visita; os periféricos começam no DATA nº 1, em blocos de 4 (data, horímetro, rodado, próxima)
  const inicio = BLOCOS_PERIFERICOS.map((_, i) => h.col('DATA', i + 1));
  let n = 0;
  for (const l of linhas.slice(h.linha + 1)) {
    const frota = normalizarFrota(l[cFrota]);
    if (!frota) continue;
    const d: Record<string, string | number | null> = {};
    const naoAplica: string[] = [];
    BLOCOS_PERIFERICOS.forEach((b, i) => {
      const c = inicio[i];
      if (c < 0) return;
      if (/^(Ñ|N[ÃA]O) APLICA$/i.test(String(l[c] ?? '').trim())) return naoAplica.push(b.id);
      const data = lerDataPlanilha(l[c]);
      if (!data) return;
      d[`${b.id}Data`] = data;
      d[`${b.id}Horimetro`] = lerHorimetro(l[c + 1]);
      if (b.porData) d[`${b.id}ProximaData`] = lerDataPlanilha(l[c + 3]);
      else {
        const prox = numero(l[c + 3]);
        d[`${b.id}ProximaHoras`] = prox && prox > 0 ? prox : null;
      }
    });
    if (naoAplica.length) d.perifericosNaoAplica = naoAplica.join(',');
    juntar(m, frota, d as DadosEquipamento);
    n++;
  }
  return n;
}

/** Pendências abertas (só as linhas com descrição). */
export function lerPendencias(linhas: Valor[][]): NovaPendencia[] {
  const h = acharCabecalho(linhas, ['CLIENTE', 'FROTA', 'TECNICO', 'DESCRICAO']);
  if (!h) return [];
  const r: NovaPendencia[] = [];
  for (const l of linhas.slice(h.linha + 1)) {
    const frota = normalizarFrota(l[h.col('FROTA')]);
    const descricao = texto(l[h.col('DESCRICAO')]);
    if (!frota || !/\d/.test(frota) || !descricao) continue;
    r.push({
      frota,
      cliente: texto(l[h.col('CLIENTE')]) ?? '',
      abertaEm: lerDataPlanilha(l[h.col('DATA ABERTURA')]) ?? new Date().toISOString().slice(0, 10),
      tecnico: nomeTecnico(l[h.col('TECNICO')]),
      descricao,
    });
  }
  return r;
}

export function lerHistoricoAuvo(linhas: Valor[][]): NovaPeca[] {
  const h = acharCabecalho(linhas, ['DATA', 'CLIENTE', 'ATIVO', 'TECNICO']);
  if (!h) return [];
  const r: NovaPeca[] = [];
  for (const l of linhas.slice(h.linha + 1)) {
    const data = lerDataPlanilha(l[h.col('DATA')]);
    if (!data) continue; // linha de total ou vazia
    const ativo = texto(l[h.col('ATIVO')]) ?? '';
    const ft = /^\s*FT\s*-?\s*([A-Z0-9]+)\s*$/i.exec(ativo);
    const vu = numero(l[h.col('VALOR UNITARIO')]);
    const vt = numero(l[h.col('VALOR TOTAL')]);
    r.push({
      data,
      frota: ft ? ft[1].toUpperCase() : null,
      ativo: ativo.trim(),
      cliente: texto(l[h.col('CLIENTE')]) ?? '',
      tecnico: nomeTecnico(l[h.col('TECNICO')]),
      pendencia: texto(l[h.col('FICOU PENDENCIA?')]) ?? '',
      codigo: texto(l[h.col('CODIGO DA PECA')]) ?? '',
      descricao: texto(l[h.col('LISTA DE PECAS UTILIZADAS')]) ?? '',
      quantidade: numero(l[h.col('QUANTIDADE')]) ?? 1,
      valorUnitario: vu === null ? 0 : Math.round(vu * 100),
      valorTotal: vt === null ? 0 : Math.round(vt * 100),
      horimetro: lerHorimetro(l[h.col('HORIMETRO')]),
      origem: 'auvo',
    });
  }
  return r;
}

/** Frota que a planilha põe num cliente e o sistema em outro (só para o Júnior conferir). */
export function acharDivergencias(fichas: FichaImportada[], clientes: Cliente[], oficina: FrotaOficina[]): Divergencia[] {
  const donos = new Map<string, Cliente>();
  for (const c of clientes) if (c.ativo) for (const f of c.frotas) donos.set(f.numero, c);
  const naOficina = new Set(oficina.map((o) => o.frota));
  const r: Divergencia[] = [];
  for (const f of fichas) {
    const p = f.clientePlanilha;
    if (!p) continue;
    const dono = donos.get(f.frota);
    const kp = chaveEmpresa(p);
    if (/^OFICINA|^LUCMINAS|^ESTOQUE|^DISPONIVEL/.test(kp)) {
      if (dono) r.push({ frota: f.frota, naPlanilha: p, noSistema: dono.nome });
      continue;
    }
    if (!dono) {
      r.push({ frota: f.frota, naPlanilha: p, noSistema: naOficina.has(f.frota) ? 'na oficina, sem cliente' : 'sem cliente' });
      continue;
    }
    const nomes = [dono.nome, ...dono.apelidos].map(chaveEmpresa);
    if (!nomes.some((k) => k && (k.includes(kp) || kp.includes(k)))) r.push({ frota: f.frota, naPlanilha: p, noSistema: dono.nome });
  }
  return r.sort((a, b) => a.frota.localeCompare(b.frota, 'pt-BR', { numeric: true }));
}

/** Lê a planilha inteira. Abas que não existirem são só avisadas. */
export async function lerQuadroGeral(arquivo: Blob | ArrayBuffer | Uint8Array, clientes: Cliente[], oficina: FrotaOficina[]): Promise<LeituraQuadro> {
  const pasta = await abrirXlsx(arquivo);
  const achar = (re: RegExp) => pasta.abas.find((a) => re.test(semAcento(a).toUpperCase().trim()));
  const m = new Map<string, FichaImportada>();
  const abasLidas: string[] = [];
  const avisos: string[] = [];
  const passo = async (re: RegExp, rotulo: string, f: (l: Valor[][]) => number, colunas = 40) => {
    const nome = achar(re);
    if (!nome) return avisos.push(`Não achei a aba "${rotulo}".`);
    const n = f(await pasta.ler(nome, colunas));
    if (n > 0) abasLidas.push(`${nome} (${n} linhas)`);
    else if (n === 0) avisos.push(`A aba "${nome}" não tem o cabeçalho esperado; foi ignorada.`);
  };
  // a ordem importa: a Relação de frota manda na identificação; as outras completam
  await passo(/^RELACAO DE FROTA/, 'Relação de frota', (l) => lerRelacaoFrota(l, m));
  await passo(/^VALOR FROTA/, 'Valor frota', (l) => lerValorFrota(l, m));
  await passo(/^PROGRAMACAO/, 'Programação', (l) => lerProgramacao(l, m));
  await passo(/^QUADRO PREVENTIVA$/, 'Quadro preventiva', (l) => lerQuadroPreventiva(l, m, false));
  await passo(/^QUADRO PREVENTIVA \(ELETRICA\)/, 'Quadro preventiva (elétrica)', (l) => lerQuadroPreventiva(l, m, true));
  await passo(/^CONTRATOS/, 'Contratos', (l) => lerContratos(l, m));
  await passo(/^PERIFERICOS/, 'Periféricos', (l) => lerPerifericos(l, m));
  let pendencias: NovaPendencia[] = [];
  await passo(/^PENDENCIA/, 'Pendência', (l) => {
    pendencias = lerPendencias(l);
    return pendencias.length || -1;
  });
  let historico: NovaPeca[] = [];
  await passo(
    /^HISTORICO AUVO/,
    'Histórico Auvo',
    (l) => {
      historico = lerHistoricoAuvo(l);
      return historico.length;
    },
    14,
  );
  const fichas = [...m.values()].sort((a, b) => a.frota.localeCompare(b.frota, 'pt-BR', { numeric: true }));
  return { fichas, historico, pendencias, abasLidas, avisos, divergencias: acharDivergencias(fichas, clientes, oficina) };
}
