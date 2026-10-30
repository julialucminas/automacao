import type { Cliente, ClienteInput, Frota } from '../types';
import { formatarReais, lerReais } from './dinheiro';
import { dataBr, lerData } from './calendario';
import { chaveEmpresa, emailValido } from './normalizar';

/*
 * Lê a planilha de clientes. Aceita dois formatos:
 *
 * 1) Simples (o que o financeiro já usa): duas colunas, Cliente | Email.
 *    Quando o cliente tem vários e-mails, as linhas de baixo ficam com o nome em branco.
 *
 * 2) Completo (modelo para baixar): Nome no arquivo | Outros nomes | CNPJ | Para | Cópia | Observações.
 *    Vários e-mails na mesma célula separados por ";".
 *
 * Os dois podem se misturar: colunas que não existirem ficam vazias.
 */

export type Celula = string | number | boolean | Date | null | undefined;

export type ClienteLido = {
  linha: number;
  nome: string;
  apelidos: string[];
  cnpj: string;
  para: string[];
  cc: string[];
  observacoes: string;
  /** undefined = a planilha não informa (não mexe no que está cadastrado) */
  diaEmissao?: number | null;
  frotas?: Frota[];
  regra?: 'dia' | 'periodo';
  inicioLocacao?: string | null;
  periodoDias?: number | null;
  avisos: string[];
};

export type Leitura = {
  clientes: ClienteLido[];
  /** Problemas que não pertencem a um cliente específico. */
  avisosGerais: string[];
  /** A planilha tem coluna própria de Cópia? Se não, o usuário escolhe como distribuir. */
  temColunaCopia: boolean;
};

type Coluna = 'nome' | 'apelidos' | 'cnpj' | 'para' | 'cc' | 'obs' | 'dia' | 'frotas' | 'inicio' | 'periodo';

const PADROES: [Coluna, RegExp][] = [
  ['cc', /^(c[oó]pia|cc|com c[oó]pia)/],
  ['apelidos', /(outros nomes|apelido|tamb[eé]m aparece)/],
  ['cnpj', /cnpj/],
  ['obs', /observ|^obs/],
  ['dia', /(dia d[ae] emiss|emiss[aã]o|dia da fatura)/],
  ['frotas', /frota/],
  ['inicio', /in[ií]cio/],
  ['periodo', /per[ií]odo|a cada/],
  ['para', /(e-?mails?|para|destinat)/],
  ['nome', /(cliente|nome|empresa|raz[aã]o)/],
];

const texto = (c: Celula) => (c === null || c === undefined ? '' : String(c)).replace(/\u00a0/g, ' ').trim();

function mapearCabecalho(linha: Celula[]): Partial<Record<Coluna, number>> | null {
  const mapa: Partial<Record<Coluna, number>> = {};
  linha.forEach((c, i) => {
    const t = texto(c).toLowerCase();
    if (!t) return;
    const achado = PADROES.find(([col, re]) => mapa[col] === undefined && re.test(t));
    if (achado) mapa[achado[0]] = i;
  });
  // cabeçalho = coluna de cliente + pelo menos mais uma conhecida (e-mail, frotas, datas...)
  return mapa.nome !== undefined && Object.keys(mapa).length >= 2 ? mapa : null;
}

export function separarEmails(c: Celula): string[] {
  return texto(c)
    .split(/[\s,;/]+/)
    .map((e) => e.replace(/^mailto:/i, '').replace(/[.]+$/, '').trim().toLowerCase())
    .filter(Boolean);
}

const DOMINIOS_GENERICOS = new Set(['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.com.br', 'uol.com.br', 'bol.com.br', 'live.com', 'icloud.com']);

function distancia(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

const raizDominio = (dom: string) => dom.replace(/\.(com|net|org|eng|log|eco|ind)?\.?(br)?$/, '');

/** Domínios quase iguais no mesmo cliente costumam ser erro de digitação. */
export function avisosDeDominio(emails: string[]): string[] {
  const doms = [...new Set(emails.map((e) => e.split('@')[1]).filter((d) => d && !DOMINIOS_GENERICOS.has(d)))];
  const avisos: string[] = [];
  for (let i = 0; i < doms.length; i++)
    for (let j = i + 1; j < doms.length; j++) {
      const [a, b] = [doms[i], doms[j]];
      const [ra, rb] = [raizDominio(a), raizDominio(b)];
      if (ra === rb) avisos.push(`Mesmo domínio com finais diferentes: ${a} × ${b}. Confira se os dois existem.`);
      else if (Math.min(ra.length, rb.length) >= 5 && distancia(ra, rb) <= 2)
        avisos.push(`Domínios muito parecidos: ${a} × ${b}. Um deles pode ter erro de digitação.`);
    }
  return avisos;
}

export function lerPlanilha(linhas: Celula[][]): Leitura {
  const avisosGerais: string[] = [];
  let inicio = 0;
  let mapa: Partial<Record<Coluna, number>> | null = null;
  for (let i = 0; i < Math.min(linhas.length, 10); i++) {
    mapa = mapearCabecalho(linhas[i]);
    if (mapa) {
      inicio = i + 1;
      break;
    }
  }
  if (!mapa) {
    mapa = { nome: 0, para: 1 };
    avisosGerais.push('Não encontrei cabeçalho. Considerei a 1ª coluna como cliente e a 2ª como e-mail.');
  }
  const m = mapa;
  const cel = (l: Celula[], c: Coluna) => (m[c] === undefined ? '' : texto(l[m[c]!]));

  const porChave = new Map<string, ClienteLido>();
  const ordem: ClienteLido[] = [];
  let atual: ClienteLido | null = null;

  for (let i = inicio; i < linhas.length; i++) {
    const l = linhas[i] ?? [];
    const numLinha = i + 1;
    const nome = cel(l, 'nome').toUpperCase().replace(/\s+/g, ' ');
    const para = separarEmails(m.para !== undefined ? l[m.para] : '');
    const cc = separarEmails(m.cc !== undefined ? l[m.cc] : '');
    const apelidos = cel(l, 'apelidos').split(/[;,]/).map((a) => a.trim().toUpperCase()).filter(Boolean);
    const cnpj = cel(l, 'cnpj');
    const obs = cel(l, 'obs');
    const dia = cel(l, 'dia');
    const frotasTxt = cel(l, 'frotas');
    const inicioBruto = m.inicio === undefined ? '' : l[m.inicio];
    const periodoTxt = cel(l, 'periodo');
    if (!nome && !para.length && !cc.length && !apelidos.length && !obs && !dia && !frotasTxt && !texto(inicioBruto) && !periodoTxt) continue;

    if (nome) {
      const k = chaveEmpresa(nome);
      const existente = porChave.get(k);
      if (existente) {
        existente.avisos.push(`Aparece de novo na linha ${numLinha}: os e-mails foram juntados.`);
        atual = existente;
      } else {
        atual = { linha: numLinha, nome, apelidos: [], cnpj: '', para: [], cc: [], observacoes: '', avisos: [] };
        porChave.set(k, atual);
        ordem.push(atual);
      }
    } else if (!atual) {
      avisosGerais.push(`Linha ${numLinha}: e-mail sem cliente (${[...para, ...cc].join(', ')}). Ignorado.`);
      continue;
    }

    const c = atual!;
    for (const [lista, alvo] of [
      [para, c.para],
      [cc, c.cc],
    ] as const) {
      for (const e of lista) {
        if (!emailValido(e)) c.avisos.push(`Linha ${numLinha}: "${e}" não é um e-mail válido. Ignorado.`);
        else if (!c.para.includes(e) && !c.cc.includes(e)) alvo.push(e);
      }
    }
    for (const a of apelidos) if (!c.apelidos.includes(a)) c.apelidos.push(a);
    if (cnpj && !c.cnpj) c.cnpj = cnpj;
    if (dia) {
      const n = Number(dia);
      if (Number.isInteger(n) && n >= 1 && n <= 31) c.diaEmissao = n;
      else c.avisos.push(`Linha ${numLinha}: dia de emissão "${dia}" inválido (use 1 a 31). Ignorado.`);
    }
    if (texto(inicioBruto)) {
      const d = lerData(inicioBruto);
      if (d) c.inicioLocacao = d;
      else c.avisos.push(`Linha ${numLinha}: data de início "${texto(inicioBruto)}" não entendida (use dd/mm/aaaa). Ignorada.`);
    }
    if (periodoTxt) {
      const n = Number(periodoTxt.replace(/\D+$/, '').trim());
      if (Number.isInteger(n) && n >= 1 && n <= 366) c.periodoDias = n;
      else c.avisos.push(`Linha ${numLinha}: período "${periodoTxt}" inválido (use o número de dias). Ignorado.`);
    }
    if (frotasTxt) {
      const { frotas, problemas } = lerFrotasTexto(frotasTxt);
      c.frotas = [...(c.frotas ?? []), ...frotas.filter((f) => !(c.frotas ?? []).some((x) => x.numero === f.numero))];
      c.avisos.push(...problemas.map((pr) => `Linha ${numLinha}: ${pr}`));
    }
    if (obs) c.observacoes = c.observacoes ? `${c.observacoes} ${obs}` : obs;
  }

  for (const c of ordem) {
    if (c.inicioLocacao && c.periodoDias) c.regra = 'periodo';
    else if (c.inicioLocacao || c.periodoDias) c.avisos.push('Para faturar por período, informe a data de início E o período em dias.');
    else if (c.diaEmissao) c.regra = 'dia';
    if (!c.para.length && !c.cc.length) c.avisos.push('Sem e-mail na planilha: serve só para atualizar cliente que já está cadastrado.');
    c.avisos.push(...avisosDeDominio([...c.para, ...c.cc]));
  }

  return { clientes: ordem, avisosGerais, temColunaCopia: m.cc !== undefined };
}

/** "F-101 = 1.500,00 (Empilhadeira 2,5t); F-102 = 980,50" → frotas */
export function lerFrotasTexto(texto: string): { frotas: Frota[]; problemas: string[] } {
  const frotas: Frota[] = [];
  const problemas: string[] = [];
  for (const parte of texto.split(/[;\n]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(.+?)\s*(?:=\s*([^()]+?))?\s*(?:\((.*)\))?$/.exec(parte);
    const numero = (m?.[1] ?? '').trim().toUpperCase();
    if (!numero) continue;
    let valor = 0;
    if (m?.[2]) {
      const v = lerReais(m[2]);
      if (v === null) problemas.push(`valor "${m[2]}" da frota ${numero} não entendido; ficou sem valor.`);
      else valor = v;
    }
    frotas.push({ numero, valor, descricao: (m?.[3] ?? '').trim() });
  }
  return { frotas, problemas };
}

export const frotasParaTexto = (frotas: Frota[]) =>
  frotas
    .map((f) => `${f.numero} = ${formatarReais(f.valor).replace(/^R\$\s*/, '')}${f.descricao ? ` (${f.descricao})` : ''}`)
    .join('; ');

export type Distribuicao = 'todos_para' | 'primeiro_para';

export type Proposta = {
  lido: ClienteLido;
  acao: 'novo' | 'atualizar' | 'igual' | 'invalido';
  /** Cliente já cadastrado que corresponde a este (por nome ou outro nome). */
  existente: Cliente | null;
  input: ClienteInput;
  /** E-mails que serão acrescentados a um cliente existente. */
  novosEmails: string[];
};

/**
 * Compara com o cadastro. Cliente existente nunca perde e-mails: os novos são acrescentados.
 */
export function proporImportacao(leitura: Leitura, clientes: Cliente[], dist: Distribuicao): Proposta[] {
  return leitura.clientes.map((lido) => {
    let para = [...lido.para];
    let cc = [...lido.cc];
    if (!leitura.temColunaCopia && dist === 'primeiro_para' && para.length > 1) {
      cc = [...para.slice(1), ...cc];
      para = para.slice(0, 1);
    }
    const k = chaveEmpresa(lido.nome);
    const existente =
      clientes.find((c) => chaveEmpresa(c.nome) === k) ?? clientes.find((c) => c.apelidos.some((a) => chaveEmpresa(a) === k)) ?? null;

    // sem e-mail só é problema para cliente novo; para cliente existente, a planilha pode trazer só frotas/datas
    if (!existente && !para.length && !cc.length) {
      return { lido, acao: 'invalido', existente, novosEmails: [], input: { nome: lido.nome, apelidos: lido.apelidos, cnpj: lido.cnpj, para, cc, observacoes: lido.observacoes } };
    }
    if (!para.length) {
      para = cc.slice(0, 1);
      cc = cc.slice(1);
    }

    if (!existente) {
      return {
        lido,
        acao: 'novo',
        existente: null,
        novosEmails: [],
        input: {
          nome: lido.nome,
          apelidos: lido.apelidos,
          cnpj: lido.cnpj,
          para,
          cc,
          observacoes: lido.observacoes,
          diaEmissao: lido.diaEmissao,
          frotas: lido.frotas,
          regra: lido.regra,
          inicioLocacao: lido.regra === 'periodo' ? lido.inicioLocacao : undefined,
          periodoDias: lido.regra === 'periodo' ? lido.periodoDias : undefined,
        },
      };
    }

    const jaTem = new Set([...existente.para, ...existente.cc]);
    const novosPara = para.filter((e) => !jaTem.has(e));
    const novosCc = cc.filter((e) => !jaTem.has(e) && !novosPara.includes(e));
    const novosApelidos = lido.apelidos.filter((a) => !existente.apelidos.includes(a) && chaveEmpresa(a) !== chaveEmpresa(existente.nome));
    const obsNova = lido.observacoes && !existente.observacoes.includes(lido.observacoes);
    const diaMuda = lido.diaEmissao !== undefined && lido.diaEmissao !== existente.diaEmissao;
    const frotasMudam = lido.frotas !== undefined && JSON.stringify(lido.frotas) !== JSON.stringify(existente.frotas);
    const regraMuda =
      lido.regra !== undefined &&
      (lido.regra !== existente.regra ||
        (lido.regra === 'periodo' && (lido.inicioLocacao !== existente.inicioLocacao || lido.periodoDias !== existente.periodoDias)));
    const muda = novosPara.length || novosCc.length || novosApelidos.length || obsNova || (lido.cnpj && !existente.cnpj) || diaMuda || frotasMudam || regraMuda;

    return {
      lido,
      acao: muda ? 'atualizar' : 'igual',
      existente,
      novosEmails: [...novosPara, ...novosCc],
      input: {
        id: existente.id,
        nome: existente.nome,
        apelidos: [...existente.apelidos, ...novosApelidos],
        cnpj: existente.cnpj || lido.cnpj,
        para: [...existente.para, ...novosPara],
        cc: [...existente.cc, ...novosCc],
        observacoes: obsNova ? [existente.observacoes, lido.observacoes].filter(Boolean).join(' ') : existente.observacoes,
        // a planilha manda no faturamento quando informa; se não informa, fica o que está cadastrado
        diaEmissao: lido.diaEmissao,
        frotas: lido.frotas,
        regra: lido.regra,
        inicioLocacao: lido.regra === 'periodo' ? lido.inicioLocacao : undefined,
        periodoDias: lido.regra === 'periodo' ? lido.periodoDias : undefined,
      },
    };
  });
}

const CABECALHO = ['Nome no arquivo', 'Outros nomes', 'CNPJ', 'Para', 'Cópia', 'Observações', 'Dia de emissão', 'Início da locação', 'Período (dias)', 'Frotas'];

function paraCsv(linhas: string[][]): string {
  return '\ufeff' + linhas.map((l) => l.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\r\n');
}

/** Exporta o cadastro no formato do modelo: serve de backup e pode ser importado de volta. */
export function exportarCsv(clientes: Cliente[]): string {
  return paraCsv([
    CABECALHO,
    ...clientes.map((c) => [c.nome, c.apelidos.join('; '), c.cnpj, c.para.join('; '), c.cc.join('; '), c.observacoes,
      c.regra === 'dia' && c.diaEmissao ? String(c.diaEmissao) : '',
      c.regra === 'periodo' && c.inicioLocacao ? dataBr(c.inicioLocacao) : '',
      c.regra === 'periodo' && c.periodoDias ? String(c.periodoDias) : '',
      frotasParaTexto(c.frotas),
    ]),
  ]);
}

/** Modelo para baixar (CSV com ";" e BOM, abre direto no Excel em português). */
export function modeloCsv(): string {
  return paraCsv([
    CABECALHO,
    ['EMPRESA EXEMPLO', 'EXEMPLO; EMPRESA EXEMPLO LTDA', '00.000.000/0000-00', 'financeiro@exemplo.com.br; contas@exemplo.com.br', 'contador@escritorio.com.br', 'Falar com a Ana', '5', '', '', 'F-101 = 1.500,00 (Empilhadeira 2,5t); F-102 = 980,50'],
  ]);
}

/** Lê CSV com ";" ou "," (detecta pelo cabeçalho), respeitando aspas. */
export function lerCsv(conteudo: string): string[][] {
  const s = conteudo.replace(/^\ufeff/, '');
  const primeira = s.split(/\r?\n/)[0] ?? '';
  const sep = (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0) ? ';' : ',';
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (aspas) {
      if (ch === '"' && s[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (ch === '"') aspas = false;
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) {
      linha.push(campo);
      campo = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = '';
    } else campo += ch;
  }
  if (campo || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}
