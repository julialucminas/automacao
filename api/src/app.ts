import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { Conflito, NaoEncontrado, repositorio, type Banco, type ClienteInput, type Frota, type Usuario } from './db.js';
import { CONFIG_PADRAO, Conflito2, operacoes, type NovaMov, type TipoMov } from './operacoes.js';
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
class SemPermissao extends Error {}
const invalido = (m: string): never => {
  throw new Invalido(m);
};

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

function lerDiaEmissao(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 31) throw new Invalido('Dia de emissão deve ser entre 1 e 31.');
  return n;
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
function lerDataIso(v: unknown, campo: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const s = String(v);
  const d = new Date(s + 'T00:00:00Z');
  if (!DATA_ISO.test(s) || isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new Invalido(`${campo} inválida.`);
  return s;
}

function lerPeriodo(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 366) throw new Invalido('O período deve ser de 1 a 366 dias.');
  return n;
}

function lerFrotas(v: unknown): Frota[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 200) throw new Invalido('Lista de frotas inválida.');
  return v.map((item, i) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const numero = texto(o.numero, 'número da frota', 50).toUpperCase();
    if (!numero) throw new Invalido(`Informe o número da frota (linha ${i + 1}).`);
    const valor = Number(o.valor ?? 0);
    if (!Number.isInteger(valor) || valor < 0 || valor > 100_000_000_00) throw new Invalido(`Valor inválido na frota ${numero}.`);
    const f: Frota = { numero, valor, descricao: texto(o.descricao, 'descrição', 200) };
    // dados da locação vindos das movimentações (preservados ao editar o cliente)
    if (o.inicio !== undefined) f.inicio = lerDataIso(o.inicio, 'Início da locação') ?? null;
    if (o.contrato !== undefined) f.contrato = texto(o.contrato, 'contrato', 60);
    if (o.gas !== undefined) f.gas = lerInteiro(o.gas, 'vasilhames de gás', 0, 50);
    if (o.frete !== undefined) f.frete = lerFrete(o.frete);
    return f;
  });
}

function lerInteiro(v: unknown, campo: string, min: number, max: number): number {
  if (v === null || v === '' || v === undefined) return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Invalido(`Quantidade de ${campo} inválida.`);
  return n;
}

function lerFrete(v: unknown): '' | 'lucminas' | 'cliente' {
  if (v === undefined || v === null || v === '') return '';
  if (v === 'lucminas' || v === 'cliente') return v;
  throw new Invalido('Frete inválido.');
}

export function lerCliente(corpo: unknown, id?: string): ClienteInput {
  const b = (corpo ?? {}) as Record<string, unknown>;
  const nome = texto(b.nome, 'nome', 200).toUpperCase().replace(/\s+/g, ' ');
  if (!nome) throw new Invalido('Informe o nome do cliente.');
  const para = listaEmails(b.para, 'para');
  // e-mail pode ficar para depois: o cliente aparece com a etiqueta "sem e-mail" e não recebe envio
  return {
    id,
    nome,
    apelidos: listaTextos(b.apelidos, 'apelidos').map((a) => a.toUpperCase()),
    cnpj: texto(b.cnpj, 'cnpj', 30),
    para,
    cc: listaEmails(b.cc, 'cc').filter((e) => !para.includes(e)),
    observacoes: texto(b.observacoes, 'observacoes', 2000),
    diaEmissao: lerDiaEmissao(b.diaEmissao),
    frotas: lerFrotas(b.frotas),
    regra: b.regra === undefined ? undefined : b.regra === 'periodo' ? 'periodo' : b.regra === 'dia' ? 'dia' : invalido('Regra de faturamento inválida.'),
    inicioLocacao: lerDataIso(b.inicioLocacao, 'Data de início da locação'),
    periodoDias: lerPeriodo(b.periodoDias),
    contato: b.contato === undefined ? undefined : texto(b.contato, 'contato', 120),
    telefone: b.telefone === undefined ? undefined : texto(b.telefone, 'telefone', 40),
    prazoPagamento: b.prazoPagamento === undefined ? undefined : texto(b.prazoPagamento, 'prazo de pagamento', 100),
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
  const ops = operacoes(db, repo);
  const app = Fastify({ logger: opcoes.logger ?? false, trustProxy: true, bodyLimit: 1_000_000 });
  const podeTentar = limitador(10, 15 * 60_000);

  app.register(cookie);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof Invalido) return reply.code(400).send({ erro: err.message });
    if (err instanceof NaoEncontrado) return reply.code(404).send({ erro: err.message });
    if (err instanceof Conflito || err instanceof Conflito2) return reply.code(409).send({ erro: err.message });
    if (err instanceof SemPermissao) return reply.code(403).send({ erro: err.message });
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
  /** Só o financeiro (Angelise, Júlia) faz: editar cadastro direto, faturar, enviar, aprovar, configurar. */
  const exigirFinanceiro = async (req: FastifyRequest, reply: FastifyReply) => {
    await exigirLogin(req, reply);
    if (reply.sent) return;
    if (req.usuario.perfil !== 'financeiro') return reply.code(403).send({ erro: 'Seu usuário não tem permissão para isso. Peça a aprovação do financeiro.' });
  };
  void SemPermissao;

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
    return { id: u.id, email: u.email, nome: u.nome, chamar: u.chamar, perfil: u.perfil };
  });

  app.get('/api/sessao', { preHandler: exigirLogin }, async (req) => ({ id: req.usuario.id, email: req.usuario.email, nome: req.usuario.nome, chamar: req.usuario.chamar, perfil: req.usuario.perfil }));

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

  app.post('/api/clientes', { preHandler: exigirFinanceiro }, async (req, reply) => {
    const c = repo.salvarCliente(lerCliente(req.body), req.usuario.id);
    return reply.code(201).send(c);
  });

  app.put<{ Params: { id: string } }>('/api/clientes/:id', { preHandler: exigirFinanceiro }, async (req) =>
    repo.salvarCliente(lerCliente(req.body, req.params.id), req.usuario.id),
  );

  app.patch<{ Params: { id: string } }>('/api/clientes/:id', { preHandler: exigirFinanceiro }, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (typeof b.ativo !== 'boolean') throw new Invalido('Campo ativo inválido.');
    repo.definirAtivo(req.params.id, b.ativo, req.usuario.id);
    return repo.buscarCliente(req.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/clientes/:id/apelidos', { preHandler: exigirFinanceiro }, async (req) => {
    const apelido = texto((req.body as Record<string, unknown> | undefined)?.apelido, 'apelido', 200).toUpperCase();
    if (!apelido) throw new Invalido('Informe o nome.');
    return repo.adicionarApelido(req.params.id, apelido, req.usuario.id);
  });

  // ---------- faturamentos (calendário) ----------
  app.get<{ Querystring: { de?: string; ate?: string } }>('/api/faturamentos', { preHandler: exigirLogin }, async (req) => {
    const de = lerDataIso(req.query.de, 'Data inicial');
    const ate = lerDataIso(req.query.ate, 'Data final');
    if (!de || !ate) throw new Invalido('Informe o período.');
    return repo.listarFaturamentos(de, ate);
  });

  app.post('/api/faturamentos', { preHandler: exigirFinanceiro }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const data = lerDataIso(b.data, 'Data');
    if (!data || typeof b.clienteId !== 'string') throw new Invalido('Informe cliente e data.');
    repo.marcarFaturado(b.clienteId, data, req.usuario.id);
    return reply.code(201).send({ ok: true });
  });

  app.delete<{ Params: { clienteId: string; data: string } }>('/api/faturamentos/:clienteId/:data', { preHandler: exigirFinanceiro }, async (req) => {
    const data = lerDataIso(req.params.data, 'Data');
    if (!data) throw new Invalido('Data inválida.');
    repo.desmarcarFaturado(req.params.clienteId, data, req.usuario.id);
    return { ok: true };
  });

  // ---------- movimentações ----------
  const lerMov = (corpo: unknown): NovaMov => {
    const b = (corpo ?? {}) as Record<string, unknown>;
    const tipo = (['locacao', 'devolucao', 'troca'].includes(b.tipo as string) ? b.tipo : invalido('Tipo de movimentação inválido.')) as TipoMov;
    const frota = texto(b.frota, 'frota', 50).toUpperCase().replace(/^FT[\s-]*/, '');
    if (!frota) throw new Invalido('Informe a frota.');
    const frotaNova = texto(b.frotaNova, 'frota nova', 50).toUpperCase().replace(/^FT[\s-]*/, '');
    if (tipo === 'troca' && !frotaNova) throw new Invalido('Informe a frota nova.');
    const data = lerDataIso(b.data, 'Data');
    if (!data) throw new Invalido('Informe a data.');
    const clienteId = typeof b.clienteId === 'string' && b.clienteId ? b.clienteId : null;
    const clienteNome = texto(b.clienteNome, 'cliente', 200);
    if (tipo === 'locacao' && !clienteId && !clienteNome) throw new Invalido('Informe o cliente.');
    const valor = b.valor === null || b.valor === undefined || b.valor === '' ? null : Number(b.valor);
    if (valor !== null && (!Number.isInteger(valor) || valor < 0 || valor > 100_000_000_00)) throw new Invalido('Valor inválido.');
    return {
      tipo,
      frota,
      frotaNova: frotaNova || undefined,
      clienteId,
      clienteNome,
      data,
      valor,
      frete: lerFrete(b.frete),
      gas: lerInteiro(b.gas, 'vasilhames de gás', 0, 50),
      contrato: texto(b.contrato, 'tempo de contrato', 60),
      prazoPagamento: texto(b.prazoPagamento, 'prazo de pagamento', 100),
      emails: listaEmails(b.emails, 'e-mails'),
      contatoNome: texto(b.contatoNome, 'contato', 120),
      contatoTelefone: texto(b.contatoTelefone, 'telefone', 40),
      descricao: texto(b.descricao, 'descrição', 200),
      observacoes: texto(b.observacoes, 'observações', 2000),
    };
  };

  app.get('/api/movimentacoes', { preHandler: exigirLogin }, async () => ops.listarMovimentacoes());
  // financeiro registra já aplicando; operações registra pendente de aprovação
  app.post('/api/movimentacoes', { preHandler: exigirLogin }, async (req, reply) =>
    reply.code(201).send(ops.registrarMovimentacao(lerMov(req.body), req.usuario.id, req.usuario.perfil === 'financeiro')),
  );
  app.post<{ Params: { id: string } }>('/api/movimentacoes/:id/aprovar', { preHandler: exigirFinanceiro }, async (req) => ops.decidirMovimentacao(req.params.id, req.usuario.id, true));
  app.post<{ Params: { id: string } }>('/api/movimentacoes/:id/recusar', { preHandler: exigirFinanceiro }, async (req) =>
    ops.decidirMovimentacao(req.params.id, req.usuario.id, false, texto((req.body as Record<string, unknown> | undefined)?.motivo, 'motivo', 500)),
  );

  // ---------- propostas (alteração de cadastro feita por operações) ----------
  app.get('/api/propostas', { preHandler: exigirLogin }, async (req) => ops.listarPropostas(req.usuario.perfil === 'financeiro' ? undefined : req.usuario.id));
  app.post('/api/propostas', { preHandler: exigirLogin }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const id = ops.proporAlteracao(lerCliente(b, typeof b.id === 'string' ? b.id : undefined), req.usuario.id);
    return reply.code(201).send({ id });
  });
  app.post<{ Params: { id: string } }>('/api/propostas/:id/aprovar', { preHandler: exigirFinanceiro }, async (req) => {
    ops.decidirProposta(req.params.id, req.usuario.id, true);
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/api/propostas/:id/recusar', { preHandler: exigirFinanceiro }, async (req) => {
    ops.decidirProposta(req.params.id, req.usuario.id, false, texto((req.body as Record<string, unknown> | undefined)?.motivo, 'motivo', 500));
    return { ok: true };
  });

  // ---------- configurações e registro ----------
  app.get('/api/config', { preHandler: exigirLogin }, async () => ops.lerConfig());
  app.put('/api/config', { preHandler: exigirFinanceiro }, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const valores: Record<string, string> = {};
    for (const k of Object.keys(CONFIG_PADRAO)) if (b[k] !== undefined) valores[k] = texto(b[k], k, 5000) || CONFIG_PADRAO[k];
    return ops.salvarConfig(valores, req.usuario.id);
  });
  app.get('/api/registro', { preHandler: exigirLogin }, async () => ops.listarLog());

  // ---------- usuários e solicitações ----------
  app.get('/api/usuarios', { preHandler: exigirLogin }, async () => repo.listarUsuariosAtivos());

  app.get('/api/solicitacoes', { preHandler: exigirLogin }, async (req) => repo.listarSolicitacoes(req.usuario.id));

  app.get<{ Params: { id: string } }>('/api/solicitacoes/:id', { preHandler: exigirLogin }, async (req) => {
    const s = repo.buscarSolicitacao(req.params.id, req.usuario.id);
    repo.marcarVista(req.params.id, req.usuario.id);
    return { ...s, naoLidas: 0 };
  });

  app.post('/api/solicitacoes', { preHandler: exigirLogin }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const data = lerDataIso(b.data, 'Data');
    const titulo = texto(b.titulo, 'assunto', 120);
    const msg = texto(b.texto, 'mensagem', 4000);
    const para = Number(b.paraUsuario);
    if (!data) throw new Invalido('Informe a data.');
    if (!titulo) throw new Invalido('Informe o assunto.');
    if (!Number.isInteger(para)) throw new Invalido('Escolha para quem é a solicitação.');
    const clienteId = typeof b.clienteId === 'string' && b.clienteId ? b.clienteId : null;
    const id = repo.criarSolicitacao({ criadaPor: req.usuario.id, paraUsuario: para, data, clienteId, titulo, texto: msg });
    return reply.code(201).send(repo.buscarSolicitacao(id, req.usuario.id));
  });

  app.post<{ Params: { id: string } }>('/api/solicitacoes/:id/mensagens', { preHandler: exigirLogin }, async (req, reply) => {
    const msg = texto((req.body as Record<string, unknown> | undefined)?.texto, 'mensagem', 4000);
    if (!msg) throw new Invalido('Escreva a mensagem.');
    repo.responder(req.params.id, req.usuario.id, msg);
    return reply.code(201).send(repo.buscarSolicitacao(req.params.id, req.usuario.id));
  });

  app.patch<{ Params: { id: string } }>('/api/solicitacoes/:id', { preHandler: exigirLogin }, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const status = b.status === undefined ? undefined : b.status === 'concluida' ? 'concluida' : b.status === 'aberta' ? 'aberta' : invalido('Situação inválida.');
    const data = lerDataIso(b.data, 'Data') ?? undefined;
    repo.alterarSolicitacao(req.params.id, req.usuario.id, { status, data });
    return repo.buscarSolicitacao(req.params.id, req.usuario.id);
  });

  // ---------- envios ----------
  app.get('/api/envios', { preHandler: exigirLogin }, async () => repo.listarEnvios());

  const envioDesligado = async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.code(503).send({ erro: 'O envio pelo e-mail da empresa ainda não foi ativado. Nenhum e-mail foi enviado.' });
  app.post('/api/envios', { preHandler: exigirFinanceiro }, envioDesligado);
  app.post('/api/envios/:id/reenviar', { preHandler: exigirFinanceiro }, envioDesligado);

  return app;
}
