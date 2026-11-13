import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirBanco, repositorio } from './db.js';
import { criarApp } from './app.js';
import { gerarHash } from './senha.js';
import { clienteAutentique, ErroAutentique, type ClienteAutentique, type DocumentoAutentique } from './autentique.js';

const PDF = Buffer.from('%PDF-1.4\n% contrato\n').toString('base64');

describe('cliente da Autentique (HTTP)', () => {
  it('manda o PDF em multipart com os assinantes e lê a resposta; token recusado vira erro claro', async () => {
    const pedidos: { url: string; init: RequestInit }[] = [];
    const falso = (async (url: string, init: RequestInit) => {
      pedidos.push({ url, init });
      return new Response(
        JSON.stringify({ data: { createDocument: { id: 'doc1', signatures: [{ public_id: 'p1', name: 'Ana', email: 'ana@cli.com', action: { name: 'SIGN' }, viewed: null, signed: null, rejected: null }] } } }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const c = clienteAutentique('tok-123', falso);
    const d = await c.criarDocumento({ nome: 'Contrato', mensagem: '', pdf: Buffer.from('%PDF-'), nomeArquivo: 'c.pdf', assinantes: [{ nome: 'Ana', email: 'ana@cli.com', acao: 'SIGN', papel: 'x' }], teste: true });
    expect(d).toMatchObject({ id: 'doc1', assinaturas: [{ publicId: 'p1', email: 'ana@cli.com', assinadoEm: null }] });
    expect((pedidos[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
    const corpo = pedidos[0].init.body as FormData;
    expect(String(corpo.get('operations'))).toContain('sandbox: true');
    expect(JSON.parse(String(corpo.get('operations'))).variables.signers).toEqual([{ email: 'ana@cli.com', action: 'SIGN' }]);
    expect(corpo.get('map')).toBe('{"file":["variables.file"]}');

    const recusa = clienteAutentique('x', (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch);
    await expect(recusa.quemSou()).rejects.toThrow(ErroAutentique);
  });
});

describe('assinatura de contratos pela Autentique', () => {
  let pasta = '';
  let app: ReturnType<typeof criarApp>;
  let cookie = '';
  let doc: DocumentoAutentique;
  const chamadas: string[] = [];
  const falsa: ClienteAutentique = {
    quemSou: async () => ({ nome: 'Lucminas', email: 'contato@lucminas.com.br' }),
    criarDocumento: async (d) => {
      chamadas.push(`criar:${d.teste}:${d.assinantes.map((a) => `${a.acao}/${a.email}`).join(',')}`);
      doc = { id: 'doc-1', arquivoAssinado: null, assinaturas: d.assinantes.map((a, i) => ({ publicId: `p${i}`, nome: a.nome, email: a.email, acao: a.acao, vistoEm: null, assinadoEm: null, recusadoEm: null })) };
      return doc;
    },
    buscarDocumento: async () => doc,
    linkDeAssinatura: async (p) => `https://assina.ae/${p}`,
    reenviar: async (ids) => void chamadas.push(`reenviar:${ids.join(',')}`),
    baixar: async () => Buffer.from('%PDF-1.4 assinado'),
  };
  const req = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as object, headers: { cookie } });

  beforeEach(async () => {
    pasta = mkdtempSync(join(tmpdir(), 'aut-'));
    const db = abrirBanco(':memory:');
    repositorio(db).criarUsuario('admin@lucminas.com.br', 'Júlia', await gerarHash('senha-teste-1'), '', 'admin');
    app = criarApp(db, { cookieSeguro: false, pastaDados: pasta, autentique: () => falsa });
    const r = await app.inject({ method: 'POST', url: '/api/sessao', payload: { email: 'admin@lucminas.com.br', senha: 'senha-teste-1' } });
    cookie = String(r.headers['set-cookie']).split(';')[0];
  });
  afterEach(() => rmSync(pasta, { recursive: true, force: true }));

  it('configura, manda para assinar, acompanha e guarda o PDF assinado quando todos assinam', async () => {
    const c = (await req('POST', '/api/clientes', { nome: 'Metal', para: ['fin@metal.com.br'], cc: [], apelidos: [], cnpj: '', observacoes: '' })).json();
    await req('POST', '/api/movimentacoes', { tipo: 'locacao', frota: '10', clienteId: c.id, data: '2026-01-10', valor: 300000 });
    const envio = { clienteId: c.id, frotas: ['10'], arquivo: PDF, nome: 'contrato.pdf', cliente: { nome: 'Ana', email: 'ana@metal.com.br' }, testemunhaCliente: { nome: 'Bia', email: 'bia@metal.com.br' } };
    // sem token: avisa
    expect((await req('POST', '/api/contratos/assinatura', envio)).statusCode).toBe(400);
    let cfg = await req('PUT', '/api/integracoes/autentique', { token: 'abcdefghijklmnopqrstuvwxyz123456', lucminasNome: 'Arnaldo', lucminasEmail: 'arnaldo@lucminas.com.br', testemunhaNome: 'Júnior', testemunhaEmail: 'locacao@lucminas.com.br' });
    expect(cfg.json()).toMatchObject({ configurado: true, final: '3456', teste: true });
    expect(JSON.stringify(cfg.json())).not.toContain('abcdefghij');
    expect(JSON.stringify((await req('GET', '/api/config')).json())).not.toContain('abcdefghij');
    cfg = await req('POST', '/api/integracoes/autentique/testar');
    expect(cfg.json().conta).toBe('Lucminas <contato@lucminas.com.br>');

    const r = await req('POST', '/api/contratos/assinatura', envio);
    expect(r.statusCode).toBe(201);
    expect(chamadas[0]).toBe('criar:true:SIGN/ana@metal.com.br,SIGN/arnaldo@lucminas.com.br,SIGN_AS_A_WITNESS/bia@metal.com.br,SIGN_AS_A_WITNESS/locacao@lucminas.com.br');
    expect(r.json()).toMatchObject({ status: 'aguardando', teste: true, clienteNome: 'METAL', assinantes: [{ papel: 'Contratante (METAL)' }, { papel: 'Lucminas' }, {}, {}] });
    expect((await req('POST', '/api/contratos/envios/doc-1/link/p0')).json()).toEqual({ link: 'https://assina.ae/p0' });

    // dois assinaram
    doc.assinaturas[0].assinadoEm = '2026-11-13T10:00:00Z';
    doc.assinaturas[1].assinadoEm = '2026-11-13T11:00:00Z';
    let lista = (await req('POST', '/api/contratos/envios/atualizar')).json();
    expect(lista[0].status).toBe('aguardando');
    await req('POST', '/api/contratos/envios/doc-1/reenviar');
    expect(chamadas.at(-1)).toBe('reenviar:p2,p3');

    // todos assinaram: baixa, guarda e marca a máquina
    doc.assinaturas[2].assinadoEm = '2026-11-14T09:00:00Z';
    doc.assinaturas[3].assinadoEm = '2026-11-14T12:00:00Z';
    doc.arquivoAssinado = 'https://autentique/arquivo.pdf';
    lista = (await req('POST', '/api/contratos/envios/atualizar')).json();
    expect(lista[0].erro).toBe('');
    expect(lista[0]).toMatchObject({ status: 'assinado' });
    const ficha = (await req('GET', '/api/equipamentos')).json().find((e: { frota: string }) => e.frota === '10');
    expect(ficha).toMatchObject({ contratoAssinado: 'sim', contratoAssinadoEm: '2026-11-14', contratoArquivo: lista[0].arquivoId });
    expect(existsSync(join(pasta, 'contratos', `${lista[0].arquivoId}.pdf`))).toBe(true);
    // não repete
    expect((await req('POST', '/api/contratos/envios/doc-1/cancelar')).statusCode).toBe(400);
  });
});
