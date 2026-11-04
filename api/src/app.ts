import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { Conflito, NaoEncontrado, repositorio, type Banco, type ClienteInput, type Frota, type Usuario } from './db.js';
import { CONFIG_PADRAO, Conflito2, operacoes, type NovaMov, type TipoMov } from './operacoes.js';
import { monitorCaixa } from './monitor.js';
import { agendarCopias, listarCopias } from './backup.js';
import { createReadStream } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as juntarCaminho } from 'node:path';
import { carteiroReal, lerConta, servicoEnvio, type Anexo, type Carteiro } from './envio.js';
import { conferirSenha, gerarHash, hashToken, novoToken, problemaSenha } from './senha.js';
import { CAMPOS_VALOR, DadoInvalido, equipamentos as tabelaEquipamentos, lerDados, normalizarFrota, type Equipamento, type NovaPeca, type PecaHistorico } from './equipamentos.js';
import { CHECKLISTS, STATUS_OS, TIPOS_OS, ordens as tabelaOrdens, type ItemChecklist, type Local, type Ordem, type TipoOS } from './ordens.js';
import { manutencao as tabelaManutencao, validarPerifericos, validarTipos } from './manutencao.js';
import { PERIFERICOS, type Periferico } from './equipamentos.js';
import { ABAS, normalizarPermissoes, perfis as tabelaPerfis, type Aba, type Acesso, type Nivel } from './permissoes.js';

const COOKIE = 'sessao';
const VALIDADE_DIAS = 30;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

declare module 'fastify' {
  interface FastifyRequest {
    usuario: Usuario;
    acesso: Acesso;
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

/** "Técnico de campo" → "tecnico-de-campo" (id de perfil criado na tela) */
const semAcentoId = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

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
    if (o.fim !== undefined) f.fim = lerDataIso(o.fim, 'Término da locação') ?? null;
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
    semBoleto: b.semBoleto === undefined ? undefined : b.semBoleto === true,
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
    if (err instanceof Invalido || err instanceof DadoInvalido) return reply.code(400).send({ erro: err.message });
    if (err instanceof NaoEncontrado) return reply.code(404).send({ erro: err.message });
    if (err instanceof Conflito || err instanceof Conflito2) return reply.code(409).send({ erro: err.message });
    if (err instanceof SemPermissao) return reply.code(403).send({ erro: err.message });
    if ((err as { statusCode?: number }).statusCode && (err as { statusCode: number }).statusCode < 500) {
      return reply.code((err as { statusCode: number }).statusCode).send({ erro: 'Requisição inválida.' });
    }
    app.log.error(err);
    return reply.code(500).send({ erro: 'Erro no servidor.' });
  });

  const perfis = tabelaPerfis(db);
  const exigirLogin = async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies[COOKIE];
    const u = token ? repo.usuarioDaSessao(hashToken(token)) : undefined;
    if (!u) return reply.code(401).send({ erro: 'Faça login.' });
    req.usuario = u;
    req.acesso = perfis.acessoDe(u.perfil);
  };
  const pode = (req: FastifyRequest, aba: Aba, n: Nivel = 1) => (req.acesso?.permissoes[aba] ?? 0) >= n;
  const SEM_PERMISSAO = 'Seu usuário não tem permissão para isso. Fale com o administrador do sistema.';
  /** Exige login e um nível mínimo em pelo menos uma das abas. */
  const exigir =
    (n: Nivel, ...abas: Aba[]) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      await exigirLogin(req, reply);
      if (reply.sent) return;
      if (!abas.some((a) => pode(req, a, n))) return reply.code(403).send({ erro: SEM_PERMISSAO });
    };
  /** quem aprova alterações de outros (movimentações e cadastro) */
  const aprova = (req: FastifyRequest) => pode(req, 'aprovacoes', 2);
  /** valor de cada frota: quem vê valores, ou quem confere frotas e valores no fim do mês */
  const veValorDaFrota = (req: FastifyRequest) => req.acesso.veValores || pode(req, 'conferencia', 1);
  void SemPermissao;

  const sessao = (u: Usuario, a: Acesso) => ({ id: u.id, email: u.email, nome: u.nome, chamar: u.chamar, perfil: u.perfil, perfilNome: a.perfilNome, permissoes: a.permissoes, veValores: a.veValores });

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
    return sessao(u, perfis.acessoDe(u.perfil));
  });

  app.get('/api/sessao', { preHandler: exigirLogin }, async (req) => sessao(req.usuario, req.acesso));

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
  app.get('/api/clientes', { preHandler: exigirLogin }, async (req) => {
    const l = repo.listarClientes();
    return veValorDaFrota(req) ? l : l.map((c) => ({ ...c, frotas: c.frotas.map((f) => ({ ...f, valor: 0 })) }));
  });

  app.post('/api/clientes', { preHandler: exigir(2, 'clientes') }, async (req, reply) => {
    const c = repo.salvarCliente(lerCliente(req.body), req.usuario.id);
    return reply.code(201).send(c);
  });

  app.put<{ Params: { id: string } }>('/api/clientes/:id', { preHandler: exigir(2, 'clientes') }, async (req) =>
    repo.salvarCliente(lerCliente(req.body, req.params.id), req.usuario.id),
  );

  app.patch<{ Params: { id: string } }>('/api/clientes/:id', { preHandler: exigir(2, 'clientes') }, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (typeof b.ativo !== 'boolean') throw new Invalido('Campo ativo inválido.');
    repo.definirAtivo(req.params.id, b.ativo, req.usuario.id);
    return repo.buscarCliente(req.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/clientes/:id/apelidos', { preHandler: exigir(2, 'clientes', 'envio') }, async (req) => {
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

  app.post('/api/faturamentos', { preHandler: exigir(2, 'envio') }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const data = lerDataIso(b.data, 'Data');
    if (!data || typeof b.clienteId !== 'string') throw new Invalido('Informe cliente e data.');
    repo.marcarFaturado(b.clienteId, data, req.usuario.id);
    return reply.code(201).send({ ok: true });
  });

  app.delete<{ Params: { clienteId: string; data: string } }>('/api/faturamentos/:clienteId/:data', { preHandler: exigir(2, 'envio') }, async (req) => {
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
      fim: lerDataIso(b.fim, 'Término da locação') ?? null,
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
  app.post('/api/movimentacoes', { preHandler: exigir(2, 'movimentacoes') }, async (req, reply) =>
    reply.code(201).send(ops.registrarMovimentacao(lerMov(req.body), req.usuario.id, aprova(req))),
  );
  app.post<{ Params: { id: string } }>('/api/movimentacoes/:id/aprovar', { preHandler: exigir(2, 'aprovacoes') }, async (req) => ops.decidirMovimentacao(req.params.id, req.usuario.id, true));
  app.post<{ Params: { id: string } }>('/api/movimentacoes/:id/recusar', { preHandler: exigir(2, 'aprovacoes') }, async (req) =>
    ops.decidirMovimentacao(req.params.id, req.usuario.id, false, texto((req.body as Record<string, unknown> | undefined)?.motivo, 'motivo', 500)),
  );

  // ---------- propostas (alteração de cadastro feita por operações) ----------
  app.get('/api/propostas', { preHandler: exigirLogin }, async (req) => ops.listarPropostas(aprova(req) ? undefined : req.usuario.id));
  app.post('/api/propostas', { preHandler: exigirLogin }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const id = ops.proporAlteracao(lerCliente(b, typeof b.id === 'string' ? b.id : undefined), req.usuario.id);
    return reply.code(201).send({ id });
  });
  app.post<{ Params: { id: string } }>('/api/propostas/:id/aprovar', { preHandler: exigir(2, 'aprovacoes') }, async (req) => {
    ops.decidirProposta(req.params.id, req.usuario.id, true);
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/api/propostas/:id/recusar', { preHandler: exigir(2, 'aprovacoes') }, async (req) => {
    ops.decidirProposta(req.params.id, req.usuario.id, false, texto((req.body as Record<string, unknown> | undefined)?.motivo, 'motivo', 500));
    return { ok: true };
  });

  // ---------- configurações e registro ----------
  app.get('/api/config', { preHandler: exigirLogin }, async () => ops.lerConfig());
  app.put('/api/config', { preHandler: exigir(2, 'configuracoes') }, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const valores: Record<string, string> = {};
    for (const k of Object.keys(CONFIG_PADRAO)) if (b[k] !== undefined) valores[k] = texto(b[k], k, 5000) || CONFIG_PADRAO[k];
    if (valores['manutencao.tipos']) valores['manutencao.tipos'] = validarTipos(valores['manutencao.tipos']);
    if (valores['manutencao.perifericos']) valores['manutencao.perifericos'] = validarPerifericos(valores['manutencao.perifericos']);
    return ops.salvarConfig(valores, req.usuario.id);
  });
  app.get('/api/registro', { preHandler: exigir(1, 'registro') }, async () => ops.listarLog());

  // ---------- frotas na oficina (financeiro e operações) ----------
  const lerNumFrota = (v: unknown) => {
    const n = texto(v, 'frota', 50).toUpperCase().replace(/^FT[\s-]*/, '');
    if (!n) throw new Invalido('Informe o número da frota.');
    return n;
  };
  app.get('/api/oficina', { preHandler: exigirLogin }, async () => ops.listarOficina());
  app.post('/api/oficina', { preHandler: exigir(2, 'frotas') }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    ops.colocarNaOficina(lerNumFrota(b.frota), texto(b.observacao, 'observação', 300), req.usuario.id);
    return reply.code(201).send(ops.listarOficina());
  });
  app.delete<{ Params: { frota: string } }>('/api/oficina/:frota', { preHandler: exigir(2, 'frotas') }, async (req) => {
    ops.tirarDaOficina(lerNumFrota(req.params.frota), req.usuario.id);
    return ops.listarOficina();
  });

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
  app.post<{ Params: { ref: string } }>('/api/conferencia/:ref', { preHandler: exigir(2, 'conferencia') }, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const status = b.status === 'alterado' ? 'alterado' : b.status === 'ok' ? 'ok' : invalido('Situação inválida.');
    return ops.marcarConferencia({ referencia: lerRef(req.params.ref), ...lerItemConf(b), status: status as 'ok' | 'alterado', observacao: texto(b.observacao, 'observação', 500) }, req.usuario.id);
  });
  app.post<{ Params: { ref: string } }>('/api/conferencia/:ref/desmarcar', { preHandler: exigir(2, 'conferencia') }, async (req) => {
    const i = lerItemConf((req.body ?? {}) as Record<string, unknown>);
    ops.desmarcarConferencia(lerRef(req.params.ref), i.clienteId, i.frota, req.usuario.id);
    return { ok: true };
  });

  // ---------- equipamentos (ficha de cada frota) e histórico de peças ----------
  const equip = tabelaEquipamentos(db);
  const semValoresEquip = (req: FastifyRequest, e: Equipamento): Equipamento => {
    if (req.acesso.veValores) return e;
    const c = { ...e };
    for (const k of CAMPOS_VALOR) delete c[k];
    return c;
  };
  const semValoresPeca = (req: FastifyRequest, p: PecaHistorico): PecaHistorico => (req.acesso.veValores ? p : { ...p, valorUnitario: 0, valorTotal: 0 });
  const lerFrotaParam = (v: unknown) => {
    const f = normalizarFrota(v);
    if (!f || f.length > 20) throw new Invalido('Frota inválida.');
    return f;
  };

  app.get('/api/equipamentos', { preHandler: exigir(1, 'frotas') }, async (req) => equip.listar().map((e) => semValoresEquip(req, e)));

  app.put<{ Params: { frota: string } }>('/api/equipamentos/:frota', { preHandler: exigir(2, 'frotas') }, async (req) => {
    const frota = lerFrotaParam(req.params.frota);
    const dados = lerDados((req.body as Record<string, unknown> | undefined)?.dados);
    if (!req.acesso.veValores) for (const k of CAMPOS_VALOR) delete dados[k];
    const r = equip.salvar(frota, dados, req.usuario.id);
    if (r.mudou.length) repo.registrarLog('', req.usuario.id, `${r.novo ? 'criou' : 'editou'} a ficha da FT${frota}: ${r.mudou.join(', ')}`, null, null, 'equipamento');
    return semValoresEquip(req, r.equipamento);
  });

  app.post('/api/equipamentos/importar', { preHandler: exigir(2, 'frotas'), bodyLimit: 5 * 1024 * 1024 }, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!Array.isArray(b.equipamentos) || b.equipamentos.length > 3000) throw new Invalido('Lista de equipamentos inválida.');
    const lista = b.equipamentos.map((x: Record<string, unknown>) => ({ frota: lerFrotaParam(x?.frota), dados: lerDados(x?.dados) }));
    if (!req.acesso.veValores) for (const l of lista) for (const k of CAMPOS_VALOR) delete l.dados[k];
    const r = equip.importar(lista, req.usuario.id);
    repo.registrarLog('', req.usuario.id, `importou a planilha de equipamentos: ${r.novos} novos, ${r.atualizados} atualizados`, null, null, 'equipamento');
    return r;
  });

  app.get<{ Params: { frota: string } }>('/api/equipamentos/:frota/historico', { preHandler: exigir(1, 'frotas') }, async (req) =>
    equip.historicoDaFrota(lerFrotaParam(req.params.frota)).map((p) => semValoresPeca(req, p)),
  );

  app.get<{ Querystring: { q?: string; frota?: string } }>('/api/historico-pecas', { preHandler: exigir(1, 'frotas') }, async (req) => {
    const q = texto(req.query.q, 'busca', 200);
    const frota = req.query.frota ? lerFrotaParam(req.query.frota) : null;
    if (!q && !frota) throw new Invalido('Digite o que procurar.');
    return equip.buscarHistorico(q, frota).map((p) => semValoresPeca(req, p));
  });

  app.get<{ Querystring: { desde?: string } }>('/api/historico-pecas/por-frota', { preHandler: exigir(1, 'frotas') }, async (req) => {
    const desde = lerDataIso(req.query.desde, 'Data inicial') ?? '0000-01-01';
    const l = equip.gastosPorFrota(desde);
    return req.acesso.veValores ? l : l.map((x) => ({ ...x, total: 0 }));
  });

  app.get('/api/historico-pecas/resumo', { preHandler: exigir(1, 'frotas') }, async () => equip.resumoHistorico());

  const lerPeca = (x: Record<string, unknown>, i: number): NovaPeca => {
    const data = lerDataIso(x?.data, `Data (linha ${i + 1})`);
    if (!data) throw new Invalido(`Linha ${i + 1} sem data.`);
    const num = (v: unknown, campo: string, inteiro: boolean) => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      if (!Number.isFinite(n) || Math.abs(n) > 1e12) throw new Invalido(`${campo} inválido na linha ${i + 1}.`);
      return inteiro ? Math.round(n) : n;
    };
    const frota = x.frota ? normalizarFrota(x.frota) : '';
    return {
      data,
      frota: frota && frota.length <= 20 ? frota : null,
      ativo: texto(x.ativo, 'ativo', 60),
      cliente: texto(x.cliente, 'cliente', 200),
      tecnico: texto(x.tecnico, 'técnico', 100),
      pendencia: texto(x.pendencia, 'pendência', 2000),
      codigo: texto(x.codigo, 'código', 100),
      descricao: texto(x.descricao, 'descrição', 500),
      quantidade: num(x.quantidade, 'Quantidade', false) ?? 1,
      valorUnitario: num(x.valorUnitario, 'Valor', true) ?? 0,
      valorTotal: num(x.valorTotal, 'Valor', true) ?? 0,
      horimetro: num(x.horimetro, 'Horímetro', false),
      origem: 'auvo',
    };
  };

  app.post('/api/historico-pecas/importar', { preHandler: exigir(2, 'frotas'), bodyLimit: 30 * 1024 * 1024 }, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!Array.isArray(b.linhas) || b.linhas.length > 100_000) throw new Invalido('Histórico inválido.');
    const linhas = b.linhas.map((x: Record<string, unknown>, i: number) => lerPeca(x ?? {}, i));
    const r = equip.substituirHistorico('auvo', linhas);
    repo.registrarLog('', req.usuario.id, `importou o histórico do Auvo: ${r.linhas} linhas (substituiu o anterior)`, null, null, 'equipamento');
    return r;
  });

  // ---------- painel de manutenção: pendências e visitas ----------
  const manut = tabelaManutencao(db, () => ops.lerConfig());
  const lerPendencia = (x: Record<string, unknown>, i?: number) => {
    const onde = i === undefined ? '' : ` (linha ${i + 1})`;
    const frota = lerFrotaParam(x?.frota);
    const descricao = texto(x?.descricao, 'descrição', 2000);
    if (!descricao) throw new Invalido(`Descreva a pendência${onde}.`);
    return {
      frota,
      cliente: texto(x.cliente, 'cliente', 200),
      abertaEm: lerDataIso(x.abertaEm, `Data${onde}`) ?? new Date().toISOString().slice(0, 10),
      tecnico: texto(x.tecnico, 'técnico', 100),
      descricao,
    };
  };

  app.get<{ Querystring: { todas?: string } }>('/api/pendencias', { preHandler: exigir(1, 'manutencao', 'frotas') }, async (req) => manut.listarPendencias(req.query.todas === '1'));

  app.post('/api/pendencias', { preHandler: exigir(2, 'manutencao') }, async (req, reply) => {
    const p = manut.criarPendencia(lerPendencia((req.body ?? {}) as Record<string, unknown>), req.usuario.id);
    repo.registrarLog('', req.usuario.id, `abriu pendência na FT${p.frota}: ${p.descricao}`, null, null, 'manutencao');
    return reply.code(201).send(p);
  });

  for (const acao of ['resolver', 'reabrir'] as const)
    app.post<{ Params: { id: string } }>(`/api/pendencias/:id/${acao}`, { preHandler: exigir(2, 'manutencao') }, async (req) => {
      const resolucao = texto((req.body as Record<string, unknown> | undefined)?.resolucao, 'o que foi feito', 2000);
      const p = manut.resolverPendencia(Number(req.params.id), acao === 'resolver', resolucao, req.usuario.id);
      if (!p) throw new NaoEncontrado('Pendência não encontrada.');
      repo.registrarLog('', req.usuario.id, `${acao === 'resolver' ? 'resolveu' : 'reabriu'} pendência na FT${p.frota}: ${p.descricao}${resolucao ? ` → ${resolucao}` : ''}`, null, null, 'manutencao');
      return p;
    });

  app.post('/api/pendencias/importar', { preHandler: exigir(2, 'manutencao', 'frotas'), bodyLimit: 2 * 1024 * 1024 }, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!Array.isArray(b.pendencias) || b.pendencias.length > 5000) throw new Invalido('Lista de pendências inválida.');
    const r = manut.importarPendencias(b.pendencias.map((x: Record<string, unknown>, i: number) => lerPendencia(x ?? {}, i)));
    repo.registrarLog('', req.usuario.id, `importou ${r.abertas} pendências da planilha`, null, null, 'manutencao');
    return r;
  });

  app.post<{ Params: { frota: string } }>('/api/equipamentos/:frota/visita', { preHandler: exigir(2, 'manutencao') }, async (req) => {
    const frota = lerFrotaParam(req.params.frota);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const data = lerDataIso(b.data, 'Data da visita');
    if (!data) throw new Invalido('Informe a data da visita.');
    if (data > new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)) throw new Invalido('A data da visita está no futuro.');
    const num = (v: unknown, campo: string) => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw new Invalido(`${campo} inválido.`);
      return Math.round(n * 10) / 10;
    };
    const perifericos = Array.isArray(b.perifericos) ? b.perifericos.filter((p): p is Periferico => PERIFERICOS.includes(p as Periferico)) : [];
    const r = manut.registrarVisita(
      frota,
      {
        data,
        horimetro: num(b.horimetro, 'Horímetro'),
        tipo: texto(b.tipo, 'tipo', 10).toUpperCase(),
        tecnico: texto(b.tecnico, 'técnico', 100),
        cliente: texto(b.cliente, 'cliente', 200),
        proximaPreventiva: num(b.proximaPreventiva, 'Próxima preventiva'),
        perifericos,
        observacao: texto(b.observacao, 'observação', 2000),
      },
      req.usuario.id,
    );
    repo.registrarLog('', req.usuario.id, `registrou visita ${r.tipo.sigla} na FT${frota} em ${data}${perifericos.length ? ` (trocou ${perifericos.length} periférico${perifericos.length > 1 ? 's' : ''})` : ''}`, null, null, 'manutencao');
    return semValoresEquip(req, r.equipamento);
  });

  // ---------- ordens de serviço ----------
  const os = tabelaOrdens(db, opcoes.pastaDados ?? '/dados', () => manut.regras().perifericos);
  /** escritório: abre, agenda, encerra */
  const gerenciaOS = (req: FastifyRequest) => pode(req, 'ordens', 2) && pode(req, 'manutencao', 2);
  /** técnico vê só as OS dele; escritório e quem só consulta veem todas */
  const soAsMinhas = (req: FastifyRequest) => pode(req, 'ordens', 2) && !pode(req, 'manutencao', 2);
  const verOS = (req: FastifyRequest, o: Ordem) => {
    if (soAsMinhas(req) && o.tecnicoId !== req.usuario.id) throw new SemPermissao('Esta OS não é sua.');
    return o;
  };
  const executaOS = (req: FastifyRequest, id: string) => {
    const o = os.buscar(id);
    if (gerenciaOS(req) || (pode(req, 'ordens', 2) && o.tecnicoId === req.usuario.id)) return o;
    throw new SemPermissao('Só o técnico da OS ou o escritório podem mexer nela.');
  };
  const exigirGerencia = async (req: FastifyRequest, reply: FastifyReply) => {
    await exigir(2, 'ordens')(req, reply);
    if (reply.sent) return;
    if (!gerenciaOS(req)) return reply.code(403).send({ erro: 'Só o escritório (quem edita o Painel de manutenção) abre, agenda e encerra OS.' });
  };
  const lerLocal = (v: unknown): Local => {
    const o = (v ?? {}) as Record<string, unknown>;
    const n = (x: unknown, min: number, max: number) => (typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max ? x : null);
    return { em: new Date().toISOString(), lat: n(o.lat, -90, 90), lng: n(o.lng, -180, 180), precisao: n(o.precisao, 0, 100000) };
  };
  const lerTecnico = (v: unknown) => {
    if (v === null || v === undefined || v === '') return null;
    const id = Number(v);
    const u = Number.isInteger(id) ? repo.buscarUsuario(id) : undefined;
    if (!u || !u.ativo) throw new Invalido('Técnico não encontrado.');
    return id;
  };
  const logOS = (req: FastifyRequest, o: Ordem, acao: string) => repo.registrarLog(o.clienteId ?? '', req.usuario.id, `OS ${o.numero} (FT${o.frota}): ${acao}`, null, null, 'ordem');

  app.get('/api/ordens/config', { preHandler: exigir(1, 'ordens') }, async () => ({ tipos: TIPOS_OS, status: STATUS_OS, checklists: CHECKLISTS }));

  app.get('/api/ordens/tecnicos', { preHandler: exigir(1, 'ordens') }, async () =>
    repo
      .listarUsuarios()
      .filter((u) => u.ativo && perfis.acessoDe(u.perfil).permissoes.ordens === 2)
      .map((u) => ({ id: u.id, nome: u.nome, chamar: u.chamar, escritorio: perfis.acessoDe(u.perfil).permissoes.manutencao === 2 })),
  );

  app.get<{ Querystring: { abertas?: string } }>('/api/ordens', { preHandler: exigir(1, 'ordens') }, async (req) =>
    os.listar({ tecnicoId: soAsMinhas(req) ? req.usuario.id : undefined, abertas: req.query.abertas === '1' }),
  );
  app.get<{ Params: { id: string } }>('/api/ordens/:id', { preHandler: exigir(1, 'ordens') }, async (req) => verOS(req, os.buscar(req.params.id)));

  app.post('/api/ordens', { preHandler: exigirGerencia }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const tipo = (Object.keys(TIPOS_OS).includes(b.tipo as string) ? b.tipo : invalido('Escolha o tipo de OS.')) as TipoOS;
    const frota = lerFrotaParam(b.frota);
    const clienteId = typeof b.clienteId === 'string' && b.clienteId ? b.clienteId : null;
    const cliente = clienteId ? repo.buscarCliente(clienteId) : null;
    const pendenciaId = b.pendenciaId ? Number(b.pendenciaId) : null;
    if (pendenciaId !== null && !manut.buscarPendencia(pendenciaId)) throw new Invalido('Pendência não encontrada.');
    const o = os.criar(
      {
        frota,
        clienteId,
        clienteNome: cliente?.nome ?? texto(b.clienteNome, 'cliente', 200),
        tipo,
        tipoVisita: texto(b.tipoVisita, 'tipo de visita', 10).toUpperCase(),
        tecnicoId: lerTecnico(b.tecnicoId),
        agendadaPara: lerDataIso(b.agendadaPara, 'Data') ?? null,
        descricao: texto(b.descricao, 'descrição', 4000),
        pendenciaId,
      },
      req.usuario.id,
    );
    logOS(req, o, `abriu (${TIPOS_OS[o.tipo]})${o.tecnicoNome ? ` para ${o.tecnicoNome}` : ''}`);
    return reply.code(201).send(o);
  });

  app.patch<{ Params: { id: string } }>('/api/ordens/:id', { preHandler: exigirGerencia }, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const o = os.alterar(req.params.id, {
      tecnicoId: b.tecnicoId === undefined ? undefined : lerTecnico(b.tecnicoId),
      agendadaPara: b.agendadaPara === undefined ? undefined : (lerDataIso(b.agendadaPara, 'Data') ?? null),
      descricao: b.descricao === undefined ? undefined : texto(b.descricao, 'descrição', 4000),
      tipoVisita: b.tipoVisita === undefined ? undefined : texto(b.tipoVisita, 'tipo de visita', 10).toUpperCase(),
    });
    logOS(req, o, `alterou${o.tecnicoNome ? ` (técnico ${o.tecnicoNome}${o.agendadaPara ? `, dia ${o.agendadaPara}` : ''})` : ''}`);
    return o;
  });

  app.post<{ Params: { id: string } }>('/api/ordens/:id/checkin', { preHandler: exigir(2, 'ordens') }, async (req) => {
    executaOS(req, req.params.id);
    const o = os.checkin(req.params.id, lerLocal(req.body));
    logOS(req, o, 'check-in no local');
    return o;
  });

  const lerChecklist = (v: unknown): ItemChecklist[] | undefined => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.length > 60) throw new Invalido('Checklist inválido.');
    return v.map((x: Record<string, unknown>) => ({
      item: texto(x?.item, 'item', 120),
      resposta: (['ok', 'problema', 'na', ''].includes(x?.resposta as string) ? x.resposta : '') as ItemChecklist['resposta'],
      obs: texto(x?.obs, 'observação', 500),
    }));
  };
  app.put<{ Params: { id: string } }>('/api/ordens/:id/execucao', { preHandler: exigir(2, 'ordens') }, async (req) => {
    executaOS(req, req.params.id);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const h = b.horimetro;
    const horimetro = h === undefined ? undefined : h === null || h === '' ? null : Number(h);
    if (horimetro !== undefined && horimetro !== null && (!Number.isFinite(horimetro) || horimetro < 0 || horimetro > 1_000_000)) throw new Invalido('Horímetro inválido.');
    const pecas =
      b.pecas === undefined
        ? undefined
        : Array.isArray(b.pecas) && b.pecas.length <= 100
          ? b.pecas.map((x: Record<string, unknown>) => {
              const q = Number(x?.quantidade ?? 1);
              return { codigo: texto(x?.codigo, 'código', 60), descricao: texto(x?.descricao, 'peça', 200), quantidade: Number.isFinite(q) && q > 0 && q < 10000 ? q : 1 };
            })
          : invalido('Lista de peças inválida.');
    const perifericos = b.perifericos === undefined ? undefined : Array.isArray(b.perifericos) ? b.perifericos.filter((p): p is Periferico => PERIFERICOS.includes(p as Periferico)) : [];
    return os.salvar(
      req.params.id,
      {
        horimetro,
        checklist: lerChecklist(b.checklist),
        servico: b.servico === undefined ? undefined : texto(b.servico, 'o que foi feito', 4000),
        pecas: pecas as { codigo: string; descricao: string; quantidade: number }[] | undefined,
        perifericos,
        assinadoPor: b.assinadoPor === undefined ? undefined : texto(b.assinadoPor, 'nome de quem assinou', 120),
        semAssinatura: b.semAssinatura === undefined ? undefined : texto(b.semAssinatura, 'motivo', 300),
      },
      typeof b.aguardandoPeca === 'boolean' ? b.aguardandoPeca : undefined,
    );
  });

  const lerImagem = (v: unknown, tipos: ('jpg' | 'png')[]) => {
    const buf = Buffer.from(typeof v === 'string' ? v.replace(/^data:image\/\w+;base64,/, '') : '', 'base64');
    const png = buf.subarray(0, 4).toString('hex') === '89504e47';
    const jpg = buf.subarray(0, 3).toString('hex') === 'ffd8ff';
    const ext = png ? 'png' : jpg ? 'jpg' : null;
    if (!ext || !tipos.includes(ext)) throw new Invalido('A imagem precisa ser JPG ou PNG.');
    if (buf.length > 6 * 1024 * 1024) throw new Invalido('Imagem grande demais (máximo 6 MB).');
    return { buf, ext: ext as 'jpg' | 'png' };
  };
  app.post<{ Params: { id: string } }>('/api/ordens/:id/fotos', { preHandler: exigir(2, 'ordens'), bodyLimit: 9 * 1024 * 1024 }, async (req) => {
    executaOS(req, req.params.id);
    const { buf, ext } = lerImagem((req.body as Record<string, unknown> | undefined)?.imagem, ['jpg', 'png']);
    return os.adicionarFoto(req.params.id, buf, ext);
  });
  app.delete<{ Params: { id: string; nome: string } }>('/api/ordens/:id/fotos/:nome', { preHandler: exigir(2, 'ordens') }, async (req) => {
    executaOS(req, req.params.id);
    return os.tirarFoto(req.params.id, req.params.nome);
  });
  app.post<{ Params: { id: string } }>('/api/ordens/:id/assinatura', { preHandler: exigir(2, 'ordens'), bodyLimit: 3 * 1024 * 1024 }, async (req) => {
    executaOS(req, req.params.id);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const nome = texto(b.nome, 'nome de quem assinou', 120);
    if (!nome) throw new Invalido('Escreva o nome de quem assinou.');
    const { buf } = lerImagem(b.imagem, ['png']);
    return os.assinar(req.params.id, buf, nome);
  });
  app.get<{ Params: { id: string; nome: string } }>('/api/ordens/:id/arquivos/:nome', { preHandler: exigir(1, 'ordens') }, async (req, reply) => {
    verOS(req, os.buscar(req.params.id));
    const caminho = os.caminhoArquivo(req.params.id, req.params.nome);
    reply.header('Content-Type', caminho.endsWith('.png') ? 'image/png' : 'image/jpeg').header('Cache-Control', 'private, max-age=86400');
    return reply.send(createReadStream(caminho));
  });

  app.post<{ Params: { id: string } }>('/api/ordens/:id/concluir', { preHandler: exigir(2, 'ordens') }, async (req) => {
    executaOS(req, req.params.id);
    const o = os.concluir(req.params.id, lerLocal(req.body));
    logOS(req, o, 'técnico concluiu');
    return o;
  });
  app.post<{ Params: { id: string } }>('/api/ordens/:id/devolver', { preHandler: exigirGerencia }, async (req) => {
    const o = os.devolver(req.params.id);
    logOS(req, o, 'devolveu ao técnico para corrigir');
    return o;
  });
  app.post<{ Params: { id: string } }>('/api/ordens/:id/cancelar', { preHandler: exigirGerencia }, async (req) => {
    const motivo = texto((req.body as Record<string, unknown> | undefined)?.motivo, 'motivo', 500);
    if (!motivo) throw new Invalido('Diga por que a OS foi cancelada.');
    const o = os.cancelar(req.params.id, motivo);
    logOS(req, o, `cancelou: ${motivo}`);
    return o;
  });

  /** Manda o relatório (PDF feito na tela) para o cliente, pelo e-mail da empresa. */
  const enviarRelatorio = async (req: FastifyRequest, o: Ordem, b: Record<string, unknown>) => {
    if (!envio.configurado()) return { enviado: false, detalhe: SEM_CONTA };
    const pdf = Buffer.from(typeof b.pdf === 'string' ? b.pdf : '', 'base64');
    if (pdf.subarray(0, 4).toString('latin1') !== '%PDF') throw new Invalido('O relatório em PDF não veio.');
    if (pdf.length > 20 * 1024 * 1024) throw new Invalido('O relatório passou de 20 MB.');
    const cliente = o.clienteId ? repo.buscarCliente(o.clienteId) : null;
    const para = b.para !== undefined ? listaEmails(b.para, 'para') : (cliente?.para ?? []);
    const cc = b.para !== undefined ? [] : (cliente?.cc ?? []);
    if (!para.length) throw new Invalido('O cliente não tem e-mail no cadastro. Informe para quem enviar.');
    const r = await envio.enviarAvulso({
      para,
      cc,
      assunto: `Relatório da ordem de serviço nº ${o.numero} · FT${o.frota} · Lucminas Empilhadeiras`,
      corpo: `Prezados,\n\nSegue em anexo o relatório da ordem de serviço nº ${o.numero} (${TIPOS_OS[o.tipo].toLowerCase()}) da empilhadeira FT${o.frota}.\n\nEm caso de dúvida, é só responder este e-mail.\n\nAtenciosamente,\nLucminas Empilhadeiras`,
      anexos: [{ nome: `OS ${o.numero} FT${o.frota}.pdf`, conteudo: pdf }],
      remetente: remetente(),
      referencia: `OS ${o.numero}`,
    });
    if (r.ok) {
      os.registrarRelatorio(o.id, [...para, ...cc]);
      logOS(req, o, `relatório enviado para ${[...para, ...cc].join(', ')}`);
    }
    return { enviado: r.ok, detalhe: r.detalhe };
  };

  app.post<{ Params: { id: string } }>('/api/ordens/:id/encerrar', { preHandler: exigirGerencia, bodyLimit: 30 * 1024 * 1024 }, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const prox = b.proximaPreventiva === null || b.proximaPreventiva === undefined || b.proximaPreventiva === '' ? null : Number(b.proximaPreventiva);
    if (prox !== null && (!Number.isFinite(prox) || prox < 0)) throw new Invalido('Próxima preventiva inválida.');
    let o = os.encerrar(req.params.id, req.usuario.id, { proximaPreventiva: prox });
    logOS(req, o, 'encerrou (ficha e histórico atualizados)');
    let relatorio: { enviado: boolean; detalhe: string } | null = null;
    if (b.enviar === true) {
      try {
        relatorio = await enviarRelatorio(req, o, b);
      } catch (e) {
        relatorio = { enviado: false, detalhe: e instanceof Error ? e.message : 'Não foi possível enviar.' };
      }
      o = os.buscar(o.id);
    }
    return { ordem: o, relatorio };
  });

  app.post<{ Params: { id: string } }>('/api/ordens/:id/relatorio', { preHandler: exigirGerencia, bodyLimit: 30 * 1024 * 1024 }, async (req) => {
    const o = os.buscar(req.params.id);
    if (o.status !== 'encerrada' && o.status !== 'concluida') throw new Invalido('O relatório só sai depois que o técnico conclui a OS.');
    const r = await enviarRelatorio(req, o, (req.body ?? {}) as Record<string, unknown>);
    return { ordem: os.buscar(o.id), relatorio: r };
  });

  // ---------- usuários e permissões (administração) ----------
  /** Garante que sempre sobra alguém ativo que consegue administrar usuários. Roda dentro da transação da mudança. */
  const conferirAdministrador = () => {
    const sobra = repo.listarUsuarios().some((u) => u.ativo && perfis.acessoDe(u.perfil).permissoes.usuarios === 2);
    if (!sobra) throw new Invalido('Essa mudança deixaria o sistema sem ninguém para administrar usuários. Mantenha pelo menos um administrador ativo.');
  };
  const logUsuarios = (req: FastifyRequest, acao: string, antes: unknown = null, depois: unknown = null) => repo.registrarLog('', req.usuario.id, acao, antes, depois, 'usuarios');
  const lerPerfilCorpo = (b: Record<string, unknown>) => {
    const nome = texto(b.nome, 'nome do perfil', 60);
    if (!nome) throw new Invalido('Dê um nome ao perfil.');
    return { nome, descricao: texto(b.descricao, 'descrição', 300), permissoes: normalizarPermissoes(b.permissoes), veValores: b.veValores === true };
  };

  app.get('/api/perfis', { preHandler: exigir(1, 'usuarios') }, async () => ({ abas: ABAS, perfis: perfis.listar() }));

  app.post('/api/perfis', { preHandler: exigir(2, 'usuarios') }, async (req, reply) => {
    const d = lerPerfilCorpo((req.body ?? {}) as Record<string, unknown>);
    const base = semAcentoId(d.nome) || 'perfil';
    let id = base;
    for (let i = 2; perfis.buscar(id); i++) id = `${base}-${i}`;
    const p = perfis.criar(id, d);
    logUsuarios(req, `criou o perfil ${p.nome}`, null, p);
    return reply.code(201).send(p);
  });

  app.put<{ Params: { id: string } }>('/api/perfis/:id', { preHandler: exigir(2, 'usuarios') }, async (req) => {
    const antes = perfis.buscar(req.params.id);
    if (!antes) throw new NaoEncontrado('Perfil não encontrado.');
    const d = lerPerfilCorpo((req.body ?? {}) as Record<string, unknown>);
    const p = db.transaction(() => {
      const salvo = perfis.salvar(req.params.id, d);
      conferirAdministrador();
      return salvo;
    })();
    logUsuarios(req, `alterou as permissões do perfil ${p.nome}`, antes, p);
    return p;
  });

  app.delete<{ Params: { id: string } }>('/api/perfis/:id', { preHandler: exigir(2, 'usuarios') }, async (req) => {
    const p = perfis.buscar(req.params.id);
    if (!p) throw new NaoEncontrado('Perfil não encontrado.');
    if (p.padrao) throw new Invalido('Os perfis que vêm com o sistema não podem ser apagados. Ajuste as permissões dele.');
    const usando = repo.listarUsuarios().filter((u) => u.perfil === p.id);
    if (usando.length) throw new Invalido(`Ainda há ${usando.length} pessoa(s) com esse perfil: ${usando.map((u) => u.nome).join(', ')}. Troque o perfil delas antes.`);
    perfis.apagar(p.id);
    logUsuarios(req, `apagou o perfil ${p.nome}`, p, null);
    return { ok: true };
  });

  app.get('/api/admin/usuarios', { preHandler: exigir(1, 'usuarios') }, async () => repo.listarUsuarios());

  const lerPerfilId = (v: unknown) => {
    const id = texto(v, 'perfil', 60);
    if (!perfis.buscar(id)) throw new Invalido('Escolha um perfil.');
    return id;
  };

  app.post('/api/admin/usuarios', { preHandler: exigir(2, 'usuarios') }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const email = texto(b.email, 'e-mail', 200).toLowerCase();
    if (!EMAIL.test(email)) throw new Invalido('E-mail inválido.');
    if (repo.emailEmUso(email)) throw new Conflito('Já existe um usuário com esse e-mail. Se ele foi desativado, reative na lista.');
    const nome = texto(b.nome, 'nome', 120);
    if (!nome) throw new Invalido('Informe o nome.');
    const senha = typeof b.senha === 'string' ? b.senha : '';
    const problema = problemaSenha(senha);
    if (problema) throw new Invalido(problema);
    const u = repo.criarUsuario(email, nome, await gerarHash(senha), texto(b.chamar, 'como chamar', 40), lerPerfilId(b.perfil));
    logUsuarios(req, `criou o usuário ${u.nome} (${u.email}) com perfil ${perfis.acessoDe(u.perfil).perfilNome}`);
    return reply.code(201).send(repo.buscarUsuario(u.id));
  });

  app.patch<{ Params: { id: string } }>('/api/admin/usuarios/:id', { preHandler: exigir(2, 'usuarios') }, async (req) => {
    const id = Number(req.params.id);
    const antes = repo.buscarUsuario(id);
    if (!antes) throw new NaoEncontrado('Usuário não encontrado.');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const d = {
      nome: b.nome === undefined ? undefined : texto(b.nome, 'nome', 120) || invalido('Informe o nome.'),
      chamar: b.chamar === undefined ? undefined : texto(b.chamar, 'como chamar', 40),
      perfil: b.perfil === undefined ? undefined : lerPerfilId(b.perfil),
      ativo: b.ativo === undefined ? undefined : b.ativo === true,
    };
    let hashNovo: string | null = null;
    if (b.senha !== undefined) {
      const senha = typeof b.senha === 'string' ? b.senha : '';
      const problema = problemaSenha(senha);
      if (problema) throw new Invalido(problema);
      hashNovo = await gerarHash(senha);
    }
    db.transaction(() => {
      repo.alterarUsuario(id, d);
      conferirAdministrador();
      if (hashNovo) repo.definirSenhaPorId(id, hashNovo);
    })();
    const depois = repo.buscarUsuario(id)!;
    const mudou: string[] = [];
    if (d.perfil && d.perfil !== antes.perfil) mudou.push(`perfil ${perfis.acessoDe(antes.perfil).perfilNome} → ${perfis.acessoDe(d.perfil).perfilNome}`);
    if (d.ativo !== undefined && d.ativo !== antes.ativo) mudou.push(d.ativo ? 'reativou' : 'desativou');
    if (d.nome && d.nome !== antes.nome) mudou.push(`nome "${d.nome}"`);
    if (d.chamar !== undefined && d.chamar !== antes.chamar) mudou.push(`saudação "${d.chamar}"`);
    if (hashNovo) mudou.push('definiu uma senha nova');
    if (mudou.length) logUsuarios(req, `usuário ${depois.nome}: ${mudou.join(', ')}`);
    return depois;
  });

  // ---------- cópias de segurança ----------
  if (opcoes.monitorar && opcoes.pastaDados) {
    const parar = agendarCopias(db, opcoes.pastaDados, (m) => app.log.info(m));
    app.addHook('onClose', async () => parar());
  }
  app.get('/api/admin/copias', { preHandler: exigir(2, 'usuarios') }, async () => listarCopias(opcoes.pastaDados ?? '/dados'));
  /** Baixa uma cópia do banco feita agora (para guardar fora do servidor). */
  app.get('/api/admin/copia-agora', { preHandler: exigir(2, 'usuarios') }, async (req, reply) => {
    const pasta = mkdtempSync(juntarCaminho(tmpdir(), 'copia-'));
    const arq = juntarCaminho(pasta, 'faturas.db');
    await db.backup(arq);
    repo.registrarLog('', req.usuario.id, 'baixou uma cópia do banco de dados', null, null, 'usuarios');
    const nome = `lucminas-banco-${new Date().toISOString().slice(0, 10)}.db`;
    reply.header('Content-Type', 'application/octet-stream').header('Content-Disposition', `attachment; filename="${nome}"`);
    const fluxo = createReadStream(arq);
    fluxo.on('close', () => rmSync(pasta, { recursive: true, force: true }));
    return reply.send(fluxo);
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
  app.get('/api/envios', { preHandler: exigir(1, 'envio', 'historico') }, async () => repo.listarEnvios());

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
  app.post('/api/envios/verificar', { preHandler: exigir(2, 'historico', 'envio') }, async () => {
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

  app.post('/api/envios', { preHandler: exigir(2, 'envio'), ...limite }, async (req, reply) => {
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

  app.post('/api/envios/teste', { preHandler: exigir(2, 'envio'), ...limite }, async (req, reply) => {
    if (!envio.configurado()) return reply.code(503).send({ erro: SEM_CONTA });
    const p = lerPedido((req.body ?? {}) as Record<string, unknown>);
    const r = await envio.testar(req.usuario.email, p.assunto, p.corpo, p.anexos, remetente(), p.numero);
    if (!r.ok) return reply.code(502).send({ erro: r.detalhe });
    return r;
  });

  app.post<{ Params: { id: string } }>('/api/envios/:id/copiar', { preHandler: exigir(2, 'historico', 'envio') }, async (req, reply) => {
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

  app.post<{ Params: { id: string } }>('/api/envios/:id/reenviar', { preHandler: exigir(2, 'historico', 'envio') }, async (req, reply) => {
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
