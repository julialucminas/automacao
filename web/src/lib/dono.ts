/*
 * Indicadores do app do dono. Tudo calculado aqui, a partir do que o sistema já tem:
 * frotas dos clientes (receita de hoje), fichas, movimentações, fotos mensais, gastos com
 * peças/serviços, OS, solicitações e serviços externos. Funções puras, para testar.
 */
import type { Envio, FotoMensal, Movimentacao, Ordem, Pendencia, ServicoExterno, Solicitacao } from '../types';
import type { LinhaEquipamento } from './equipamentos';
import { efeitoNaReceita, NOMES_TIPO, somarMeses } from './movimentacao';
import { somarDias } from './manutencao';

export type Gasto = { frota: string; total: number; lancamentos: number; visitas: number; ultima: string };

/** Gasto de manutenção acima disso (em relação ao que a máquina fatura no ano) acende "candidata a vender". */
export const LIMITE_GASTO = 0.3;
/** Um cliente com mais disso da receita é risco de concentração. */
export const LIMITE_CONCENTRACAO = 0.2;

export const dias = (de: string, ate: string) => Math.round((Date.parse(ate.slice(0, 10)) - Date.parse(de.slice(0, 10))) / 86_400_000);
const mesDe = (iso: string) => iso.slice(0, 7);
const fimDoMes = (mes: string) => somarDias(somarMeses(`${mes}-01`, 1), -1);
const aprovadas = (movs: Movimentacao[]) => movs.filter((m) => m.status === 'aprovada');

/** Receita mensal de locação de hoje (soma das frotas dos clientes). */
export const receitaAtual = (linhas: LinhaEquipamento[]) => linhas.reduce((s, l) => s + (l.locacao?.valor ?? 0), 0);

// ---------------------------------------------------------------- receita mês a mês

export type PontoReceita = { mes: string; receita: number | null; estimado: boolean };

/**
 * Últimos `n` meses. Mês com foto: o valor gravado. Mês corrente: o valor de agora.
 * Mês sem foto: reconstruído pelas movimentações (receita de hoje menos o que mudou depois
 * do fim daquele mês) — só até um mês antes da primeira movimentação; antes disso, sem dado.
 */
export function serieReceita(fotos: FotoMensal[], movs: Movimentacao[], atual: number, hoje: string, n = 12): PontoReceita[] {
  const ok = aprovadas(movs).filter((m) => efeitoNaReceita(m) !== null);
  const primeira = ok.reduce<string | null>((p, m) => (!p || m.dados.data < p ? m.dados.data : p), null);
  const limite = primeira ? mesDe(somarMeses(`${mesDe(primeira)}-01`, -1)) : mesDe(hoje);
  const porMes = new Map(fotos.map((f) => [f.mes, f]));
  const pontos: PontoReceita[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const mes = mesDe(somarMeses(`${mesDe(hoje)}-01`, -i));
    if (i === 0) pontos.push({ mes, receita: atual, estimado: false });
    else if (porMes.has(mes)) pontos.push({ mes, receita: porMes.get(mes)!.receita, estimado: false });
    else if (mes >= limite) {
      const fim = fimDoMes(mes);
      const depois = ok.filter((m) => m.dados.data > fim).reduce((s, m) => s + (efeitoNaReceita(m) ?? 0), 0);
      pontos.push({ mes, receita: Math.max(0, atual - depois), estimado: true });
    } else pontos.push({ mes, receita: null, estimado: false });
  }
  return pontos;
}

// ---------------------------------------------------------------- ponte do mês

export type Ponte = {
  entrou: number;
  saiu: number;
  reajustes: number;
  liquido: number;
  locacoes: number;
  devolucoes: number;
  vendas: { n: number; valor: number };
  compras: { n: number; valor: number };
  itens: Movimentacao[];
};

/** O que mudou na receita num mês (pela data da movimentação aprovada). */
export function ponteDoMes(movs: Movimentacao[], mes: string): Ponte {
  const itens = aprovadas(movs)
    .filter((m) => mesDe(m.dados.data) === mes)
    .sort((a, b) => b.dados.data.localeCompare(a.dados.data));
  const p: Ponte = { entrou: 0, saiu: 0, reajustes: 0, liquido: 0, locacoes: 0, devolucoes: 0, vendas: { n: 0, valor: 0 }, compras: { n: 0, valor: 0 }, itens };
  for (const m of itens) {
    const e = efeitoNaReceita(m) ?? 0;
    if (m.tipo === 'reajuste') p.reajustes += e;
    else if (e > 0) p.entrou += e;
    else p.saiu += -e;
    if (m.tipo === 'locacao') p.locacoes++;
    if (m.tipo === 'devolucao') p.devolucoes++;
    if (m.tipo === 'venda') {
      p.vendas.n++;
      p.vendas.valor += m.dados.valor ?? 0;
    }
    if (m.tipo === 'compra') {
      p.compras.n++;
      p.compras.valor += m.dados.valor ?? 0;
    }
  }
  p.liquido = p.entrou - p.saiu + p.reajustes;
  return p;
}

// ---------------------------------------------------------------- o que mudou na semana

export type Mudanca = { m: Movimentacao; efeito: number | null; titulo: string };

/** Movimentações registradas nos últimos 7 dias (aprovadas e pendentes), mais novas primeiro. */
export function mudancasDaSemana(movs: Movimentacao[], hoje: string): Mudanca[] {
  const desde = somarDias(hoje, -7);
  return movs
    .filter((m) => m.status !== 'rejeitada' && m.criadaEm.slice(0, 10) > desde)
    .sort((a, b) => b.criadaEm.localeCompare(a.criadaEm))
    .map((m) => ({
      m,
      efeito: m.tipo === 'compra' || m.tipo === 'venda' ? (m.tipo === 'venda' ? (m.dados.valor ?? null) : m.dados.valor != null ? -m.dados.valor : null) : efeitoNaReceita(m),
      titulo:
        m.tipo === 'reajuste'
          ? `Reajuste · ${m.clienteNome}`
          : `${NOMES_TIPO[m.tipo]} · FT${m.frota}${m.frotaNova ? ` → FT${m.frotaNova}` : ''}${m.clienteNome ? ` · ${m.clienteNome}` : ''}`,
    }));
}

// ---------------------------------------------------------------- clientes

export type ClienteReceita = { id: string; nome: string; total: number; frotas: number; parte: number };

export function receitaPorCliente(linhas: LinhaEquipamento[]): { lista: ClienteReceita[]; total: number; top5: number; maior: ClienteReceita | null } {
  const m = new Map<string, ClienteReceita>();
  for (const l of linhas)
    if (l.cliente && l.locacao) {
      const x = m.get(l.cliente.id) ?? { id: l.cliente.id, nome: l.cliente.nome, total: 0, frotas: 0, parte: 0 };
      x.total += l.locacao.valor;
      x.frotas++;
      m.set(l.cliente.id, x);
    }
  const lista = [...m.values()].sort((a, b) => b.total - a.total);
  const total = lista.reduce((s, c) => s + c.total, 0);
  for (const c of lista) c.parte = total ? c.total / total : 0;
  return { lista, total, top5: lista.slice(0, 5).reduce((s, c) => s + c.parte, 0), maior: lista[0] ?? null };
}

// ---------------------------------------------------------------- contratos

export type FaixaVencimento = { rotulo: string; maquinas: LinhaEquipamento[]; receita: number };
export type SemReajuste = { l: LinhaEquipamento; desde: string; meses: number };

export function contratos(linhas: LinhaEquipamento[], movs: Movimentacao[], hoje: string) {
  const locadas = linhas.filter((l) => l.locacao);
  const faixa = (rotulo: string, ok: (v: string) => boolean): FaixaVencimento => {
    const maquinas = locadas.filter((l) => l.ficha?.contratoVencimento && ok(l.ficha.contratoVencimento)).sort((a, b) => a.ficha!.contratoVencimento!.localeCompare(b.ficha!.contratoVencimento!));
    return { rotulo, maquinas, receita: maquinas.reduce((s, l) => s + (l.locacao?.valor ?? 0), 0) };
  };
  const d30 = somarDias(hoje, 30);
  const d60 = somarDias(hoje, 60);
  const d90 = somarDias(hoje, 90);
  const faixas = [
    faixa('Vencidos', (v) => v < hoje),
    faixa('Até 30 dias', (v) => v >= hoje && v <= d30),
    faixa('31 a 60 dias', (v) => v > d30 && v <= d60),
    faixa('61 a 90 dias', (v) => v > d60 && v <= d90),
  ];
  // último reajuste de cada frota (pelas movimentações aprovadas)
  const ultimoReajuste = new Map<string, string>();
  for (const m of aprovadas(movs))
    if (m.tipo === 'reajuste')
      for (const i of m.dados.itens ?? []) if ((ultimoReajuste.get(i.frota) ?? '') < m.dados.data) ultimoReajuste.set(i.frota, m.dados.data);
  const umAno = somarDias(hoje, -365);
  const semReajuste: SemReajuste[] = [];
  let semData = 0;
  for (const l of locadas) {
    const desde = [ultimoReajuste.get(l.frota), l.locacao?.inicio ?? undefined].filter((x): x is string => !!x).sort().pop();
    if (!desde) semData++;
    else if (desde <= umAno) semReajuste.push({ l, desde, meses: Math.floor(dias(desde, hoje) / 30.4) });
  }
  semReajuste.sort((a, b) => a.desde.localeCompare(b.desde));
  const modalidade = { contrato: 0, esporadico: 0, sem: 0, nContrato: 0, nEsporadico: 0, nSem: 0 };
  for (const l of locadas) {
    const v = l.locacao?.valor ?? 0;
    if (l.locacao?.modalidade === 'contrato') {
      modalidade.contrato += v;
      modalidade.nContrato++;
    } else if (l.locacao?.modalidade === 'esporadico') {
      modalidade.esporadico += v;
      modalidade.nEsporadico++;
    } else {
      modalidade.sem += v;
      modalidade.nSem++;
    }
  }
  const semVencimento = locadas.filter((l) => !l.ficha?.contratoVencimento).length;
  return { faixas, semReajuste, semData, modalidade, semVencimento, locadas: locadas.length };
}

// ---------------------------------------------------------------- frota

export type Parada = { l: LinhaEquipamento; desde: string | null; dias: number | null };

/** Máquinas sem cliente (disponíveis/reservadas): desde quando, pela última devolução/troca/compra. */
export function paradas(linhas: LinhaEquipamento[], movs: Movimentacao[], hoje: string): Parada[] {
  const saiu = new Map<string, string>();
  for (const m of aprovadas(movs)) {
    const n = m.tipo === 'devolucao' || m.tipo === 'troca' || m.tipo === 'compra' ? m.frota : null;
    if (n && (saiu.get(n) ?? '') < m.dados.data) saiu.set(n, m.dados.data);
  }
  return linhas
    .filter((l) => l.situacao === 'disponivel' || l.situacao === 'reservada')
    .map((l) => {
      const desde = saiu.get(l.frota) ?? null;
      return { l, desde, dias: desde ? Math.max(0, dias(desde, hoje)) : null };
    })
    .sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1));
}

export type Rentabilidade = {
  l: LinhaEquipamento;
  receitaAno: number;
  gasto: number;
  resultado: number;
  peso: number | null;
  idade: number | null;
  motivos: string[];
};

/** Por máquina: o que fatura no ano (valor de hoje × 12) menos o que gastou em 12 meses. */
export function rentabilidade(linhas: LinhaEquipamento[], gastos: Gasto[], hoje: string): Rentabilidade[] {
  const g = new Map(gastos.map((x) => [x.frota, x.total]));
  const ano = Number(hoje.slice(0, 4));
  return linhas
    .filter((l) => l.situacao !== 'baixada')
    .map((l) => {
      const receitaAno = (l.locacao?.valor ?? 0) * 12;
      const gasto = g.get(l.frota) ?? 0;
      const peso = receitaAno ? gasto / receitaAno : null;
      const idade = l.ficha?.ano ? ano - l.ficha.ano : null;
      const motivos: string[] = [];
      if (peso !== null && peso > LIMITE_GASTO) motivos.push(`gasto = ${Math.round(peso * 100)}% do que fatura`);
      if (!receitaAno && gasto > 0) motivos.push('gastou sem estar faturando');
      if (idade !== null && idade >= 12) motivos.push(`${idade} anos de uso`);
      if (l.ficha?.horimetro != null && l.ficha.horimetro >= 20_000) motivos.push(`${l.ficha.horimetro.toLocaleString('pt-BR')} h no horímetro`);
      return { l, receitaAno, gasto, resultado: receitaAno - gasto, peso, idade, motivos };
    });
}

/** Candidata a vender: o gasto passou do limite (ou gastou sem faturar). Idade e horímetro só reforçam. */
export const candidatasVenda = (r: Rentabilidade[]) =>
  r.filter((x) => (x.peso !== null && x.peso > LIMITE_GASTO) || (!x.receitaAno && x.gasto > 0)).sort((a, b) => b.gasto - a.gasto);

// ---------------------------------------------------------------- operação

export type Operacao = {
  osAbertas: number;
  osAtrasadas: Ordem[];
  osAguardandoPeca: number;
  osNoMes: number;
  porTecnico: { nome: string; concluidas: number; abertas: number }[];
  solicitacoesAbertas: Solicitacao[];
  externos: { ativos: number; aCobrar: number; aCobrarN: number; emAndamento: number; emAndamentoN: number; orcamentosEsperando: number; orcamentosValor: number };
};

const OS_ABERTA = new Set(['aberta', 'agendada', 'execucao', 'aguardando_peca']);

export function operacao(ordens: Ordem[], solicitacoes: Solicitacao[], externos: ServicoExterno[], hoje: string): Operacao {
  const mes = mesDe(hoje);
  const abertas = ordens.filter((o) => OS_ABERTA.has(o.status));
  const doMes = ordens.filter((o) => (o.status === 'concluida' || o.status === 'encerrada') && o.concluidaEm && mesDe(o.concluidaEm) === mes);
  const tec = new Map<string, { nome: string; concluidas: number; abertas: number }>();
  const t = (nome: string) => tec.get(nome) ?? tec.set(nome, { nome, concluidas: 0, abertas: 0 }).get(nome)!;
  for (const o of doMes) t(o.tecnicoNome || 'Sem técnico').concluidas++;
  for (const o of abertas) t(o.tecnicoNome || 'Sem técnico').abertas++;
  const soma = (l: ServicoExterno[]) => l.reduce((s, x) => s + (x.valor ?? 0), 0);
  const aCobrar = externos.filter((x) => x.etapa === 'concluido');
  const andamento = externos.filter((x) => x.etapa === 'aprovado' || x.etapa === 'execucao');
  const esperando = externos.filter((x) => x.etapa === 'enviado');
  return {
    osAbertas: abertas.length,
    osAtrasadas: abertas.filter((o) => o.agendadaPara && o.agendadaPara.slice(0, 10) < hoje).sort((a, b) => (a.agendadaPara ?? '').localeCompare(b.agendadaPara ?? '')),
    osAguardandoPeca: abertas.filter((o) => o.status === 'aguardando_peca').length,
    osNoMes: doMes.length,
    porTecnico: [...tec.values()].sort((a, b) => b.concluidas - a.concluidas || b.abertas - a.abertas),
    solicitacoesAbertas: solicitacoes.filter((s) => s.status === 'aberta').sort((a, b) => a.criadaEm.localeCompare(b.criadaEm)),
    externos: {
      ativos: externos.filter((x) => !['cobrado', 'recusado'].includes(x.etapa)).length,
      aCobrar: soma(aCobrar),
      aCobrarN: aCobrar.length,
      emAndamento: soma(andamento),
      emAndamentoN: andamento.length,
      orcamentosEsperando: esperando.length,
      orcamentosValor: soma(esperando),
    },
  };
}

// ---------------------------------------------------------------- pede sua atenção

export type Alerta = { chave: string; tom: 'bad' | 'warn'; titulo: string; detalhe: string; valor: number; frota?: string; ir?: 'receita' | 'frota' | 'operacao' };

/**
 * Tudo que pede atenção, do mais grave/caro para o menos. `valor` é o dinheiro envolvido por mês
 * (para ordenar); quem não vê valores recebe a mesma ordem, sem os números.
 */
export function alertas(args: {
  linhas: LinhaEquipamento[];
  movs: Movimentacao[];
  gastos: Gasto[];
  pendencias: Pendencia[];
  envios: Envio[];
  ordens: Ordem[];
  externos: ServicoExterno[];
  semVisita: { frota: string; dias: number; cliente: string; intervalo: number }[];
  hoje: string;
  reais: (c: number) => string;
  veValores: boolean;
}): Alerta[] {
  const { linhas, movs, gastos, pendencias, envios, ordens, externos, semVisita, hoje, reais, veValores } = args;
  const $ = (c: number) => (veValores && c ? ` · ${reais(c)}/mês` : '');
  const out: Alerta[] = [];
  const c = contratos(linhas, movs, hoje);
  for (const l of c.faixas[0].maquinas)
    out.push({ chave: `cv${l.frota}`, tom: 'bad', titulo: `Contrato vencido · FT${l.frota}`, detalhe: `${l.cliente?.nome ?? ''} · venceu em ${dmy(l.ficha!.contratoVencimento!)}${$(l.locacao?.valor ?? 0)}`, valor: (l.locacao?.valor ?? 0) * 3, frota: l.frota, ir: 'receita' });
  for (const l of c.faixas[1].maquinas)
    out.push({ chave: `cv${l.frota}`, tom: 'warn', titulo: `Contrato vence em ${dias(hoje, l.ficha!.contratoVencimento!)} dias · FT${l.frota}`, detalhe: `${l.cliente?.nome ?? ''}${$(l.locacao?.valor ?? 0)}`, valor: (l.locacao?.valor ?? 0) * 2, frota: l.frota, ir: 'receita' });
  const cli = receitaPorCliente(linhas);
  if (cli.maior && cli.maior.parte > LIMITE_CONCENTRACAO)
    out.push({ chave: 'conc', tom: 'warn', titulo: `${Math.round(cli.maior.parte * 100)}% da receita vem de um só cliente`, detalhe: `${cli.maior.nome} · se sair, a receita cai nesse tanto`, valor: cli.maior.total, ir: 'receita' });
  const media = c.locadas ? cli.total / c.locadas : 0;
  for (const p of paradas(linhas, movs, hoje))
    if (p.dias !== null && p.dias > 30)
      out.push({ chave: `pa${p.l.frota}`, tom: p.dias > 90 ? 'bad' : 'warn', titulo: `Parada há ${p.dias} dias · FT${p.l.frota}`, detalhe: `sem cliente desde ${dmy(p.desde!)}${veValores && media ? ` · deixa de faturar ~${reais(media)}/mês` : ''}`, valor: media, frota: p.l.frota, ir: 'frota' });
  for (const r of candidatasVenda(rentabilidade(linhas, gastos, hoje)).slice(0, 5))
    out.push({ chave: `vd${r.l.frota}`, tom: 'warn', titulo: `Vale pensar em vender · FT${r.l.frota}`, detalhe: r.motivos.join(' · '), valor: Math.max(0, -r.resultado) / 12, frota: r.l.frota, ir: 'frota' });
  for (const l of linhas)
    if (l.oficina && dias(l.oficina.desde, hoje) > 15)
      out.push({ chave: `of${l.frota}`, tom: 'warn', titulo: `Na oficina há ${dias(l.oficina.desde, hoje)} dias · FT${l.frota}`, detalhe: `${l.oficina.observacao || 'sem observação'}${l.cliente ? ` · cliente ${l.cliente.nome}` : ''}`, valor: l.locacao?.valor ?? 0, frota: l.frota, ir: 'frota' });
  for (const s of semVisita)
    out.push({ chave: `vi${s.frota}`, tom: 'bad', titulo: `Sem visita há ${s.dias} dias · FT${s.frota}`, detalhe: `${s.cliente} · deveria ser a cada ${s.intervalo}`, valor: 0, frota: s.frota, ir: 'operacao' });
  for (const p of pendencias)
    if (dias(p.abertaEm, hoje) > 30) out.push({ chave: `pe${p.id}`, tom: 'warn', titulo: `Pendência há ${dias(p.abertaEm, hoje)} dias · FT${p.frota}`, detalhe: p.descricao, valor: 0, frota: p.frota, ir: 'operacao' });
  const atrasadas = ordens.filter((o) => OS_ABERTA.has(o.status) && o.agendadaPara && o.agendadaPara.slice(0, 10) < somarDias(hoje, -3));
  if (atrasadas.length) out.push({ chave: 'osat', tom: 'warn', titulo: `${atrasadas.length} OS atrasada${atrasadas.length > 1 ? 's' : ''}`, detalhe: atrasadas.slice(0, 3).map((o) => `nº ${o.numero} FT${o.frota}`).join(' · '), valor: 0, ir: 'operacao' });
  const aCobrar = externos.filter((x) => x.etapa === 'concluido');
  if (aCobrar.length)
    out.push({ chave: 'excob', tom: 'warn', titulo: `${aCobrar.length} serviço${aCobrar.length > 1 ? 's' : ''} externo${aCobrar.length > 1 ? 's' : ''} pronto${aCobrar.length > 1 ? 's' : ''} e sem cobrar`, detalhe: `${aCobrar.map((x) => x.clienteNome).slice(0, 3).join(', ')}${veValores ? ` · ${reais(aCobrar.reduce((s, x) => s + (x.valor ?? 0), 0))}` : ''}`, valor: aCobrar.reduce((s, x) => s + (x.valor ?? 0), 0), ir: 'operacao' });
  for (const e of envios.filter((x) => x.status === 'devolvido' && dias(x.enviadoEm, hoje) <= 30))
    out.push({ chave: `ev${e.id}`, tom: 'bad', titulo: `E-mail de fatura voltou · ${e.clienteNome}`, detalhe: `fatura ${e.numero}${e.devolucao ? ` · ${e.devolucao}` : ''}`, valor: 0, ir: 'operacao' });
  const peso = (a: Alerta) => (a.tom === 'bad' ? 1e12 : 0) + a.valor;
  return out.sort((a, b) => peso(b) - peso(a));
}

const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** "nov/26" */
export const mesCurto = (mes: string) => `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`;
