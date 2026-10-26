import type { Cliente, ClienteInput } from '../types';
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
  avisos: string[];
};

export type Leitura = {
  clientes: ClienteLido[];
  /** Problemas que não pertencem a um cliente específico. */
  avisosGerais: string[];
  /** A planilha tem coluna própria de Cópia? Se não, o usuário escolhe como distribuir. */
  temColunaCopia: boolean;
};

type Coluna = 'nome' | 'apelidos' | 'cnpj' | 'para' | 'cc' | 'obs';

const PADROES: [Coluna, RegExp][] = [
  ['cc', /^(c[oó]pia|cc|com c[oó]pia)/],
  ['apelidos', /(outros nomes|apelido|tamb[eé]m aparece)/],
  ['cnpj', /cnpj/],
  ['obs', /observ|^obs/],
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
  return mapa.nome !== undefined && mapa.para !== undefined ? mapa : null;
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
    if (!nome && !para.length && !cc.length && !apelidos.length && !obs) continue;

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
    if (obs) c.observacoes = c.observacoes ? `${c.observacoes} ${obs}` : obs;
  }

  for (const c of ordem) {
    if (!c.para.length && !c.cc.length) c.avisos.push('Nenhum e-mail válido.');
    c.avisos.push(...avisosDeDominio([...c.para, ...c.cc]));
  }

  return { clientes: ordem, avisosGerais, temColunaCopia: m.cc !== undefined };
}

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

    if (!para.length && !cc.length) {
      return { lido, acao: 'invalido', existente, novosEmails: [], input: { nome: lido.nome, apelidos: lido.apelidos, cnpj: lido.cnpj, para, cc, observacoes: lido.observacoes } };
    }
    if (!para.length) {
      para = cc.slice(0, 1);
      cc = cc.slice(1);
    }

    if (!existente) {
      return { lido, acao: 'novo', existente: null, novosEmails: [], input: { nome: lido.nome, apelidos: lido.apelidos, cnpj: lido.cnpj, para, cc, observacoes: lido.observacoes } };
    }

    const jaTem = new Set([...existente.para, ...existente.cc]);
    const novosPara = para.filter((e) => !jaTem.has(e));
    const novosCc = cc.filter((e) => !jaTem.has(e) && !novosPara.includes(e));
    const novosApelidos = lido.apelidos.filter((a) => !existente.apelidos.includes(a) && chaveEmpresa(a) !== chaveEmpresa(existente.nome));
    const obsNova = lido.observacoes && !existente.observacoes.includes(lido.observacoes);
    const muda = novosPara.length || novosCc.length || novosApelidos.length || obsNova || (lido.cnpj && !existente.cnpj);

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
      },
    };
  });
}

/** Modelo para baixar (CSV com ";" e BOM, abre direto no Excel em português). */
export function modeloCsv(): string {
  const linhas = [
    ['Nome no arquivo', 'Outros nomes', 'CNPJ', 'Para', 'Cópia', 'Observações'],
    ['EMPRESA EXEMPLO', 'EXEMPLO; EMPRESA EXEMPLO LTDA', '00.000.000/0000-00', 'financeiro@exemplo.com.br; contas@exemplo.com.br', 'contador@escritorio.com.br', 'Falar com a Ana'],
  ];
  return '\ufeff' + linhas.map((l) => l.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\r\n');
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
