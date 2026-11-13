import { randomUUID } from 'node:crypto';
import { NaoEncontrado, type Banco, type Cliente, type ClienteInput, type Frota, type Repositorio } from './db.js';

/*
 * Movimentações de frota (nova locação, devolução, troca), propostas de alteração de cadastro,
 * configurações e o registro geral de alterações.
 *
 * Quem é do perfil "operacoes" (Júnior) registra movimentações e propõe alterações; elas ficam
 * PENDENTES até alguém do financeiro aprovar. Só na aprovação o cadastro do cliente muda.
 */

export class Conflito2 extends Error {}

export type TipoMov = 'locacao' | 'devolucao' | 'troca' | 'reajuste' | 'venda' | 'compra';
/** reajuste: uma linha por frota do cliente */
export type ItemReajuste = { frota: string; antes: number; novo: number };
export type DadosMov = {
  data: string; // AAAA-MM-DD
  valor: number | null; // centavos
  frete: '' | 'lucminas' | 'cliente';
  gas: number;
  contrato: string;
  /** término previsto (AAAA-MM-DD) */
  fim?: string | null;
  prazoPagamento: string;
  emails: string[];
  contatoNome: string;
  contatoTelefone: string;
  descricao: string;
  observacoes: string;
  /** reajuste: frotas e valores (antes → novo) */
  itens?: ItemReajuste[];
  /** reajuste: percentual usado, se foi aplicado igual a todas (ex.: 4.8) */
  percentual?: number | null;
  /** reajuste: novo vencimento do contrato (renovação), se houver */
  renovaAte?: string | null;
  /** valor que a frota tinha no cliente antes de aplicar (devolução, troca e venda de máquina locada) */
  valorAnterior?: number | null;
  /** frete por conta do cliente: quanto (centavos) */
  freteValor?: number | null;
  /** observação marcada como urgente (balãozinho vermelho até alguém dar ok) */
  obsUrgente?: boolean;
  /** locação: por contrato ou esporádica */
  modalidade?: '' | 'contrato' | 'esporadico';
  /** venda e compra: nota fiscal */
  nf?: string;
  /** observações acrescentadas depois de lançada (cada uma pode ser urgente) */
  notas?: NotaMov[];
  /** venda e compra: arquivo da NF-e (PDF/DANFE ou XML), guardado em <pastaDados>/nfe/<id da movimentação>.<ext> */
  nfArquivo?: NfArquivo | null;
  /** compra: identificação da máquina que entra na frota */
  maquina?: { marca: string; modelo: string; serie: string; ano: number | null; capacidade: number | null; combustivel: string };
};
export type NotaMov = { id: string; texto: string; urgente: boolean; em: string; porNome: string };
export type NfArquivo = { ext: 'pdf' | 'xml'; nome: string; tamanho: number; em: string; porNome: string };
export type NovaMov = { tipo: TipoMov; frota: string; frotaNova?: string; clienteId?: string | null; clienteNome?: string } & DadosMov;

export type Movimentacao = {
  id: string;
  tipo: TipoMov;
  frota: string;
  frotaNova: string | null;
  clienteId: string | null;
  clienteNome: string;
  dados: DadosMov;
  status: 'pendente' | 'aprovada' | 'rejeitada';
  criadaEm: string;
  criadaPorNome: string;
  decididaEm: string | null;
  decididaPorNome: string | null;
  motivo: string;
  /** este usuário já viu (para as "novas movimentações") */
  vista: boolean;
};

/** Máquina na oficina; clienteAnterior: com quem estava quando entrou (ela sai do cliente) */
export type FrotaOficina = { frota: string; desde: string; observacao: string; usuario: string; clienteAnteriorId: string | null; clienteAnterior: string };

export type Proposta = {
  id: string;
  clienteId: string | null;
  dados: ClienteInput;
  status: 'pendente' | 'aprovada' | 'rejeitada';
  criadaEm: string;
  criadaPor: number;
  criadaPorNome: string;
  decididaEm: string | null;
  decididaPorNome: string | null;
  motivo: string;
  /** cadastro atual, para mostrar o "antes" */
  atual: Cliente | null;
  /** como o cadastro fica se aprovar agora (só os campos que a pessoa mudou são aplicados) */
  resultado: ClienteInput;
};

export type Conferencia = {
  referencia: string;
  clienteId: string;
  frota: string;
  status: 'ok' | 'alterado';
  /** valor e descrição no momento em que foi conferido (se mudar depois, volta a ficar pendente) */
  valor: number;
  descricao: string;
  observacao: string;
  quando: string;
  usuario: string;
};

export type ItemLog = {
  id: number;
  quando: string;
  usuario: string;
  area: string;
  acao: string;
  clienteId: string;
  clienteNome: string;
  antes: unknown;
  depois: unknown;
};

export const CONFIG_PADRAO: Record<string, string> = {
  'email.remetente': 'Financeiro · Lucminas Empilhadeiras',
  'email.assunto': 'Fatura de locação nº {numero} · Lucminas Empilhadeiras',
  'email.corpo':
    'Prezados,\n\nSegue em anexo a fatura de locação nº {numero}, referente a {mes}, e o boleto para pagamento.\n\nEm caso de dúvida, é só responder este e-mail.\n\nAtenciosamente,\nFinanceiro · Lucminas Empilhadeiras',
  // quando a fatura vai sem boleto (cliente paga por PIX, depósito…)
  'email.corpoSemBoleto':
    'Prezados,\n\nSegue em anexo a fatura de locação nº {numero}, referente a {mes}.\n\nEm caso de dúvida, é só responder este e-mail.\n\nAtenciosamente,\nFinanceiro · Lucminas Empilhadeiras',
  // regras da manutenção (painel): tipos de visita e periféricos, editáveis em Configurações
  'manutencao.tipos': JSON.stringify([
    { sigla: 'CF', nome: 'Conferência', dias: 30 },
    { sigla: 'CR', nome: 'Corretiva (cliente chama)' },
    { sigla: 'B', nome: 'Preventiva B', horas: 350 },
    { sigla: 'C', nome: 'Preventiva C', horas: 500 },
    { sigla: 'D', nome: 'Preventiva D', horas: 1000 },
  ]),
  // relatório da OS por e-mail ao cliente: desligado até a empresa decidir ligar (Configurações)
  'os.relatorioCliente': 'nao',
  // conferência das frotas: abre no dia X do mês e fica aberta até o dia Y do mês seguinte
  'conferencia.abreDia': '25',
  'conferencia.fechaDia': '5',
  // checklist da entrega (quando a máquina sai da empresa): um item por linha
  'entrega.checklist': [
    'Garfos e correntes do mastro',
    'Pneus',
    'Mangueiras sem vazamento',
    'Freio e freio de mão',
    'Direção',
    'Buzina, luzes e sinal de ré',
    'Cinto de segurança',
    'Extintor',
    'Gás / bateria carregada',
    'Painel e horímetro funcionando',
    'Lataria e pintura',
    'Limpeza',
  ].join('\n'),
  'manutencao.perifericos': JSON.stringify([
    { id: 'motorPartida', nome: 'Motor de partida', dias: 120 },
    { id: 'filtroAr', nome: 'Filtro de ar', dias: 90 },
    { id: 'correia', nome: 'Correia dentada', horas: 2000 },
    { id: 'oleoTransmissao', nome: 'Óleo de transmissão', horas: 3000 },
    { id: 'oleoHidraulico', nome: 'Óleo hidráulico', horas: 2000 },
  ]),
};

const agora = () => new Date().toISOString();
const NOMES_TIPO: Record<TipoMov, string> = { locacao: 'Nova locação', devolucao: 'Devolução', troca: 'Troca de frota', reajuste: 'Reajuste', venda: 'Venda', compra: 'Compra' };
const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const CAMPOS_CLIENTE = ['nome', 'apelidos', 'cnpj', 'para', 'cc', 'observacoes', 'diaEmissao', 'regra', 'inicioLocacao', 'periodoDias', 'contato', 'telefone', 'prazoPagamento', 'semBoleto'] as const;
const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Aplica sobre o cadastro ATUAL só o que a pessoa mudou em relação ao cadastro que ela viu (base).
 * Assim, uma proposta antiga não desfaz o que aconteceu depois (ex.: uma frota que foi para outro cliente).
 * Frotas são comparadas uma a uma pelo número.
 */
export function mesclarProposta(atual: Cliente, base: Cliente | null, dados: ClienteInput): ClienteInput {
  if (!base) return { ...dados, id: atual.id };
  const r: Record<string, unknown> = { id: atual.id };
  for (const k of CAMPOS_CLIENTE) r[k] = igual((dados as Record<string, unknown>)[k], (base as Record<string, unknown>)[k]) ? atual[k] : (dados as Record<string, unknown>)[k];
  const porNum = (l: Frota[] | undefined) => new Map((l ?? []).map((f) => [f.numero, f]));
  const b = porNum(base.frotas);
  const d = porNum(dados.frotas);
  let frotas = atual.frotas.filter((f) => !(b.has(f.numero) && !d.has(f.numero))); // removidas pela pessoa
  frotas = frotas.map((f) => (d.has(f.numero) && b.has(f.numero) && !igual(d.get(f.numero), b.get(f.numero)) ? d.get(f.numero)! : f)); // alteradas
  for (const f of dados.frotas ?? []) if (!b.has(f.numero) && !frotas.some((x) => x.numero === f.numero)) frotas.push(f); // novas
  r.frotas = frotas;
  return r as ClienteInput;
}

/** Acesso à ficha da máquina: as movimentações mantêm o contrato, a venda e a compra da ficha em dia. */
export type ValorFicha = string | number | null;
export type Fichas = {
  buscar(frota: string): Record<string, ValorFicha> | null;
  /** grava só os campos informados; null apaga o campo */
  salvar(frota: string, d: Record<string, ValorFicha>, usuarioId: number): void;
};
const CONTRATO_VAZIO = { contratoNumero: null, contratoInicio: null, contratoAssinado: null, contratoAssinadoEm: null, contratoArquivo: null, contratoValor: null, contratoReajuste: null, contratoVencimento: null, contratoObs: null };
const CAMPOS_CONTRATO = Object.keys(CONTRATO_VAZIO);

export function operacoes(db: Banco, repo: Repositorio, fichas?: Fichas) {
  const nomeUsuario = (id: number | null) => (id ? ((db.prepare('SELECT nome FROM usuarios WHERE id = ?').get(id) as { nome: string } | undefined)?.nome ?? '') : '');

  const deLinhaMov = (r: Record<string, unknown>): Movimentacao => ({
    id: r.id as string,
    tipo: r.tipo as TipoMov,
    frota: r.frota as string,
    frotaNova: (r.frota_nova as string) ?? null,
    clienteId: (r.cliente_id as string) ?? null,
    clienteNome: (r.cliente_atual as string) || (r.cliente_nome as string),
    dados: JSON.parse(r.dados as string),
    status: r.status as Movimentacao['status'],
    criadaEm: r.criada_em as string,
    criadaPorNome: (r.criada_por_nome as string) ?? '',
    decididaEm: (r.decidida_em as string) ?? null,
    decididaPorNome: (r.decidida_por_nome as string) ?? null,
    motivo: r.motivo as string,
    vista: r.vista === undefined ? true : !!r.vista,
  });

  const SELECT_MOV = `SELECT m.*, c.nome AS cliente_atual, cu.nome AS criada_por_nome, du.nome AS decidida_por_nome
     FROM movimentacoes m LEFT JOIN clientes c ON c.id = m.cliente_id
     LEFT JOIN usuarios cu ON cu.id = m.criada_por LEFT JOIN usuarios du ON du.id = m.decidida_por`;

  const buscarMov = (id: string): Movimentacao => {
    const r = db.prepare(`${SELECT_MOV} WHERE m.id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!r) throw new NaoEncontrado('Movimentação não encontrada.');
    return deLinhaMov(r);
  };

  /** Cliente que está com a frota agora (ignora o informado em "exceto"). */
  const donoDaFrota = (numero: string, exceto?: string): Cliente | undefined =>
    repo.listarClientes().find((c) => c.id !== exceto && c.frotas.some((f) => f.numero === numero));

  const tirarFrota = (c: Cliente, numero: string, usuarioId: number, motivo: string) =>
    repo.salvarCliente({ ...c, frotas: c.frotas.filter((f) => f.numero !== numero) }, usuarioId, `frota ${numero} saiu (${motivo})`);

  /** Aplica a movimentação no cadastro. Devolve o id do cliente afetado. */
  function aplicar(m: { tipo: TipoMov; frota: string; frotaNova: string | null; clienteId: string | null; clienteNome: string; dados: DadosMov }, usuarioId: number): string | null {
    const d = m.dados;
    const titulo = `${NOMES_TIPO[m.tipo]} ${m.frota}${m.frotaNova ? ` → ${m.frotaNova}` : ''}`;

    const ficha = (frota: string) => fichas?.buscar(frota) ?? null;
    const gravarFicha = (frota: string, dados: Record<string, ValorFicha>) => fichas?.salvar(frota, dados, usuarioId);
    const quando = d.data.split('-').reverse().join('/');

    if (m.tipo === 'venda') {
      const f = ficha(m.frota);
      if (f?.situacao === 'baixada') throw new Conflito2(`A FT${m.frota} já está como vendida/baixada.`);
      // se estava locada, sai do cliente
      const dono = donoDaFrota(m.frota);
      d.valorAnterior = dono?.frotas.find((x) => x.numero === m.frota)?.valor ?? null;
      if (dono) tirarFrota(dono, m.frota, usuarioId, `vendida em ${quando}`);
      db.prepare('DELETE FROM oficina WHERE frota = ?').run(m.frota);
      const comprador = m.clienteId ? repo.buscarCliente(m.clienteId).nome : m.clienteNome;
      gravarFicha(m.frota, {
        ...CONTRATO_VAZIO,
        situacao: 'baixada',
        situacaoMotivo: `Vendida${comprador ? ` para ${comprador}` : ''} em ${quando}`,
        vendaData: d.data,
        vendaValor: d.valor,
        vendaComprador: comprador || null,
        vendaNf: d.nf || null,
      });
      return m.clienteId ?? null;
    }

    if (m.tipo === 'compra') {
      const f = ficha(m.frota);
      if (f && f.situacao !== 'baixada' && Object.keys(f).some((k) => !['frota', 'atualizadoEm', 'atualizadoPor'].includes(k)))
        throw new Conflito2(`A FT${m.frota} já está cadastrada. Use outro número de frota.`);
      if (donoDaFrota(m.frota)) throw new Conflito2(`A FT${m.frota} está locada para um cliente. Use outro número de frota.`);
      const q = d.maquina;
      gravarFicha(m.frota, {
        situacao: null,
        situacaoMotivo: null,
        vendaData: null,
        vendaValor: null,
        vendaComprador: null,
        vendaNf: null,
        descricao: d.descricao || null,
        ...(q ? { marca: q.marca || null, modelo: q.modelo || null, serie: q.serie || null, ano: q.ano, capacidade: q.capacidade, combustivel: q.combustivel || null } : {}),
        compraData: d.data,
        compraValor: d.valor,
        compraNf: d.nf || null,
        fornecedor: m.clienteNome || null,
      });
      return null;
    }

    if (m.tipo === 'locacao') {
      if (ficha(m.frota)?.situacao === 'baixada') throw new Conflito2(`A FT${m.frota} está como vendida/baixada. Não dá para locar.`);
      let cliente: Cliente | undefined = m.clienteId ? repo.buscarCliente(m.clienteId) : undefined;
      if (!cliente) {
        const nome = m.clienteNome.trim().toUpperCase().replace(/\s+/g, ' ');
        if (!nome) throw new Conflito2('Informe o cliente.');
        cliente = repo.listarClientes().find((c) => c.nome === nome) ?? repo.salvarCliente({ nome, apelidos: [], cnpj: '', para: [], cc: [], observacoes: '' }, usuarioId, `criou pela ${titulo}`);
      }
      const anterior = donoDaFrota(m.frota, cliente.id);
      if (anterior) tirarFrota(anterior, m.frota, usuarioId, `foi para ${cliente.nome}`);
      const nova: Frota = {
        numero: m.frota,
        valor: d.valor ?? 0,
        descricao: d.descricao,
        inicio: d.data,
        fim: d.fim ?? null,
        contrato: d.contrato,
        gas: d.gas,
        frete: d.frete,
        ...(d.frete === 'cliente' && d.freteValor ? { freteValor: d.freteValor } : {}),
        ...(d.modalidade ? { modalidade: d.modalidade } : {}),
      };
      const atual = repo.buscarCliente(cliente.id);
      const jaTem = new Set([...atual.para, ...atual.cc]);
      repo.salvarCliente(
        {
          ...atual,
          frotas: [...atual.frotas.filter((f) => f.numero !== m.frota), nova],
          para: [...atual.para, ...d.emails.filter((e) => !jaTem.has(e))],
          contato: d.contatoNome || atual.contato,
          telefone: d.contatoTelefone || atual.telefone,
          prazoPagamento: d.prazoPagamento || atual.prazoPagamento,
        },
        usuarioId,
        titulo,
      );
      // ficha: contrato novo (o que não veio na mensagem fica em branco, para não sobrar dado do contrato anterior)
      const f = ficha(m.frota);
      if (f) gravarFicha(m.frota, { ...CONTRATO_VAZIO, contratoValor: d.valor, contratoVencimento: d.fim ?? null, ...(f.situacao === 'reservada' ? { situacao: null, situacaoMotivo: null } : {}) });
      return cliente.id;
    }

    if (m.tipo === 'reajuste') {
      if (!m.clienteId) throw new Conflito2('Informe o cliente.');
      const atual = repo.buscarCliente(m.clienteId);
      const itens = d.itens ?? [];
      const fora = itens.filter((i) => !atual.frotas.some((f) => f.numero === i.frota));
      if (fora.length) throw new Conflito2(`FT${fora.map((i) => i.frota).join(', FT')} não ${fora.length > 1 ? 'estão' : 'está'} mais em ${atual.nome}.`);
      // guarda o valor de agora (pode ter mudado desde o registro)
      d.itens = itens.map((i) => ({ ...i, antes: atual.frotas.find((f) => f.numero === i.frota)!.valor }));
      repo.salvarCliente(
        {
          ...atual,
          frotas: atual.frotas.map((f) => {
            const i = itens.find((x) => x.frota === f.numero);
            return i ? { ...f, valor: i.novo, ...(d.renovaAte ? { fim: d.renovaAte } : {}) } : f;
          }),
        },
        usuarioId,
        `reajuste a partir de ${d.data.split('-').reverse().join('/')}: ${itens.map((i) => `FT${i.frota} ${brl(i.novo)}`).join(', ')}`,
      );
      for (const i of itens) {
        const f = fichas?.buscar(i.frota);
        if (!f) continue;
        fichas!.salvar(
          i.frota,
          { contratoValor: i.novo, ...(d.renovaAte ? { contratoVencimento: d.renovaAte } : {}), ...(f.contratoReajuste === i.novo ? { contratoReajuste: null } : {}) },
          usuarioId,
        );
      }
      return atual.id;
    }

    const cliente = m.clienteId ? repo.buscarCliente(m.clienteId) : donoDaFrota(m.frota);
    if (!cliente || !cliente.frotas.some((f) => f.numero === m.frota)) throw new Conflito2(`A frota ${m.frota} não está em nenhum cliente${m.clienteId ? ' informado' : ''}.`);
    d.valorAnterior = cliente.frotas.find((f) => f.numero === m.frota)?.valor ?? null;

    if (m.tipo === 'devolucao') {
      tirarFrota(cliente, m.frota, usuarioId, `devolução em ${quando}`);
      if (ficha(m.frota)) gravarFicha(m.frota, CONTRATO_VAZIO);
      return cliente.id;
    }

    // troca: a frota nova assume o lugar da antiga, mantendo os dados da locação
    if (!m.frotaNova) throw new Conflito2('Informe a frota nova.');
    const outro = donoDaFrota(m.frotaNova, cliente.id);
    if (outro) tirarFrota(outro, m.frotaNova, usuarioId, `foi para ${cliente.nome}`);
    const atual = repo.buscarCliente(cliente.id);
    repo.salvarCliente(
      {
        ...atual,
        frotas: atual.frotas.map((f) => (f.numero === m.frota ? { ...f, numero: m.frotaNova!, valor: d.valor ?? f.valor, descricao: d.descricao || f.descricao } : f)),
      },
      usuarioId,
      titulo,
    );
    // ficha: o contrato passa da frota que saiu para a que entrou
    const velha = ficha(m.frota);
    const contrato: Record<string, ValorFicha> = Object.fromEntries(CAMPOS_CONTRATO.map((k) => [k, velha?.[k] ?? null]));
    if (d.valor != null) contrato.contratoValor = d.valor;
    if (velha || d.valor != null) gravarFicha(m.frotaNova, contrato);
    if (velha) gravarFicha(m.frota, CONTRATO_VAZIO);
    return cliente.id;
  }

  return {
    // ---------- movimentações ----------
    /** com usuarioId: diz se ele já viu cada uma ("novas" = não vistas) */
    listarMovimentacoes(usuarioId?: number): Movimentacao[] {
      if (usuarioId === undefined) return (db.prepare(`${SELECT_MOV} ORDER BY m.criada_em DESC`).all() as Record<string, unknown>[]).map(deLinhaMov);
      const vistas = new Set((db.prepare('SELECT movimentacao_id FROM movimentacoes_vistas WHERE usuario_id = ?').all(usuarioId) as { movimentacao_id: string }[]).map((x) => x.movimentacao_id));
      return (db.prepare(`${SELECT_MOV} ORDER BY m.criada_em DESC`).all() as Record<string, unknown>[]).map((r) => ({ ...deLinhaMov(r), vista: vistas.has(r.id as string) }));
    },
    /** marca como vistas (sem ids: todas) */
    marcarVistas(usuarioId: number, ids?: string[]) {
      const ins = db.prepare('INSERT OR IGNORE INTO movimentacoes_vistas (usuario_id, movimentacao_id, visto_em) VALUES (?, ?, ?)');
      const lista = ids ?? (db.prepare('SELECT id FROM movimentacoes').all() as { id: string }[]).map((x) => x.id);
      const t = agora();
      db.transaction(() => {
        for (const id of lista) if (db.prepare('SELECT 1 FROM movimentacoes WHERE id = ?').get(id)) ins.run(usuarioId, id, t);
      })();
      return { ok: true };
    },

    registrarMovimentacao(n: NovaMov, usuarioId: number, aprovarJa: boolean): Movimentacao {
      return db.transaction(() => {
        const id = randomUUID();
        const t = agora();
        const clienteNome = n.clienteId ? repo.buscarCliente(n.clienteId).nome : (n.clienteNome ?? '').trim().toUpperCase();
        const dados: DadosMov = {
          data: n.data,
          valor: n.valor,
          frete: n.frete,
          gas: n.gas,
          contrato: n.contrato,
          fim: n.fim ?? null,
          prazoPagamento: n.prazoPagamento,
          emails: n.emails,
          contatoNome: n.contatoNome,
          contatoTelefone: n.contatoTelefone,
          descricao: n.descricao,
          observacoes: n.observacoes,
          ...(n.tipo === 'reajuste' ? { itens: n.itens ?? [], percentual: n.percentual ?? null, renovaAte: n.renovaAte ?? null } : {}),
          ...(n.tipo === 'venda' || n.tipo === 'compra' ? { nf: n.nf ?? '' } : {}),
          ...(n.tipo === 'locacao' && n.modalidade ? { modalidade: n.modalidade } : {}),
          ...(n.frete === 'cliente' && n.freteValor ? { freteValor: n.freteValor } : {}),
          ...(n.obsUrgente && n.observacoes ? { obsUrgente: true } : {}),
          ...(n.tipo === 'compra' && n.maquina ? { maquina: n.maquina } : {}),
        };
        let clienteId = n.clienteId ?? null;
        if (aprovarJa) clienteId = aplicar({ tipo: n.tipo, frota: n.frota, frotaNova: n.frotaNova ?? null, clienteId, clienteNome, dados }, usuarioId);
        db.prepare(
          `INSERT INTO movimentacoes (id, tipo, frota, frota_nova, cliente_id, cliente_nome, dados, status, criada_em, criada_por, decidida_em, decidida_por)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, n.tipo, n.frota, n.frotaNova ?? null, clienteId, clienteNome, JSON.stringify(dados), aprovarJa ? 'aprovada' : 'pendente', t, usuarioId, aprovarJa ? t : null, aprovarJa ? usuarioId : null);
        // quem registrou já viu
        db.prepare('INSERT OR IGNORE INTO movimentacoes_vistas (usuario_id, movimentacao_id, visto_em) VALUES (?, ?, ?)').run(usuarioId, id, t);
        const resumo =
          n.tipo === 'reajuste'
            ? `reajuste de ${clienteNome} (${(dados.itens ?? []).map((i) => `FT${i.frota} ${brl(i.antes)} → ${brl(i.novo)}`).join(', ')})`
            : `${NOMES_TIPO[n.tipo]} ${n.frota}${n.frotaNova ? ` → ${n.frotaNova}` : ''}${n.valor ? ` · ${brl(n.valor)}` : ''}`;
        repo.registrarLog(clienteId ?? '', usuarioId, aprovarJa ? `registrou ${resumo}` : `registrou ${resumo} (aguardando aprovação)`, null, dados, 'movimentacao');
        return buscarMov(id);
      })();
    },

    /** mais uma observação numa movimentação já lançada (pode ser urgente: balãozinho até alguém dar ok) */
    adicionarNota(id: string, texto: string, urgente: boolean, usuarioId: number, porNome: string): Movimentacao {
      return db.transaction(() => {
        const m = buscarMov(id);
        const nota: NotaMov = { id: randomUUID().slice(0, 8), texto, urgente, em: agora(), porNome };
        const dados: DadosMov = { ...m.dados, notas: [...(m.dados.notas ?? []), nota] };
        db.prepare('UPDATE movimentacoes SET dados = ? WHERE id = ?').run(JSON.stringify(dados), id);
        repo.registrarLog(m.clienteId ?? '', usuarioId, `${urgente ? 'observação URGENTE' : 'observação'} na ${NOMES_TIPO[m.tipo]} ${m.frota}: ${texto}`, null, null, 'movimentacao');
        return buscarMov(id);
      })();
    },

    /** venda/compra: guarda (ou tira, com null) a referência ao arquivo da NF-e */
    anexarNf(id: string, arquivo: NfArquivo | null, usuarioId: number): Movimentacao {
      const m = buscarMov(id);
      if (m.tipo !== 'venda' && m.tipo !== 'compra') throw new Conflito2('A NF-e só pode ser anexada em compra ou venda.');
      if (m.status === 'rejeitada') throw new Conflito2('Essa movimentação foi recusada.');
      const dados: DadosMov = { ...m.dados, nfArquivo: arquivo };
      db.prepare('UPDATE movimentacoes SET dados = ? WHERE id = ?').run(JSON.stringify(dados), id);
      repo.registrarLog(m.clienteId ?? '', usuarioId, `${arquivo ? 'anexou' : 'tirou'} a NF-e da ${NOMES_TIPO[m.tipo]} ${m.frota}${arquivo ? ` (${arquivo.nome})` : ''}`, null, null, 'movimentacao');
      return buscarMov(id);
    },

    decidirMovimentacao(id: string, usuarioId: number, aprovar: boolean, motivo = ''): Movimentacao {
      return db.transaction(() => {
        const m = buscarMov(id);
        if (m.status !== 'pendente') throw new Conflito2('Essa movimentação já foi decidida.');
        // quem decide já viu
        db.prepare('INSERT OR IGNORE INTO movimentacoes_vistas (usuario_id, movimentacao_id, visto_em) VALUES (?, ?, ?)').run(usuarioId, id, agora());
        let clienteId = m.clienteId;
        if (aprovar) clienteId = aplicar(m, usuarioId);
        db.prepare('UPDATE movimentacoes SET status = ?, decidida_em = ?, decidida_por = ?, motivo = ?, cliente_id = ?, dados = ? WHERE id = ?').run(
          aprovar ? 'aprovada' : 'rejeitada',
          agora(),
          usuarioId,
          motivo,
          clienteId,
          JSON.stringify(m.dados),
          id,
        );
        repo.registrarLog(clienteId ?? '', usuarioId, `${aprovar ? 'aprovou' : 'recusou'} ${NOMES_TIPO[m.tipo]} ${m.frota} (de ${m.criadaPorNome})${motivo ? `: ${motivo}` : ''}`, null, null, 'movimentacao');
        return buscarMov(id);
      })();
    },

    // ---------- propostas de alteração de cadastro ----------
    listarPropostas(somenteDe?: number): Proposta[] {
      const linhas = db
        .prepare(
          `SELECT p.*, cu.nome AS criada_por_nome, du.nome AS decidida_por_nome FROM propostas p
           LEFT JOIN usuarios cu ON cu.id = p.criada_por LEFT JOIN usuarios du ON du.id = p.decidida_por
           ${somenteDe ? 'WHERE p.criada_por = ?' : ''} ORDER BY p.criada_em DESC`,
        )
        .all(...(somenteDe ? [somenteDe] : [])) as Record<string, unknown>[];
      return linhas.map((r) => {
        let atual: Cliente | null = null;
        try {
          atual = r.cliente_id ? repo.buscarCliente(r.cliente_id as string) : null;
        } catch {
          atual = null;
        }
        const dados = JSON.parse(r.dados as string) as ClienteInput;
        const base = r.base ? (JSON.parse(r.base as string) as Cliente) : null;
        return {
          id: r.id as string,
          clienteId: (r.cliente_id as string) ?? null,
          dados,
          status: r.status as Proposta['status'],
          criadaEm: r.criada_em as string,
          criadaPor: r.criada_por as number,
          criadaPorNome: (r.criada_por_nome as string) ?? '',
          decididaEm: (r.decidida_em as string) ?? null,
          decididaPorNome: (r.decidida_por_nome as string) ?? null,
          motivo: r.motivo as string,
          atual,
          resultado: atual ? mesclarProposta(atual, base, dados) : dados,
        };
      });
    },

    proporAlteracao(dados: ClienteInput, usuarioId: number): string {
      const base = dados.id ? repo.buscarCliente(dados.id) : null;
      const id = randomUUID();
      db.prepare('INSERT INTO propostas (id, cliente_id, dados, base, status, criada_em, criada_por) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        id,
        dados.id ?? null,
        JSON.stringify(dados),
        base ? JSON.stringify(base) : null,
        'pendente',
        agora(),
        usuarioId,
      );
      repo.registrarLog(dados.id ?? '', usuarioId, `propôs ${dados.id ? 'alteração' : 'novo cliente'}: ${dados.nome} (aguardando aprovação)`, null, dados, 'proposta');
      return id;
    },

    decidirProposta(id: string, usuarioId: number, aprovar: boolean, motivo = '') {
      return db.transaction(() => {
        const p = this.listarPropostas().find((x) => x.id === id);
        if (!p) throw new NaoEncontrado('Proposta não encontrada.');
        if (p.status !== 'pendente') throw new Conflito2('Essa proposta já foi decidida.');
        if (aprovar) repo.salvarCliente(p.resultado, usuarioId, `aprovou alteração proposta por ${p.criadaPorNome}`);
        else repo.registrarLog(p.clienteId ?? '', usuarioId, `recusou alteração proposta por ${p.criadaPorNome}${motivo ? `: ${motivo}` : ''}`, null, null, 'proposta');
        db.prepare('UPDATE propostas SET status = ?, decidida_em = ?, decidida_por = ?, motivo = ? WHERE id = ?').run(aprovar ? 'aprovada' : 'rejeitada', agora(), usuarioId, motivo, id);
      })();
    },

    // ---------- configurações ----------
    lerConfig(): Record<string, string> {
      const salvas = Object.fromEntries((db.prepare('SELECT chave, valor FROM configuracoes').all() as { chave: string; valor: string }[]).map((r) => [r.chave, r.valor]));
      return { ...CONFIG_PADRAO, ...salvas };
    },
    salvarConfig(valores: Record<string, string>, usuarioId: number) {
      const antes = this.lerConfig();
      const st = db.prepare(
        `INSERT INTO configuracoes (chave, valor, atualizado_em, atualizado_por) VALUES (?, ?, ?, ?)
         ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por`,
      );
      const mudou: Record<string, string> = {};
      for (const [k, v] of Object.entries(valores)) {
        if (!(k in CONFIG_PADRAO) || antes[k] === v) continue;
        st.run(k, v, agora(), usuarioId);
        mudou[k] = v;
      }
      if (Object.keys(mudou).length)
        repo.registrarLog('', usuarioId, 'alterou o modelo do e-mail das faturas', Object.fromEntries(Object.keys(mudou).map((k) => [k, antes[k]])), mudou, 'configuracao');
      return this.lerConfig();
    },

    // ---------- registro geral ----------
    // ---------- conferência mensal ----------
    listarConferencia(referencia: string): Conferencia[] {
      return (
        db
          .prepare(
            `SELECT k.*, COALESCE(u.nome, '') AS usuario FROM conferencias k LEFT JOIN usuarios u ON u.id = k.usuario_id WHERE k.referencia = ? ORDER BY k.quando`,
          )
          .all(referencia) as Record<string, unknown>[]
      ).map((r) => ({
        referencia: r.referencia as string,
        clienteId: r.cliente_id as string,
        frota: r.frota as string,
        status: r.status as Conferencia['status'],
        valor: r.valor as number,
        descricao: r.descricao as string,
        observacao: r.observacao as string,
        quando: r.quando as string,
        usuario: r.usuario as string,
      }));
    },

    marcarConferencia(c: { referencia: string; clienteId: string; frota: string; status: Conferencia['status']; observacao: string }, usuarioId: number) {
      const cli = repo.buscarCliente(c.clienteId);
      const f = cli.frotas.find((x) => x.numero === c.frota);
      if (!f) throw new NaoEncontrado(`A frota ${c.frota} não está em ${cli.nome}.`);
      db.prepare(
        `INSERT INTO conferencias (referencia, cliente_id, frota, status, valor, descricao, observacao, quando, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (referencia, cliente_id, frota) DO UPDATE SET status = excluded.status, valor = excluded.valor, descricao = excluded.descricao,
           observacao = excluded.observacao, quando = excluded.quando, usuario_id = excluded.usuario_id`,
      ).run(c.referencia, c.clienteId, c.frota, c.status, f.valor, f.descricao, c.observacao, agora(), usuarioId);
      const [a, m] = c.referencia.split('-');
      repo.registrarLog(
        c.clienteId,
        usuarioId,
        c.status === 'ok' ? `conferiu FT${c.frota} (${brl(f.valor)}) como correta em ${m}/${a}` : `apontou correção na FT${c.frota} na conferência de ${m}/${a}${c.observacao ? `: ${c.observacao}` : ''}`,
        null,
        null,
        'conferencia',
      );
      return this.listarConferencia(c.referencia).find((x) => x.clienteId === c.clienteId && x.frota === c.frota)!;
    },

    desmarcarConferencia(referencia: string, clienteId: string, frota: string, usuarioId: number) {
      const r = db.prepare('DELETE FROM conferencias WHERE referencia = ? AND cliente_id = ? AND frota = ?').run(referencia, clienteId, frota);
      if (r.changes) repo.registrarLog(clienteId, usuarioId, `desmarcou a conferência da FT${frota} (${referencia.split('-').reverse().join('/')})`, null, null, 'conferencia');
    },

    // ---------- oficina ----------
    listarOficina(): FrotaOficina[] {
      return (
        db
          .prepare("SELECT o.frota, o.desde, o.observacao, o.cliente_id, o.cliente_nome, COALESCE(u.nome, '') AS usuario FROM oficina o LEFT JOIN usuarios u ON u.id = o.usuario_id ORDER BY o.desde")
          .all() as { frota: string; desde: string; observacao: string; usuario: string; cliente_id: string | null; cliente_nome: string }[]
      ).map((r) => ({ frota: r.frota, desde: r.desde, observacao: r.observacao, usuario: r.usuario, clienteAnteriorId: r.cliente_id, clienteAnterior: r.cliente_nome }));
    },
    /**
     * Máquina na oficina fica sem locação: se estava com um cliente, sai dele na hora (registra uma
     * devolução já aplicada, que limpa o contrato da ficha e aparece nas "novas movimentações").
     * Guarda de quem era, para a volta virar uma nova locação para o mesmo cliente.
     */
    colocarNaOficina(frota: string, observacao: string, usuarioId: number): { devolucao: Movimentacao | null } {
      return db.transaction(() => {
        const dono = repo.listarClientes().find((c) => c.frotas.some((f) => f.numero === frota));
        const ja = db.prepare('SELECT cliente_id, cliente_nome FROM oficina WHERE frota = ?').get(frota) as { cliente_id: string | null; cliente_nome: string } | undefined;
        db.prepare(
          `INSERT INTO oficina (frota, desde, observacao, usuario_id, cliente_id, cliente_nome) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (frota) DO UPDATE SET observacao = excluded.observacao, cliente_id = excluded.cliente_id, cliente_nome = excluded.cliente_nome`,
        ).run(frota, agora(), observacao, usuarioId, dono?.id ?? ja?.cliente_id ?? null, dono?.nome ?? ja?.cliente_nome ?? '');
        repo.registrarLog(dono?.id ?? '', usuarioId, `colocou a FT${frota} na oficina${observacao ? `: ${observacao}` : ''}${dono ? ` (saiu de ${dono.nome})` : ''}`, null, null, 'oficina');
        if (!dono) return { devolucao: null };
        const hoje = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
        const devolucao = this.registrarMovimentacao(
          {
            tipo: 'devolucao',
            frota,
            clienteId: dono.id,
            data: hoje,
            valor: null,
            frete: '',
            gas: 0,
            contrato: '',
            prazoPagamento: '',
            emails: [],
            contatoNome: '',
            contatoTelefone: '',
            descricao: '',
            observacoes: `Foi para a oficina${observacao ? `: ${observacao}` : ''}`,
          },
          usuarioId,
          true,
        );
        return { devolucao };
      })();
    },
    tirarDaOficina(frota: string, usuarioId: number) {
      const r = db.prepare('DELETE FROM oficina WHERE frota = ?').run(frota);
      if (!r.changes) throw new NaoEncontrado(`A FT${frota} não está na oficina.`);
      const dono = repo.listarClientes().find((c) => c.frotas.some((f) => f.numero === frota));
      repo.registrarLog(dono?.id ?? '', usuarioId, `tirou a FT${frota} da oficina`, null, null, 'oficina');
    },

    listarLog(limite = 500): ItemLog[] {
      return (
        db
          .prepare(
            `SELECT h.id, h.quando, h.area, h.acao, h.cliente_id, h.antes, h.depois, COALESCE(u.nome, '') AS usuario, COALESCE(c.nome, '') AS cliente_nome
             FROM historico_clientes h LEFT JOIN usuarios u ON u.id = h.usuario_id LEFT JOIN clientes c ON c.id = h.cliente_id
             ORDER BY h.id DESC LIMIT ?`,
          )
          .all(limite) as Record<string, unknown>[]
      ).map((r) => ({
        id: r.id as number,
        quando: r.quando as string,
        usuario: r.usuario as string,
        area: r.area as string,
        acao: r.acao as string,
        clienteId: r.cliente_id as string,
        clienteNome: r.cliente_nome as string,
        antes: r.antes ? JSON.parse(r.antes as string) : null,
        depois: r.depois ? JSON.parse(r.depois as string) : null,
      }));
    },
  };
}
