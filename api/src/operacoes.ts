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

export type TipoMov = 'locacao' | 'devolucao' | 'troca';
export type DadosMov = {
  data: string; // AAAA-MM-DD
  valor: number | null; // centavos
  frete: '' | 'lucminas' | 'cliente';
  gas: number;
  contrato: string;
  prazoPagamento: string;
  emails: string[];
  contatoNome: string;
  contatoTelefone: string;
  descricao: string;
  observacoes: string;
};
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
};

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
};

const agora = () => new Date().toISOString();
const NOMES_TIPO: Record<TipoMov, string> = { locacao: 'Nova locação', devolucao: 'Devolução', troca: 'Troca de frota' };
const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const CAMPOS_CLIENTE = ['nome', 'apelidos', 'cnpj', 'para', 'cc', 'observacoes', 'diaEmissao', 'regra', 'inicioLocacao', 'periodoDias', 'contato', 'telefone', 'prazoPagamento'] as const;
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

export function operacoes(db: Banco, repo: Repositorio) {
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
  function aplicar(m: { tipo: TipoMov; frota: string; frotaNova: string | null; clienteId: string | null; clienteNome: string; dados: DadosMov }, usuarioId: number): string {
    const d = m.dados;
    const titulo = `${NOMES_TIPO[m.tipo]} ${m.frota}${m.frotaNova ? ` → ${m.frotaNova}` : ''}`;

    if (m.tipo === 'locacao') {
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
        contrato: d.contrato,
        gas: d.gas,
        frete: d.frete,
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
      return cliente.id;
    }

    const cliente = m.clienteId ? repo.buscarCliente(m.clienteId) : donoDaFrota(m.frota);
    if (!cliente || !cliente.frotas.some((f) => f.numero === m.frota)) throw new Conflito2(`A frota ${m.frota} não está em nenhum cliente${m.clienteId ? ' informado' : ''}.`);

    if (m.tipo === 'devolucao') {
      tirarFrota(cliente, m.frota, usuarioId, `devolução em ${d.data.split('-').reverse().join('/')}`);
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
    return cliente.id;
  }

  return {
    // ---------- movimentações ----------
    listarMovimentacoes(): Movimentacao[] {
      return (db.prepare(`${SELECT_MOV} ORDER BY m.criada_em DESC`).all() as Record<string, unknown>[]).map(deLinhaMov);
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
          prazoPagamento: n.prazoPagamento,
          emails: n.emails,
          contatoNome: n.contatoNome,
          contatoTelefone: n.contatoTelefone,
          descricao: n.descricao,
          observacoes: n.observacoes,
        };
        let clienteId = n.clienteId ?? null;
        if (aprovarJa) clienteId = aplicar({ tipo: n.tipo, frota: n.frota, frotaNova: n.frotaNova ?? null, clienteId, clienteNome, dados }, usuarioId);
        db.prepare(
          `INSERT INTO movimentacoes (id, tipo, frota, frota_nova, cliente_id, cliente_nome, dados, status, criada_em, criada_por, decidida_em, decidida_por)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, n.tipo, n.frota, n.frotaNova ?? null, clienteId, clienteNome, JSON.stringify(dados), aprovarJa ? 'aprovada' : 'pendente', t, usuarioId, aprovarJa ? t : null, aprovarJa ? usuarioId : null);
        const resumo = `${NOMES_TIPO[n.tipo]} ${n.frota}${n.frotaNova ? ` → ${n.frotaNova}` : ''}${n.valor ? ` · ${brl(n.valor)}` : ''}`;
        repo.registrarLog(clienteId ?? '', usuarioId, aprovarJa ? `registrou ${resumo}` : `registrou ${resumo} (aguardando aprovação)`, null, dados, 'movimentacao');
        return buscarMov(id);
      })();
    },

    decidirMovimentacao(id: string, usuarioId: number, aprovar: boolean, motivo = ''): Movimentacao {
      return db.transaction(() => {
        const m = buscarMov(id);
        if (m.status !== 'pendente') throw new Conflito2('Essa movimentação já foi decidida.');
        let clienteId = m.clienteId;
        if (aprovar) clienteId = aplicar(m, usuarioId);
        db.prepare('UPDATE movimentacoes SET status = ?, decidida_em = ?, decidida_por = ?, motivo = ?, cliente_id = ? WHERE id = ?').run(
          aprovar ? 'aprovada' : 'rejeitada',
          agora(),
          usuarioId,
          motivo,
          clienteId,
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
