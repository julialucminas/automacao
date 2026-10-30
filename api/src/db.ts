import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export type Cliente = {
  id: string;
  nome: string;
  apelidos: string[];
  cnpj: string;
  para: string[];
  cc: string[];
  observacoes: string;
  ativo: boolean;
  atualizadoEm: string;
};

export type ClienteInput = Omit<Cliente, 'id' | 'ativo' | 'atualizadoEm'> & { id?: string };

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

export type Usuario = { id: number; email: string; nome: string; chamar: string };

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
  nome: string;
  apelidos: string;
  cnpj: string;
  para: string;
  cc: string;
  observacoes: string;
  ativo: number;
  atualizado_em: string;
};

const deLinhaCliente = (r: LinhaCliente): Cliente => ({
  id: r.id,
  nome: r.nome,
  apelidos: lista(r.apelidos),
  cnpj: r.cnpj,
  para: lista(r.para),
  cc: lista(r.cc),
  observacoes: r.observacoes,
  ativo: !!r.ativo,
  atualizadoEm: r.atualizado_em,
});

export class NaoEncontrado extends Error {}
export class Conflito extends Error {}

export function repositorio(db: Banco) {
  const registrar = (clienteId: string, usuarioId: number | null, acao: string, antes: unknown, depois: unknown) =>
    db
      .prepare('INSERT INTO historico_clientes (cliente_id, usuario_id, quando, acao, antes, depois) VALUES (?, ?, ?, ?, ?, ?)')
      .run(clienteId, usuarioId, agora(), acao, antes ? json(antes) : null, depois ? json(depois) : null);

  const buscarCliente = (id: string): Cliente => {
    const r = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id) as LinhaCliente | undefined;
    if (!r) throw new NaoEncontrado('Cliente não encontrado.');
    return deLinhaCliente(r);
  };

  return {
    // ---------- usuários e sessões ----------
    criarUsuario(email: string, nome: string, senhaHash: string, chamar = ''): Usuario {
      const r = db
        .prepare('INSERT INTO usuarios (email, nome, senha_hash, criado_em, chamar) VALUES (?, ?, ?, ?, ?)')
        .run(email.toLowerCase(), nome, senhaHash, agora(), chamar);
      return { id: Number(r.lastInsertRowid), email: email.toLowerCase(), nome, chamar };
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
      return (db.prepare('SELECT id, email, nome, chamar, ativo FROM usuarios ORDER BY id').all() as (Usuario & { ativo: number })[]).map((u) => ({
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
      return db.prepare('SELECT id, email, nome, chamar, senha_hash FROM usuarios WHERE email = ? AND ativo = 1').get(email.toLowerCase()) as
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
          `SELECT u.id, u.email, u.nome, u.chamar FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
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
    salvarCliente(input: ClienteInput, usuarioId: number): Cliente {
      return db.transaction(() => {
        const repetido = db.prepare('SELECT id FROM clientes WHERE nome = ? AND id IS NOT ?').get(input.nome, input.id ?? null) as { id: string } | undefined;
        if (repetido) throw new Conflito(`Já existe um cliente chamado ${input.nome}.`);
        const t = agora();
        if (input.id) {
          const antes = buscarCliente(input.id);
          db.prepare(
            `UPDATE clientes SET nome = ?, apelidos = ?, cnpj = ?, para = ?, cc = ?, observacoes = ?, atualizado_em = ?, atualizado_por = ?
             WHERE id = ?`,
          ).run(input.nome, json(input.apelidos), input.cnpj, json(input.para), json(input.cc), input.observacoes, t, usuarioId, input.id);
          const depois = buscarCliente(input.id);
          registrar(input.id, usuarioId, 'editou', antes, depois);
          return depois;
        }
        const id = randomUUID();
        db.prepare(
          `INSERT INTO clientes (id, nome, apelidos, cnpj, para, cc, observacoes, criado_em, atualizado_em, atualizado_por)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, input.nome, json(input.apelidos), input.cnpj, json(input.para), json(input.cc), input.observacoes, t, t, usuarioId);
        const criado = buscarCliente(id);
        registrar(id, usuarioId, 'criou', null, criado);
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
