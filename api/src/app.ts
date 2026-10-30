import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { Conflito, NaoEncontrado, repositorio, type Banco, type ClienteInput, type Frota, type Usuario } from './db.js';
import { CONFIG_PADRAO, Conflito2, operacoes, type NovaMov, type TipoMov } from './operacoes.js';
import { monitorCaixa } from './monitor.js';
import { carteiroReal, lerConta, servicoEnvio, type Anexo, type Carteiro } from './envio.js';
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

export function criarApp(db: Banco, opcoes: { cookieSeguro: boolean; logger?: boolean; pastaDados?: string; carteiro?: Carteiro; monitorar?: boolean; esperaCopiaMs?: number }) {
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
  app.get('/api/registro', { preHandler: exigirFinanceiro }, async () => ops.listarLog());

  // ---------- conferência mensal das frotas ----------
  const lerRef = (v: unknown) => {
    if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new Invalido('Mês de referência inválido.');
    return v;
  };
  const lerItemConf = (b: Record<string, unknown>) => {
    const clienteId = typeof b.clienteId === 'string' && b.clienteId ? b.clienteId : invalido('Informe o cliente.');
    const frota = texto(b.frota, 'frota', 50).toUpperCase();
    if (!frota) throw new Invalido('Informe a frota.');
    return { clienteId: clienteId as string, frota };
  };
  app.get<{ Params: { ref: string } }>('/api/conferencia/:ref', { preHandler: exigirLogin }, async (req) => ops.listarConferencia(lerRef(req.params.ref)));
  app.post<{ Params: { ref: string } }>('/api/conferencia/:ref', { preHandler: exigirLogin }, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const status = b.status === 'alterado' ? 'alterado' : b.status === 'ok' ? 'ok' : invalido('Situação inválida.');
    return ops.marcarConferencia({ referencia: lerRef(req.params.ref), ...lerItemConf(b), status: status as 'ok' | 'alterado', observacao: texto(b.observacao, 'observação', 500) }, req.usuario.id);
  });
  app.post<{ Params: { ref: string } }>('/api/conferencia/:ref/desmarcar', { preHandler: exigirLogin }, async (req) => {
    const i = lerItemConf((req.body ?? {}) as Record<string, unknown>);
    ops.desmarcarConferencia(lerRef(req.params.ref), i.clienteId, i.frota, req.usuario.id);
    return { ok: true };
  });

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
    const clienteTexto = texto(b.clienteNome, 'cliente', 200);
    const id = repo.criarSolicitacao({ criadaPor: req.usuario.id, paraUsuario: para, data, clienteId, clienteTexto, titulo, texto: msg });
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

  const envio = servicoEnvio(db, repo, opcoes.pastaDados ?? '/dados', opcoes.carteiro ?? carteiroReal, opcoes.esperaCopiaMs);
  const SEM_CONTA = 'O e-mail da empresa ainda não foi configurado no servidor. Nenhum e-mail foi enviado.';
  const remetente = () => ops.lerConfig()['email.remetente'];

  const monitor = monitorCaixa(db, repo, () => lerConta(opcoes.pastaDados ?? '/dados'), (m) => app.log.warn(m));
  if (opcoes.monitorar) {
    const parar = monitor.iniciar(5);
    app.addHook('onClose', async () => parar());
  }

  app.get('/api/envio/situacao', { preHandler: exigirLogin }, async () => ({
    configurado: envio.configurado(),
    conta: envio.contaUsuario(),
    ultimaVerificacao: monitor.ultimaVerificacao(),
  }));
  // olha a caixa de entrada agora (devoluções e confirmações de leitura)
  app.post('/api/envios/verificar', { preHandler: exigirFinanceiro }, async () => {
    const r = await monitor.verificar();
    if (r.erro) throw new Conflito(`Não conseguiu abrir a caixa de entrada do e-mail: ${r.erro}`);
    return { lidas: r.lidas, atualizados: r.atualizados, ultimaVerificacao: monitor.ultimaVerificacao() };
  });

  const lerAnexos = (v: unknown): Anexo[] => {
    if (!Array.isArray(v) || v.length < 1 || v.length > 4) throw new Invalido('Envie a fatura e o boleto em PDF.');
    let total = 0;
    return v.map((a: Record<string, unknown>) => {
      const nome = texto(a?.nome, 'nome do arquivo', 200);
      if (!/\.pdf$/i.test(nome)) throw new Invalido(`O arquivo "${nome}" não é PDF.`);
      const conteudo = Buffer.from(typeof a.base64 === 'string' ? a.base64 : '', 'base64');
      if (conteudo.subarray(0, 4).toString('latin1') !== '%PDF') throw new Invalido(`O arquivo "${nome}" não parece ser um PDF válido.`);
      total += conteudo.length;
      if (total > 25 * 1024 * 1024) throw new Invalido('Os anexos passam de 25 MB, o limite do e-mail.');
      return { nome, conteudo };
    });
  };
  const lerPedido = (b: Record<string, unknown>) => {
    const referencia = typeof b.referencia === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(b.referencia) ? b.referencia : invalido('Mês de referência inválido.');
    const numero = texto(b.numero, 'número da fatura', 30);
    if (!numero) throw new Invalido('Informe o número da fatura.');
    const assunto = texto(b.assunto, 'assunto', 300);
    if (!assunto) throw new Invalido('O e-mail está sem assunto.');
    const corpo = texto(b.corpo, 'texto do e-mail', 20000);
    const dataFaturamento = lerDataIso(b.dataFaturamento, 'Data de faturamento') ?? null;
    if (dataFaturamento && !dataFaturamento.startsWith(referencia)) throw new Invalido('A data de faturamento não é do mês de referência.');
    return { referencia: referencia as string, numero, assunto, corpo, anexos: lerAnexos(b.anexos), pediuLeitura: b.pediuLeitura === true, observacao: texto(b.observacao, 'observação', 2000), dataFaturamento };
  };
  const limite = { bodyLimit: 40 * 1024 * 1024 };

  app.post('/api/envios', { preHandler: exigirFinanceiro, ...limite }, async (req, reply) => {
    if (!envio.configurado()) return reply.code(503).send({ erro: SEM_CONTA });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const p = lerPedido(b);
    const cliente = repo.buscarCliente(typeof b.clienteId === 'string' ? b.clienteId : '');
    if (!cliente.para.length) throw new Invalido(`${cliente.nome} não tem e-mail cadastrado.`);
    const anterior = envio.jaEnviada(p.referencia, p.numero);
    if (anterior && b.repetir !== true) {
      const d = new Date(anterior.enviadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      throw new Conflito(`A fatura ${p.numero} já foi enviada em ${d}. Para mandar de novo, use Reenviar no Histórico.`);
    }
    return envio.enviar({ ...p, cliente }, remetente(), req.usuario.id);
  });

  app.post('/api/envios/teste', { preHandler: exigirFinanceiro, ...limite }, async (req, reply) => {
    if (!envio.configurado()) return reply.code(503).send({ erro: SEM_CONTA });
    const p = lerPedido((req.body ?? {}) as Record<string, unknown>);
    const r = await envio.testar(req.usuario.email, p.assunto, p.corpo, p.anexos, remetente(), p.numero);
    if (!r.ok) return reply.code(502).send({ erro: r.detalhe });
    return r;
  });

  app.post<{ Params: { id: string } }>('/api/envios/:id/copiar', { preHandler: exigirFinanceiro }, async (req, reply) => {
    if (!envio.configurado()) return reply.code(503).send({ erro: SEM_CONTA });
    try {
      return await envio.copiarDeNovo(req.params.id, req.usuario.id);
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      if (m === 'NAO_ACHOU') throw new NaoEncontrado('Envio não encontrado.');
      if (m === 'SEM_MENSAGEM') throw new Conflito('Este envio foi feito antes de o sistema guardar a mensagem, então não dá para gravar a cópia depois. Os próximos já ficam guardados.');
      throw e;
    }
  });

  app.post<{ Params: { id: string } }>('/api/envios/:id/reenviar', { preHandler: exigirFinanceiro }, async (req, reply) => {
    if (!envio.configurado()) return reply.code(503).send({ erro: SEM_CONTA });
    try {
      return await envio.reenviar(req.params.id, remetente(), req.usuario.id);
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      if (m === 'NAO_ACHOU') throw new NaoEncontrado('Envio não encontrado.');
      if (m === 'SEM_ARQUIVOS') throw new Conflito('Os PDFs desse envio não estão guardados no servidor. Carregue a pasta do mês de novo e envie por lá.');
      if (m === 'SEM_EMAIL') throw new Invalido('O cliente está sem e-mail no cadastro.');
      throw e;
    }
  });

  return app;
}
