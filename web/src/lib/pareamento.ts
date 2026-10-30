import type { ArquivoLido, Cliente, ItemLote, Lote, StatusItem } from '../types';
import { chaveEmpresa, normalizarNumero } from './normalizar';

/*
 * Padrões de nome combinados com o financeiro:
 *   Fatura: "1234 NOME DA EMPRESA.PDF"
 *   Boleto: "BOLETO 1234.PDF"
 * Aceita variações comuns: minúsculas, hífen ou "_" como separador, espaços extras, zeros à esquerda.
 */
const RE_BOLETO = /^BOLETO[\s_-]*(\d+)\s*\.pdf$/i;
const RE_FATURA = /^(\d+)[\s_-]+(.+?)\s*\.pdf$/i;

export type Classificacao =
  | { tipo: 'boleto'; numero: string }
  | { tipo: 'fatura'; numero: string; empresa: string }
  | { tipo: 'desconhecido' };

export function classificar(nomeArquivo: string): Classificacao {
  const nome = nomeArquivo.trim().replace(/\s+/g, ' ');
  const b = RE_BOLETO.exec(nome);
  if (b) return { tipo: 'boleto', numero: normalizarNumero(b[1]) };
  const f = RE_FATURA.exec(nome);
  if (f) return { tipo: 'fatura', numero: normalizarNumero(f[1]), empresa: f[2].trim().toUpperCase() };
  return { tipo: 'desconhecido' };
}

/** Procura o cliente pelo nome do arquivo: primeiro pelo nome cadastrado, depois pelos apelidos. */
export function encontrarCliente(
  empresa: string,
  clientes: Cliente[],
): { clienteId: string; vinculo: 'nome' | 'apelido' } | null {
  const chave = chaveEmpresa(empresa);
  if (!chave) return null;
  const ativos = clientes.filter((c) => c.ativo);
  const porNome = ativos.find((c) => chaveEmpresa(c.nome) === chave);
  if (porNome) return { clienteId: porNome.id, vinculo: 'nome' };
  const porApelido = ativos.find((c) => c.apelidos.some((a) => chaveEmpresa(a) === chave));
  if (porApelido) return { clienteId: porApelido.id, vinculo: 'apelido' };
  return null;
}

export type ResultadoPareamento = {
  itens: ItemLote[];
  naoReconhecidos: ArquivoLido[];
};

export function parear(arquivos: ArquivoLido[], clientes: Cliente[]): ResultadoPareamento {
  const faturas: { numero: string; empresa: string; arquivo: ArquivoLido }[] = [];
  const boletos = new Map<string, ArquivoLido[]>();
  const naoReconhecidos: ArquivoLido[] = [];

  for (const arq of arquivos) {
    const c = classificar(arq.nome);
    if (c.tipo === 'boleto') {
      const lista = boletos.get(c.numero) ?? [];
      lista.push(arq);
      boletos.set(c.numero, lista);
    } else if (c.tipo === 'fatura') {
      faturas.push({ numero: c.numero, empresa: c.empresa, arquivo: arq });
    } else {
      naoReconhecidos.push(arq);
    }
  }

  const contagemFaturas = new Map<string, number>();
  for (const f of faturas) contagemFaturas.set(f.numero, (contagemFaturas.get(f.numero) ?? 0) + 1);

  const itens: ItemLote[] = faturas.map((f) => {
    const bs = boletos.get(f.numero) ?? [];
    const achado = encontrarCliente(f.empresa, clientes);
    const duplicado = (contagemFaturas.get(f.numero) ?? 0) > 1 || bs.length > 1;
    const item: ItemLote = {
      numero: f.numero,
      empresaNoArquivo: f.empresa,
      fatura: f.arquivo,
      boleto: bs[0] ?? null,
      clienteId: achado?.clienteId ?? null,
      vinculo: achado?.vinculo ?? null,
      duplicado,
      marcado: false,
      enviado: false,
      observacao: '',
    };
    item.marcado = statusDoItem(item, clientes) === 'pronto';
    return item;
  });

  // boletos que não têm fatura com o mesmo número
  for (const [numero, bs] of boletos) {
    if (contagemFaturas.has(numero)) continue;
    itens.push({
      numero,
      empresaNoArquivo: '',
      fatura: null,
      boleto: bs[0],
      clienteId: null,
      vinculo: null,
      duplicado: bs.length > 1,
      marcado: false,
      enviado: false,
      observacao: '',
    });
  }

  itens.sort((a, b) => Number(a.numero) - Number(b.numero) || a.empresaNoArquivo.localeCompare(b.empresaNoArquivo));
  return { itens, naoReconhecidos };
}

/** clientes: quando informado, também confere se o cliente tem e-mail para envio. */
export function statusDoItem(i: ItemLote, clientes?: Cliente[]): StatusItem {
  if (i.enviado) return 'enviado';
  if (!i.fatura) return 'boleto_sem_fatura';
  if (i.duplicado) return 'numero_duplicado';
  if (!i.boleto) return 'sem_boleto';
  if (!i.clienteId) return 'sem_cadastro';
  if (clientes && !(clientes.find((c) => c.id === i.clienteId)?.para.length)) return 'sem_email';
  return 'pronto';
}

export const STATUS_ITEM: Record<StatusItem, { rotulo: string; tom: 'ok' | 'warn' | 'bad' | 'info' }> = {
  pronto: { rotulo: 'Pronto', tom: 'ok' },
  sem_boleto: { rotulo: 'Fatura sem boleto', tom: 'warn' },
  sem_cadastro: { rotulo: 'Empresa sem cadastro', tom: 'warn' },
  sem_email: { rotulo: 'Cliente sem e-mail', tom: 'warn' },
  boleto_sem_fatura: { rotulo: 'Boleto sem fatura', tom: 'bad' },
  numero_duplicado: { rotulo: 'Número repetido', tom: 'bad' },
  enviado: { rotulo: 'Enviado', tom: 'info' },
};

export function temAviso(i: ItemLote, clientes?: Cliente[]): boolean {
  const s = statusDoItem(i, clientes);
  return s !== 'pronto' && s !== 'enviado';
}

/**
 * Sugere clientes prováveis quando o nome do arquivo não bate exatamente com o cadastro.
 * Ex.: arquivo "MINASBEV INDUSTRIA DE BEBIDAS" e cadastro "MINASBEV".
 * É só sugestão: quem confirma é o financeiro (e o sistema aprende o nome).
 */
export function sugerirClientes(empresa: string, clientes: Cliente[], limite = 3): Cliente[] {
  const alvo = chaveEmpresa(empresa).split(' ').filter(Boolean);
  if (!alvo.length) return [];
  const pontuar = (nome: string): number => {
    const t = chaveEmpresa(nome).split(' ').filter(Boolean);
    if (!t.length) return 0;
    const curto = t.join('').length <= 3;
    // o nome cadastrado inteiro aparece no começo do nome do arquivo
    if (t.every((x, i) => alvo[i] === x)) return 4;
    // o nome do arquivo inteiro aparece no começo do nome cadastrado
    if (alvo.every((x, i) => t[i] === x)) return 3;
    if (curto) return 0; // siglas (AD, WF, GES) só valem no começo
    // todas as palavras do cadastro aparecem no arquivo, em qualquer posição
    if (t.every((x) => alvo.includes(x))) return 2;
    // a primeira palavra (relevante) coincide
    if (t[0].length >= 4 && alvo.includes(t[0])) return 1;
    return 0;
  };
  return clientes
    .filter((c) => c.ativo)
    .map((c) => ({ c, p: Math.max(pontuar(c.nome), ...c.apelidos.map(pontuar)) }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p || a.c.nome.localeCompare(b.c.nome))
    .slice(0, limite)
    .map((x) => x.c);
}

/**
 * Junta arquivos novos a um lote já aberto, sem perder o que foi feito nele
 * (enviados, observações, vínculos feitos à mão, marcações).
 * Arquivo com o mesmo nome de um que já está no lote substitui o anterior.
 */
export function acrescentarAoLote(lote: Lote, novos: ArquivoLido[], clientes: Cliente[], jaEnviados: Set<string> = new Set()): { lote: Lote; adicionados: number; completados: string[] } {
  const chaveArq = (a: ArquivoLido) => a.nome.trim().toUpperCase();
  const todos = new Map<string, ArquivoLido>();
  for (const i of lote.itens) for (const a of [i.fatura, i.boleto]) if (a) todos.set(chaveArq(a), a);
  for (const a of lote.naoReconhecidos) todos.set(chaveArq(a), a);
  let adicionados = 0;
  for (const a of novos) {
    if (!todos.has(chaveArq(a))) adicionados++;
    todos.set(chaveArq(a), a);
  }
  // boletos anexados à mão (nome fora do padrão) continuam no item certo
  const manuais = lote.itens.filter((i) => i.boleto && classificar(i.boleto.nome).tipo !== 'boleto').map((i) => ({ numero: i.numero, boleto: i.boleto! }));
  for (const m of manuais) todos.delete(chaveArq(m.boleto));
  const { itens, naoReconhecidos } = parear([...todos.values()], clientes);
  const antigos = new Map(lote.itens.map((i) => [`${i.numero}|${i.fatura?.nome ?? ''}`, i]));
  const completados: string[] = [];
  const resultado = itens.map((n) => {
    const manual = manuais.find((m) => m.numero === n.numero);
    if (manual && !n.boleto) n.boleto = manual.boleto;
    const a = antigos.get(`${n.numero}|${n.fatura?.nome ?? ''}`) ?? (n.fatura ? undefined : antigos.get(`${n.numero}|`));
    if (!a) {
      // fatura que só agora ganhou o boleto (ou o contrário) também conta como "completada"
      const parcial = lote.itens.find((x) => x.numero === n.numero);
      if (parcial && !parcial.enviado && statusDoItem(n, clientes) === 'pronto') completados.push(n.numero);
      if (parcial) {
        n.observacao = parcial.observacao;
        if (parcial.vinculo === 'manual' && parcial.clienteId) {
          n.clienteId = parcial.clienteId;
          n.vinculo = 'manual';
        }
      }
      n.marcado = statusDoItem(n, clientes) === 'pronto' && !jaEnviados.has(n.numero);
      return n;
    }
    const estavaPronto = statusDoItem(a, clientes) === 'pronto';
    const item: ItemLote = {
      ...n,
      enviado: a.enviado,
      observacao: a.observacao,
      clienteId: a.vinculo === 'manual' ? a.clienteId : n.clienteId,
      vinculo: a.vinculo === 'manual' ? 'manual' : n.vinculo,
    };
    const prontoAgora = statusDoItem(item, clientes) === 'pronto';
    if (!estavaPronto && prontoAgora) completados.push(item.numero);
    item.marcado = item.enviado ? false : estavaPronto ? a.marcado && prontoAgora : prontoAgora && !jaEnviados.has(item.numero);
    return item;
  });
  return { lote: { ...lote, itens: resultado, naoReconhecidos }, adicionados, completados };
}

/** Anexa um PDF escolhido à mão como boleto (ou fatura) de um item, mesmo com nome fora do padrão. */
export function anexarNoItem(lote: Lote, numero: string, tipo: 'boleto' | 'fatura', arquivo: ArquivoLido, clientes: Cliente[]): Lote {
  const itens = lote.itens.map((i) => {
    if (i.numero !== numero || i.enviado) return i;
    // o boleto sai para o cliente sempre com o nome padrão, mesmo que o arquivo tenha outro nome
    const arq = tipo === 'boleto' ? { ...arquivo, nome: `BOLETO ${numero}.pdf` } : arquivo;
    let n: ItemLote = { ...i, [tipo]: arq };
    if (tipo === 'fatura') {
      const c = classificar(arquivo.nome);
      const empresa = c.tipo === 'fatura' ? c.empresa : i.empresaNoArquivo;
      const achado = empresa ? encontrarCliente(empresa, clientes) : null;
      n = { ...n, empresaNoArquivo: empresa, clienteId: i.vinculo === 'manual' ? i.clienteId : (achado?.clienteId ?? null), vinculo: i.vinculo === 'manual' ? 'manual' : (achado?.vinculo ?? null) };
    }
    n.marcado = statusDoItem(n, clientes) === 'pronto';
    return n;
  });
  // o arquivo deixa de ser "fora do padrão" se estava nessa lista
  return { ...lote, itens, naoReconhecidos: lote.naoReconhecidos.filter((a) => a.nome !== arquivo.nome) };
}
