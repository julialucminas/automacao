import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

/** Equipamento (frota) alugado pelo cliente. valor em centavos, para não ter erro de arredondamento. */
export type Frota = {
  numero: string;
  valor: number;
  descricao: string;
  /** dados da locação (vêm das movimentações) */
  inicio?: string | null;
  contrato?: string;
  gas?: number;
  frete?: '' | 'lucminas' | 'cliente';
};

export type Cliente = {
  id: string;
  /** 'dia' = todo mês no diaEmissao; 'periodo' = a cada periodoDias a partir de inicioLocacao */
  regra: 'dia' | 'periodo';
  /** Dia do mês em que a fatura é emitida (1 a 31), ou null se não informado. */
  diaEmissao: number | null;
  inicioLocacao: string | null; // AAAA-MM-DD
  periodoDias: number | null;
  frotas: Frota[];
  contato: string;
  telefone: string;
  prazoPagamento: string;
  nome: string;
  apelidos: string[];
  cnpj: string;
  para: string[];
  cc: string[];
  observacoes: string;
  ativo: boolean;
  criadoEm: string;
  atualizadoEm: string;
};

/** diaEmissao/frotas ausentes = manter como está (ou vazio, se for cliente novo). */
export type ClienteInput = Omit<Cliente, 'id' | 'ativo' | 'criadoEm' | 'atualizadoEm' | 'diaEmissao' | 'frotas' | 'regra' | 'inicioLocacao' | 'periodoDias' | 'contato' | 'telefone' | 'prazoPagamento'> & {
  id?: string;
  diaEmissao?: number | null;
  frotas?: Frota[];
  regra?: 'dia' | 'periodo';
  inicioLocacao?: string | null;
  periodoDias?: number | null;
  contato?: string;
  telefone?: string;
  prazoPagamento?: string;
};

export type Faturamento = { clienteId: string; data: string; marcadoEm: string; marcadoPor: string; origem: 'manual' | 'envio' };

export type Envio = {
  id: string;
  enviadoEm: string;
  referencia: string;
  numero: string;
  clienteId: string | null;
  clienteNome: string;
  para: string[];
  cc: string[];
  assunto: string;
  anexos: string[];
  messageId: string;
  copiaEmEnviados: boolean;
  pediuLeitura: boolean;
  status: 'enviado' | 'lido' | 'devolvido' | 'falhou';
  detalhe: string;
  observacao: string;
};

export type Perfil = 'financeiro' | 'operacoes';
export type Usuario = { id: number; email: string; nome: string; chamar: string; perfil: Perfil };

export type Mensagem = { id: number; usuarioId: number; autor: string; texto: string; criadaEm: string };
export type Solicitacao = {
  id: string;
  criadaEm: string;
  criadaPor: number;
  criadaPorNome: string;
  paraUsuario: number;
  paraNome: string;
  data: string;
  clienteId: string | null;
  clienteNome: string | null;
  titulo: string;
  status: 'aberta' | 'concluida';
  concluidaEm: string | null;
  concluidaPorNome: string | null;
  totalMensagens: number;
  /** mensagens de outras pessoas que este usuário ainda não viu (inclui a solicitação nova) */
  naoLidas: number;
  ultimaMensagemEm: string;
  mensagens?: Mensagem[];
};

/** Versões do banco. Cada item roda uma vez, em ordem. Nunca editar um item já publicado: só acrescentar. */
const MIGRACOES = [
  `CREATE TABLE usuarios (
     id INTEGER PRIMARY KEY,
     email TEXT NOT NULL UNIQUE,
     nome TEXT NOT NULL,
     senha_hash TEXT NOT NULL,
     ativo INTEGER NOT NULL DEFAULT 1,
     criado_em TEXT NOT NULL
   );
   CREATE TABLE sessoes (
     token_hash TEXT PRIMARY KEY,
     usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
     criada_em TEXT NOT NULL,
     expira_em TEXT NOT NULL
   );
   CREATE TABLE clientes (
     id TEXT PRIMARY KEY,
     nome TEXT NOT NULL UNIQUE,
     apelidos TEXT NOT NULL DEFAULT '[]',
     cnpj TEXT NOT NULL DEFAULT '',
     para TEXT NOT NULL DEFAULT '[]',
     cc TEXT NOT NULL DEFAULT '[]',
     observacoes TEXT NOT NULL DEFAULT '',
     ativo INTEGER NOT NULL DEFAULT 1,
     criado_em TEXT NOT NULL,
     atualizado_em TEXT NOT NULL,
     atualizado_por INTEGER REFERENCES usuarios(id)
   );
   CREATE TABLE envios (
     id TEXT PRIMARY KEY,
     enviado_em TEXT NOT NULL,
     referencia TEXT NOT NULL,
     numero TEXT NOT NULL,
     cliente_id TEXT REFERENCES clientes(id),
     cliente_nome TEXT NOT NULL,
     para TEXT NOT NULL,
     cc TEXT NOT NULL,
     assunto TEXT NOT NULL,
     anexos TEXT NOT NULL,
     message_id TEXT NOT NULL,
     copia_em_enviados INTEGER NOT NULL,
     pediu_leitura INTEGER NOT NULL,
     status TEXT NOT NULL,
     detalhe TEXT NOT NULL,
     observacao TEXT NOT NULL DEFAULT '',
     enviado_por INTEGER REFERENCES usuarios(id)
   );
   CREATE INDEX envios_ref_num ON envios(referencia, numero);
   -- registro de alterações no cadastro (quem mudou o quê, quando)
   CREATE TABLE historico_clientes (
     id INTEGER PRIMARY KEY,
     cliente_id TEXT NOT NULL,
     usuario_id INTEGER,
     quando TEXT NOT NULL,
     acao TEXT NOT NULL,
     antes TEXT,
     depois TEXT
   );`,
  // como a pessoa é chamada na saudação do topo (ex.: "Angeli")
  `ALTER TABLE usuarios ADD COLUMN chamar TEXT NOT NULL DEFAULT '';`,
  // faturamento: dia de emissão e frotas (número + valor) de cada cliente
  `ALTER TABLE clientes ADD COLUMN dia_emissao INTEGER;
   ALTER TABLE clientes ADD COLUMN frotas TEXT NOT NULL DEFAULT '[]';`,
  // regra por período + faturamentos marcados (calendário)
  `ALTER TABLE clientes ADD COLUMN regra TEXT NOT NULL DEFAULT 'dia';
   ALTER TABLE clientes ADD COLUMN inicio_locacao TEXT;
   ALTER TABLE clientes ADD COLUMN periodo_dias INTEGER;
   CREATE TABLE faturamentos (
     cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
     data TEXT NOT NULL,
     marcado_em TEXT NOT NULL,
     usuario_id INTEGER REFERENCES usuarios(id),
     origem TEXT NOT NULL DEFAULT 'manual',
     PRIMARY KEY (cliente_id, data)
   );`,
  // solicitações entre usuários (pedido + conversa) e controle de leitura
  `CREATE TABLE solicitacoes (
     id TEXT PRIMARY KEY,
     criada_em TEXT NOT NULL,
     criada_por INTEGER NOT NULL REFERENCES usuarios(id),
     para_usuario INTEGER NOT NULL REFERENCES usuarios(id),
     data TEXT NOT NULL,
     cliente_id TEXT REFERENCES clientes(id) ON DELETE SET NULL,
     titulo TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'aberta',
     concluida_em TEXT,
     concluida_por INTEGER REFERENCES usuarios(id)
   );
   CREATE INDEX solicitacoes_data ON solicitacoes(data);
   CREATE TABLE mensagens (
     id INTEGER PRIMARY KEY,
     solicitacao_id TEXT NOT NULL REFERENCES solicitacoes(id) ON DELETE CASCADE,
     usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
     texto TEXT NOT NULL,
     criada_em TEXT NOT NULL
   );
   CREATE INDEX mensagens_solicitacao ON mensagens(solicitacao_id);
   CREATE TABLE leituras (
     solicitacao_id TEXT NOT NULL REFERENCES solicitacoes(id) ON DELETE CASCADE,
     usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
     vista_em TEXT NOT NULL,
     PRIMARY KEY (solicitacao_id, usuario_id)
   );`,
  // perfis, contato do cliente, movimentações, propostas de alteração, configurações e log geral
  `ALTER TABLE usuarios ADD COLUMN perfil TEXT NOT NULL DEFAULT 'financeiro';
   ALTER TABLE clientes ADD COLUMN contato TEXT NOT NULL DEFAULT '';
   ALTER TABLE clientes ADD COLUMN telefone TEXT NOT NULL DEFAULT '';
   ALTER TABLE clientes ADD COLUMN prazo_pagamento TEXT NOT NULL DEFAULT '';
   ALTER TABLE historico_clientes ADD COLUMN area TEXT NOT NULL DEFAULT 'cliente';
   CREATE TABLE movimentacoes (
     id TEXT PRIMARY KEY,
     tipo TEXT NOT NULL,
     frota TEXT NOT NULL,
     frota_nova TEXT,
     cliente_id TEXT REFERENCES clientes(id) ON DELETE SET NULL,
     cliente_nome TEXT NOT NULL DEFAULT '',
     dados TEXT NOT NULL,
     status TEXT NOT NULL,
     criada_em TEXT NOT NULL,
     criada_por INTEGER REFERENCES usuarios(id),
     decidida_em TEXT,
     decidida_por INTEGER REFERENCES usuarios(id),
     motivo TEXT NOT NULL DEFAULT ''
   );
   CREATE TABLE propostas (
     id TEXT PRIMARY KEY,
     cliente_id TEXT REFERENCES clientes(id) ON DELETE CASCADE,
     dados TEXT NOT NULL,
     base TEXT,
     status TEXT NOT NULL,
     criada_em TEXT NOT NULL,
     criada_por INTEGER REFERENCES usuarios(id),
     decidida_em TEXT,
     decidida_por INTEGER REFERENCES usuarios(id),
     motivo TEXT NOT NULL DEFAULT ''
   );
   CREATE TABLE configuracoes (
     chave TEXT PRIMARY KEY,
     valor TEXT NOT NULL,
     atualizado_em TEXT NOT NULL,
     atualizado_por INTEGER REFERENCES usuarios(id)
   );`,
  // 7: conferência mensal das frotas (operações marca o que está certo)
  `CREATE TABLE conferencias (
     referencia TEXT NOT NULL,
     cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
     frota TEXT NOT NULL,
     status TEXT NOT NULL,
     valor INTEGER NOT NULL,
     descricao TEXT NOT NULL DEFAULT '',
     observacao TEXT NOT NULL DEFAULT '',
     quando TEXT NOT NULL,
     usuario_id INTEGER REFERENCES usuarios(id),
     PRIMARY KEY (referencia, cliente_id, frota)
   );`,
];

export function abrirBanco(caminho: string) {
  const db = new Database(caminho);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const versao = db.pragma('user_version', { simple: true }) as number;
  for (let v = versao; v < MIGRACOES.length; v++) {
    db.transaction(() => {
      db.exec(MIGRACOES[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return db;
}

export type Banco = ReturnType<typeof abrirBanco>;

const agora = () => new Date().toISOString();
const json = (v: unknown) => JSON.stringify(v);
const lista = (s: string): string[] => JSON.parse(s);

type LinhaCliente = {
  id: string;
  dia_emissao: number | null;
  frotas: string;
  regra: string;
  inicio_locacao: string | null;
  periodo_dias: number | null;
  contato: string;
  telefone: string;
  prazo_pagamento: string;
  nome: string;
  apelidos: string;
  cnpj: string;
  para: string;
  cc: string;
  observacoes: string;
  ativo: number;
  criado_em: string;
  atualizado_em: string;
};

const deLinhaCliente = (r: LinhaCliente): Cliente => ({
  id: r.id,
  regra: r.regra === 'periodo' ? 'periodo' : 'dia',
  diaEmissao: r.dia_emissao ?? null,
  inicioLocacao: r.inicio_locacao ?? null,
  periodoDias: r.periodo_dias ?? null,
  contato: r.contato ?? '',
  telefone: r.telefone ?? '',
  prazoPagamento: r.prazo_pagamento ?? '',
  frotas: JSON.parse(r.frotas),
  nome: r.nome,
  apelidos: lista(r.apelidos),
  cnpj: r.cnpj,
  para: lista(r.para),
  cc: lista(r.cc),
  observacoes: r.observacoes,
  ativo: !!r.ativo,
  criadoEm: r.criado_em,
  atualizadoEm: r.atualizado_em,
});

export class NaoEncontrado extends Error {}
export class Conflito extends Error {}

export function repositorio(db: Banco) {
  const registrar = (clienteId: string, usuarioId: number | null, acao: string, antes: unknown, depois: unknown, area = 'cliente') =>
    db
      .prepare('INSERT INTO historico_clientes (cliente_id, usuario_id, quando, acao, antes, depois, area) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(clienteId, usuarioId, agora(), acao, antes ? json(antes) : null, depois ? json(depois) : null, area);

  const buscarCliente = (id: string): Cliente => {
    const r = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id) as LinhaCliente | undefined;
    if (!r) throw new NaoEncontrado('Cliente não encontrado.');
    return deLinhaCliente(r);
  };

  return {
    // ---------- usuários e sessões ----------
    registrarLog: registrar,
    criarUsuario(email: string, nome: string, senhaHash: string, chamar = '', perfil: Perfil = 'financeiro'): Usuario {
      const r = db
        .prepare('INSERT INTO usuarios (email, nome, senha_hash, criado_em, chamar, perfil) VALUES (?, ?, ?, ?, ?, ?)')
        .run(email.toLowerCase(), nome, senhaHash, agora(), chamar, perfil);
      return { id: Number(r.lastInsertRowid), email: email.toLowerCase(), nome, chamar, perfil };
    },
    definirPerfil(email: string, perfil: Perfil): boolean {
      return db.prepare('UPDATE usuarios SET perfil = ? WHERE email = ?').run(perfil, email.toLowerCase()).changes > 0;
    },
    definirChamar(email: string, chamar: string): boolean {
      return db.prepare('UPDATE usuarios SET chamar = ? WHERE email = ?').run(chamar, email.toLowerCase()).changes > 0;
    },
    hashDaSenha(usuarioId: number): string | undefined {
      return (db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?').get(usuarioId) as { senha_hash: string } | undefined)?.senha_hash;
    },
    /** Troca a senha e encerra as outras sessões (mantém a atual). */
    trocarSenhaPorId(usuarioId: number, senhaHash: string, manterSessao: string) {
      db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(senhaHash, usuarioId);
      db.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND token_hash != ?').run(usuarioId, manterSessao);
    },
    trocarSenha(email: string, senhaHash: string): boolean {
      const r = db.prepare('UPDATE usuarios SET senha_hash = ? WHERE email = ?').run(senhaHash, email.toLowerCase());
      if (r.changes) {
        db.prepare('DELETE FROM sessoes WHERE usuario_id = (SELECT id FROM usuarios WHERE email = ?)').run(email.toLowerCase());
      }
      return r.changes > 0;
    },
    listarUsuarios(): (Usuario & { ativo: boolean })[] {
      return (db.prepare('SELECT id, email, nome, chamar, perfil, ativo FROM usuarios ORDER BY id').all() as (Usuario & { ativo: number })[]).map((u) => ({
        ...u,
        ativo: !!u.ativo,
      }));
    },
    definirUsuarioAtivo(email: string, ativo: boolean): boolean {
      const r = db.prepare('UPDATE usuarios SET ativo = ? WHERE email = ?').run(ativo ? 1 : 0, email.toLowerCase());
      if (!ativo) db.prepare('DELETE FROM sessoes WHERE usuario_id = (SELECT id FROM usuarios WHERE email = ?)').run(email.toLowerCase());
      return r.changes > 0;
    },
    usuarioParaLogin(email: string) {
      return db.prepare('SELECT id, email, nome, chamar, perfil, senha_hash FROM usuarios WHERE email = ? AND ativo = 1').get(email.toLowerCase()) as
        | (Usuario & { senha_hash: string })
        | undefined;
    },
    criarSessao(tokenHash: string, usuarioId: number, validadeDias: number) {
      const expira = new Date(Date.now() + validadeDias * 86_400_000).toISOString();
      db.prepare('INSERT INTO sessoes (token_hash, usuario_id, criada_em, expira_em) VALUES (?, ?, ?, ?)').run(tokenHash, usuarioId, agora(), expira);
      db.prepare('DELETE FROM sessoes WHERE expira_em < ?').run(agora());
    },
    usuarioDaSessao(tokenHash: string): Usuario | undefined {
      return db
        .prepare(
          `SELECT u.id, u.email, u.nome, u.chamar, u.perfil FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
           WHERE s.token_hash = ? AND s.expira_em > ? AND u.ativo = 1`,
        )
        .get(tokenHash, agora()) as Usuario | undefined;
    },
    encerrarSessao(tokenHash: string) {
      db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(tokenHash);
    },

    // ---------- clientes ----------
    listarClientes(): Cliente[] {
      return (db.prepare('SELECT * FROM clientes ORDER BY nome').all() as LinhaCliente[]).map(deLinhaCliente);
    },
    buscarCliente,
    salvarCliente(input: ClienteInput, usuarioId: number, acao?: string): Cliente {
      return db.transaction(() => {
        const repetido = db.prepare('SELECT id FROM clientes WHERE nome = ? AND id IS NOT ?').get(input.nome, input.id ?? null) as { id: string } | undefined;
        if (repetido) throw new Conflito(`Já existe um cliente chamado ${input.nome}.`);
        const t = agora();
        if (input.id) {
          const antes = buscarCliente(input.id);
          db.prepare(
            `UPDATE clientes SET nome = ?, apelidos = ?, cnpj = ?, para = ?, cc = ?, observacoes = ?, dia_emissao = ?, frotas = ?,
               regra = ?, inicio_locacao = ?, periodo_dias = ?, contato = ?, telefone = ?, prazo_pagamento = ?, atualizado_em = ?, atualizado_por = ?
             WHERE id = ?`,
          ).run(
            input.nome,
            json(input.apelidos),
            input.cnpj,
            json(input.para),
            json(input.cc),
            input.observacoes,
            input.diaEmissao === undefined ? antes.diaEmissao : input.diaEmissao,
            json(input.frotas ?? antes.frotas),
            input.regra ?? antes.regra,
            input.inicioLocacao === undefined ? antes.inicioLocacao : input.inicioLocacao,
            input.periodoDias === undefined ? antes.periodoDias : input.periodoDias,
            input.contato ?? antes.contato,
            input.telefone ?? antes.telefone,
            input.prazoPagamento ?? antes.prazoPagamento,
            t,
            usuarioId,
            input.id,
          );
          const depois = buscarCliente(input.id);
          registrar(input.id, usuarioId, acao ?? 'editou', antes, depois);
          return depois;
        }
        const id = randomUUID();
        db.prepare(
          `INSERT INTO clientes (id, nome, apelidos, cnpj, para, cc, observacoes, dia_emissao, frotas, regra, inicio_locacao, periodo_dias,
             contato, telefone, prazo_pagamento, criado_em, atualizado_em, atualizado_por)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          input.nome,
          json(input.apelidos),
          input.cnpj,
          json(input.para),
          json(input.cc),
          input.observacoes,
          input.diaEmissao ?? null,
          json(input.frotas ?? []),
          input.regra ?? 'dia',
          input.inicioLocacao ?? null,
          input.periodoDias ?? null,
          input.contato ?? '',
          input.telefone ?? '',
          input.prazoPagamento ?? '',
          t,
          t,
          usuarioId,
        );
        const criado = buscarCliente(id);
        registrar(id, usuarioId, acao ?? 'criou', null, criado);
        return criado;
      })();
    },
    definirAtivo(id: string, ativo: boolean, usuarioId: number) {
      buscarCliente(id);
      db.prepare('UPDATE clientes SET ativo = ?, atualizado_em = ?, atualizado_por = ? WHERE id = ?').run(ativo ? 1 : 0, agora(), usuarioId, id);
      registrar(id, usuarioId, ativo ? 'reativou' : 'desativou', null, null);
    },
    adicionarApelido(id: string, apelido: string, usuarioId: number): Cliente {
      const c = buscarCliente(id);
      if (!c.apelidos.includes(apelido)) {
        db.prepare('UPDATE clientes SET apelidos = ?, atualizado_em = ?, atualizado_por = ? WHERE id = ?').run(
          json([...c.apelidos, apelido]),
          agora(),
          usuarioId,
          id,
        );
        registrar(id, usuarioId, `vinculou o nome "${apelido}"`, null, null);
      }
      return buscarCliente(id);
    },

    // ---------- faturamentos (calendário) ----------
    listarFaturamentos(de: string, ate: string): Faturamento[] {
      return (
        db
          .prepare(
            `SELECT f.cliente_id, f.data, f.marcado_em, f.origem, COALESCE(u.nome, '') AS nome
             FROM faturamentos f LEFT JOIN usuarios u ON u.id = f.usuario_id
             WHERE f.data BETWEEN ? AND ? ORDER BY f.data`,
          )
          .all(de, ate) as { cliente_id: string; data: string; marcado_em: string; origem: string; nome: string }[]
      ).map((r) => ({ clienteId: r.cliente_id, data: r.data, marcadoEm: r.marcado_em, marcadoPor: r.nome, origem: r.origem === 'envio' ? 'envio' : 'manual' }));
    },
    marcarFaturado(clienteId: string, data: string, usuarioId: number, origem: 'manual' | 'envio' = 'manual') {
      buscarCliente(clienteId);
      db.prepare(
        `INSERT INTO faturamentos (cliente_id, data, marcado_em, usuario_id, origem) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (cliente_id, data) DO NOTHING`,
      ).run(clienteId, data, agora(), usuarioId, origem);
      registrar(clienteId, usuarioId, `marcou faturado em ${data}`, null, null);
    },
    desmarcarFaturado(clienteId: string, data: string, usuarioId: number) {
      const r = db.prepare('DELETE FROM faturamentos WHERE cliente_id = ? AND data = ?').run(clienteId, data);
      if (r.changes) registrar(clienteId, usuarioId, `desmarcou faturado em ${data}`, null, null);
    },

    // ---------- usuários (para escolher destinatário) ----------
    listarUsuariosAtivos(): { id: number; nome: string; chamar: string; email: string }[] {
      return db.prepare("SELECT id, nome, chamar, email FROM usuarios WHERE ativo = 1 AND perfil = 'financeiro' ORDER BY nome").all() as {
        id: number;
        nome: string;
        chamar: string;
        email: string;
      }[];
    },

    // ---------- solicitações ----------
    listarSolicitacoes(usuarioId: number): Solicitacao[] {
      type L = Record<string, unknown>;
      const linhas = db
        .prepare(
          `SELECT s.*, cu.nome AS criada_por_nome, pu.nome AS para_nome, c.nome AS cliente_nome, ku.nome AS concluida_por_nome,
             (SELECT COUNT(*) FROM mensagens m WHERE m.solicitacao_id = s.id) AS total,
             (SELECT MAX(m.criada_em) FROM mensagens m WHERE m.solicitacao_id = s.id) AS ultima,
             (SELECT COUNT(*) FROM mensagens m WHERE m.solicitacao_id = s.id AND m.usuario_id != @u
                AND m.criada_em > COALESCE((SELECT vista_em FROM leituras l WHERE l.solicitacao_id = s.id AND l.usuario_id = @u), '')) AS nao_lidas
           FROM solicitacoes s
           JOIN usuarios cu ON cu.id = s.criada_por
           JOIN usuarios pu ON pu.id = s.para_usuario
           LEFT JOIN clientes c ON c.id = s.cliente_id
           LEFT JOIN usuarios ku ON ku.id = s.concluida_por
           ORDER BY s.data, s.criada_em`,
        )
        .all({ u: usuarioId }) as L[];
      return linhas.map((r) => ({
        id: r.id as string,
        criadaEm: r.criada_em as string,
        criadaPor: r.criada_por as number,
        criadaPorNome: r.criada_por_nome as string,
        paraUsuario: r.para_usuario as number,
        paraNome: r.para_nome as string,
        data: r.data as string,
        clienteId: (r.cliente_id as string) ?? null,
        clienteNome: (r.cliente_nome as string) ?? null,
        titulo: r.titulo as string,
        status: r.status === 'concluida' ? 'concluida' : 'aberta',
        concluidaEm: (r.concluida_em as string) ?? null,
        concluidaPorNome: (r.concluida_por_nome as string) ?? null,
        totalMensagens: r.total as number,
        naoLidas: r.nao_lidas as number,
        ultimaMensagemEm: (r.ultima as string) ?? (r.criada_em as string),
      }));
    },
    buscarSolicitacao(id: string, usuarioId: number): Solicitacao {
      const s = this.listarSolicitacoes(usuarioId).find((x) => x.id === id);
      if (!s) throw new NaoEncontrado('Solicitação não encontrada.');
      s.mensagens = (
        db
          .prepare(
            `SELECT m.id, m.usuario_id, u.nome, m.texto, m.criada_em FROM mensagens m JOIN usuarios u ON u.id = m.usuario_id
             WHERE m.solicitacao_id = ? ORDER BY m.criada_em, m.id`,
          )
          .all(id) as { id: number; usuario_id: number; nome: string; texto: string; criada_em: string }[]
      ).map((m) => ({ id: m.id, usuarioId: m.usuario_id, autor: m.nome, texto: m.texto, criadaEm: m.criada_em }));
      return s;
    },
    marcarVista(id: string, usuarioId: number) {
      db.prepare(
        `INSERT INTO leituras (solicitacao_id, usuario_id, vista_em) VALUES (?, ?, ?)
         ON CONFLICT (solicitacao_id, usuario_id) DO UPDATE SET vista_em = excluded.vista_em`,
      ).run(id, usuarioId, agora());
    },
    criarSolicitacao(d: { criadaPor: number; paraUsuario: number; data: string; clienteId: string | null; titulo: string; texto: string }): string {
      return db.transaction(() => {
        if (!db.prepare('SELECT 1 FROM usuarios WHERE id = ? AND ativo = 1').get(d.paraUsuario)) throw new NaoEncontrado('Usuário de destino não encontrado.');
        if (d.clienteId) buscarCliente(d.clienteId);
        const id = randomUUID();
        const t = agora();
        db.prepare(
          'INSERT INTO solicitacoes (id, criada_em, criada_por, para_usuario, data, cliente_id, titulo) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run(id, t, d.criadaPor, d.paraUsuario, d.data, d.clienteId, d.titulo);
        if (d.texto) db.prepare('INSERT INTO mensagens (solicitacao_id, usuario_id, texto, criada_em) VALUES (?, ?, ?, ?)').run(id, d.criadaPor, d.texto, t);
        db.prepare('INSERT INTO leituras (solicitacao_id, usuario_id, vista_em) VALUES (?, ?, ?)').run(id, d.criadaPor, t);
        return id;
      })();
    },
    responder(id: string, usuarioId: number, texto: string) {
      if (!db.prepare('SELECT 1 FROM solicitacoes WHERE id = ?').get(id)) throw new NaoEncontrado('Solicitação não encontrada.');
      const t = agora();
      db.prepare('INSERT INTO mensagens (solicitacao_id, usuario_id, texto, criada_em) VALUES (?, ?, ?, ?)').run(id, usuarioId, texto, t);
      this.marcarVista(id, usuarioId);
    },
    alterarSolicitacao(id: string, usuarioId: number, mudanca: { status?: 'aberta' | 'concluida'; data?: string }) {
      const atual = db.prepare('SELECT status, data FROM solicitacoes WHERE id = ?').get(id) as { status: string; data: string } | undefined;
      if (!atual) throw new NaoEncontrado('Solicitação não encontrada.');
      const t = agora();
      if (mudanca.status && mudanca.status !== atual.status) {
        db.prepare('UPDATE solicitacoes SET status = ?, concluida_em = ?, concluida_por = ? WHERE id = ?').run(
          mudanca.status,
          mudanca.status === 'concluida' ? t : null,
          mudanca.status === 'concluida' ? usuarioId : null,
          id,
        );
        db.prepare('INSERT INTO mensagens (solicitacao_id, usuario_id, texto, criada_em) VALUES (?, ?, ?, ?)').run(
          id,
          usuarioId,
          mudanca.status === 'concluida' ? '✔ Marcou como concluída.' : '↺ Reabriu a solicitação.',
          t,
        );
      }
      if (mudanca.data && mudanca.data !== atual.data) {
        db.prepare('UPDATE solicitacoes SET data = ? WHERE id = ?').run(mudanca.data, id);
        const [a, m, d] = mudanca.data.split('-');
        db.prepare('INSERT INTO mensagens (solicitacao_id, usuario_id, texto, criada_em) VALUES (?, ?, ?, ?)').run(id, usuarioId, `Mudou a data para ${d}/${m}/${a}.`, t);
      }
      this.marcarVista(id, usuarioId);
    },

    // ---------- envios ----------
    listarEnvios(): Envio[] {
      type L = Record<string, unknown>;
      return (db.prepare('SELECT * FROM envios ORDER BY enviado_em DESC').all() as L[]).map((r) => ({
        id: r.id as string,
        enviadoEm: r.enviado_em as string,
        referencia: r.referencia as string,
        numero: r.numero as string,
        clienteId: (r.cliente_id as string) ?? null,
        clienteNome: r.cliente_nome as string,
        para: lista(r.para as string),
        cc: lista(r.cc as string),
        assunto: r.assunto as string,
        anexos: lista(r.anexos as string),
        messageId: r.message_id as string,
        copiaEmEnviados: !!r.copia_em_enviados,
        pediuLeitura: !!r.pediu_leitura,
        status: r.status as Envio['status'],
        detalhe: r.detalhe as string,
        observacao: r.observacao as string,
      }));
    },
  };
}

export type Repositorio = ReturnType<typeof repositorio>;
