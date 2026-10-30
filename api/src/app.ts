import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { Conflito, NaoEncontrado, repositorio, type Banco, type ClienteInput, type Usuario } from './db.js';
import { conferirSenha, gerarHash, hashToken, novoToken, problemaSenha } from './senha.js';

const COOKIE = 'sessao';
const VALIDADE_DIAS = 30;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

declare module 'fastify' {
  interface FastifyRequest {
    usuario: Usuario;
  }
}

class Invalido extends Error {}

// ---------- validação dos dados que chegam ----------
const texto = (v: unknown, campo: string, max = 500): string => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new Invalido(`Campo ${campo} inválido.`);
  const s = v.trim();
  if (s.length > max) throw new Invalido(`Campo ${campo} muito longo.`);
  return s;
};

const listaTextos = (v: unknown, campo: string): string[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 50) throw new Invalido(`Campo ${campo} inválido.`);
  return [...new Set(v.map((x) => texto(x, campo, 200)).filter(Boolean))];
};

const listaEmails = (v: unknown, campo: string): string[] => {
  const l = [...new Set(listaTextos(v, campo).map((e) => e.toLowerCase()))];
  const ruim = l.find((e) => !EMAIL.test(e));
  if (ruim) throw new Invalido(`E-mail inválido: ${ruim}`);
  return l;
};

export function lerCliente(corpo: unknown, id?: string): ClienteInput {
  const b = (corpo ?? {}) as Record<string, unknown>;
  const nome = texto(b.nome, 'nome', 200).toUpperCase().replace(/\s+/g, ' ');
  if (!nome) throw new Invalido('Informe o nome do cliente.');
  const para = listaEmails(b.para, 'para');
  if (!para.length) throw new Invalido('Informe pelo menos um e-mail em Para.');
  return {
    id,
    nome,
    apelidos: listaTextos(b.apelidos, 'apelidos').map((a) => a.toUpperCase()),
    cnpj: texto(b.cnpj, 'cnpj', 30),
    para,
    cc: listaEmails(b.cc, 'cc').filter((e) => !para.includes(e)),
    observacoes: texto(b.observacoes, 'observacoes', 2000),
  };
}

// ---------- limite de tentativas de login (por IP) ----------
function limitador(max: number, janelaMs: number) {
  const tentativas = new Map<string, number[]>();
  return (chave: string): boolean => {
    const agora = Date.now();
    const l = (tentativas.get(chave) ?? []).filter((t) => agora - t < janelaMs);
    l.push(agora);
    tentativas.set(chave, l);
    return l.length <= max;
  };
}

export function criarApp(db: Banco, opcoes: { cookieSeguro: boolean; logger?: boolean }) {
  const repo = repositorio(db);
  const app = Fastify({ logger: opcoes.logger ?? false, trustProxy: true, bodyLimit: 1_000_000 });
  const podeTentar = limitador(10, 15 * 60_000);

  app.register(cookie);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof Invalido) return reply.code(400).send({ erro: err.message });
    if (err instanceof NaoEncontrado) return reply.code(404).send({ erro: err.message });
    if (err instanceof Conflito) return reply.code(409).send({ erro: err.message });
    if ((err as { statusCode?: number }).statusCode && (err as { statusCode: number }).statusCode < 500) {
      return reply.code((err as { statusCode: number }).statusCode).send({ erro: 'Requisição inválida.' });
    }
    app.log.error(err);
    return reply.code(500).send({ erro: 'Erro no servidor.' });
  });

  const exigirLogin = async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies[COOKIE];
    const u = token ? repo.usuarioDaSessao(hashToken(token)) : undefined;
    if (!u) return reply.code(401).send({ erro: 'Faça login.' });
    req.usuario = u;
  };

  // ---------- sessão ----------
  app.get('/api/saude', async () => ({ ok: true }));

  app.post('/api/sessao', async (req, reply) => {
    if (!podeTentar(req.ip)) return reply.code(429).send({ erro: 'Muitas tentativas. Espere 15 minutos.' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const email = texto(b.email, 'email', 200).toLowerCase();
    const senha = typeof b.senha === 'string' ? b.senha : '';
    const u = email ? repo.usuarioParaLogin(email) : undefined;
    // confere a senha mesmo quando o usuário não existe, para não revelar quais e-mails estão cadastrados
    const ok = await conferirSenha(senha, u?.senha_hash ?? 'scrypt$00$00');
    if (!u || !ok) return reply.code(401).send({ erro: 'E-mail ou senha incorretos.' });
    const token = novoToken();
    repo.criarSessao(hashToken(token), u.id, VALIDADE_DIAS);
    reply.setCookie(COOKIE, token, {
      path: '/',
      httpOnly: true,
      secure: opcoes.cookieSeguro,
      sameSite: 'strict',
      maxAge: VALIDADE_DIAS * 86_400,
    });
    return { email: u.email, nome: u.nome, chamar: u.chamar };
  });

  app.get('/api/sessao', { preHandler: exigirLogin }, async (req) => ({ email: req.usuario.email, nome: req.usuario.nome, chamar: req.usuario.chamar }));

  app.put('/api/sessao/senha', { preHandler: exigirLogin }, async (req, reply) => {
    if (!podeTentar(req.ip)) return reply.code(429).send({ erro: 'Muitas tentativas. Espere 15 minutos.' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const atual = typeof b.atual === 'string' ? b.atual : '';
    const nova = typeof b.nova === 'string' ? b.nova : '';
    if (!(await conferirSenha(atual, repo.hashDaSenha(req.usuario.id) ?? 'scrypt$00$00'))) {
      return reply.code(400).send({ erro: 'A senha atual não confere.' });
    }
    const problema = problemaSenha(nova);
    if (problema) return reply.code(400).send({ erro: problema });
    repo.trocarSenhaPorId(req.usuario.id, await gerarHash(nova), hashToken(req.cookies[COOKIE]!));
    return { ok: true };
  });

  app.delete('/api/sessao', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) repo.encerrarSessao(hashToken(token));
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  // ---------- clientes ----------
  app.get('/api/clientes', { preHandler: exigirLogin }, async () => repo.listarClientes());

  app.post('/api/clientes', { preHandler: exigirLogin }, async (req, reply) => {
    const c = repo.salvarCliente(lerCliente(req.body), req.usuario.id);
    return reply.code(201).send(c);
  });

  app.put<{ Params: { id: string } }>('/api/clientes/:id', { preHandler: exigirLogin }, async (req) =>
    repo.salvarCliente(lerCliente(req.body, req.params.id), req.usuario.id),
  );

  app.patch<{ Params: { id: string } }>('/api/clientes/:id', { preHandler: exigirLogin }, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (typeof b.ativo !== 'boolean') throw new Invalido('Campo ativo inválido.');
    repo.definirAtivo(req.params.id, b.ativo, req.usuario.id);
    return repo.buscarCliente(req.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/clientes/:id/apelidos', { preHandler: exigirLogin }, async (req) => {
    const apelido = texto((req.body as Record<string, unknown> | undefined)?.apelido, 'apelido', 200).toUpperCase();
    if (!apelido) throw new Invalido('Informe o nome.');
    return repo.adicionarApelido(req.params.id, apelido, req.usuario.id);
  });

  // ---------- envios ----------
  app.get('/api/envios', { preHandler: exigirLogin }, async () => repo.listarEnvios());

  const envioDesligado = async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.code(503).send({ erro: 'O envio pelo e-mail da empresa ainda não foi ativado. Nenhum e-mail foi enviado.' });
  app.post('/api/envios', { preHandler: exigirLogin }, envioDesligado);
  app.post('/api/envios/:id/reenviar', { preHandler: exigirLogin }, envioDesligado);

  return app;
}
