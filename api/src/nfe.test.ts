import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirBanco, repositorio } from './db.js';
import { criarApp } from './app.js';
import { gerarHash } from './senha.js';

let app: ReturnType<typeof criarApp>;
let pasta = '';
const cookies: Record<string, string> = {};
const como = (quem: string) => (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object, headers: { cookie: cookies[quem] } });
const b64 = (s: string) => Buffer.from(s).toString('base64');
const PDF = b64('%PDF-1.4\n% danfe de teste\n');
const XML = b64('<?xml version="1.0"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe><ide><nNF>4521</nNF></ide></infNFe></NFe></nfeProc>');

beforeEach(async () => {
  pasta = mkdtempSync(join(tmpdir(), 'nfe-'));
  const db = abrirBanco(':memory:');
  const repo = repositorio(db);
  const h = await gerarHash('senha-teste-1');
  repo.criarUsuario('financeiro@lucminas.com.br', 'Angelise', h, '', 'financeiro');
  repo.criarUsuario('tecnico@lucminas.com.br', 'Fabrício', h, '', 'tecnico');
  app = criarApp(db, { cookieSeguro: false, pastaDados: pasta });
  for (const [k, e] of [
    ['angelise', 'financeiro@lucminas.com.br'],
    ['tecnico', 'tecnico@lucminas.com.br'],
  ]) {
    const r = await app.inject({ method: 'POST', url: '/api/sessao', payload: { email: e, senha: 'senha-teste-1' } });
    cookies[k] = String(r.headers['set-cookie']).split(';')[0];
  }
});
afterEach(() => rmSync(pasta, { recursive: true, force: true }));

describe('NF-e na compra e venda', () => {
  it('anexa PDF, troca por XML, abre e tira; recusa outros tipos e outras movimentações', async () => {
    const a = como('angelise');
    const compra = (await a('POST', '/api/movimentacoes', { tipo: 'compra', frota: '121', data: '2026-11-10', descricao: 'YALE GLP050VX', clienteNome: 'TRADIMAQ' })).json();
    expect((await a('POST', `/api/movimentacoes/${compra.id}/nfe`, { arquivo: b64('olá'), nome: 'x.txt' })).statusCode).toBe(400);

    let r = await a('POST', `/api/movimentacoes/${compra.id}/nfe`, { arquivo: PDF, nome: 'DANFE 4521.pdf' });
    expect(r.statusCode).toBe(200);
    expect(r.json().dados.nfArquivo).toMatchObject({ ext: 'pdf', nome: 'DANFE 4521.pdf', porNome: 'Angelise' });
    r = await a('GET', `/api/movimentacoes/${compra.id}/nfe`);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.body.startsWith('%PDF-')).toBe(true);

    // técnico não vê movimentações
    expect((await como('tecnico')('GET', `/api/movimentacoes/${compra.id}/nfe`)).statusCode).toBe(403);

    // troca pelo XML: o PDF antigo some
    r = await a('POST', `/api/movimentacoes/${compra.id}/nfe`, { arquivo: XML, nome: 'nfe.xml' });
    expect(r.json().dados.nfArquivo.ext).toBe('xml');
    expect(existsSync(join(pasta, 'nfe', `${compra.id}.pdf`))).toBe(false);
    expect(existsSync(join(pasta, 'nfe', `${compra.id}.xml`))).toBe(true);
    // a ficha/compra continua igual
    expect((await a('GET', '/api/movimentacoes')).json()[0].dados.nfArquivo.nome).toBe('nfe.xml');

    r = await a('DELETE', `/api/movimentacoes/${compra.id}/nfe`);
    expect(r.json().dados.nfArquivo).toBeNull();
    expect(existsSync(join(pasta, 'nfe', `${compra.id}.xml`))).toBe(false);
    expect((await a('GET', `/api/movimentacoes/${compra.id}/nfe`)).statusCode).toBe(404);

    // só compra e venda
    const loc = (await a('POST', '/api/movimentacoes', { tipo: 'locacao', frota: '121', data: '2026-11-12', clienteNome: 'TESTE' })).json();
    r = await a('POST', `/api/movimentacoes/${loc.id}/nfe`, { arquivo: PDF, nome: 'a.pdf' });
    expect(r.statusCode).toBe(409);
    expect(existsSync(join(pasta, 'nfe', `${loc.id}.pdf`))).toBe(false);
    expect((await a('POST', '/api/movimentacoes/../../x/nfe', { arquivo: PDF })).statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('observações depois de lançada', () => {
  it('acrescenta observação (normal ou urgente), guarda quem e quando; técnico não pode', async () => {
    const a = como('angelise');
    const loc = (await a('POST', '/api/movimentacoes', { tipo: 'locacao', frota: '50', data: '2026-11-12', clienteNome: 'TESTE', observacoes: 'original' })).json();
    expect((await a('POST', `/api/movimentacoes/${loc.id}/notas`, { texto: '  ' })).statusCode).toBe(400);
    let r = await a('POST', `/api/movimentacoes/${loc.id}/notas`, { texto: 'cliente pediu nota fiscal separada' });
    r = await a('POST', `/api/movimentacoes/${loc.id}/notas`, { texto: 'faltou o gás', urgente: true });
    expect(r.statusCode).toBe(200);
    expect(r.json().dados.observacoes).toBe('original');
    expect(r.json().dados.notas).toMatchObject([
      { texto: 'cliente pediu nota fiscal separada', urgente: false, porNome: 'Angelise' },
      { texto: 'faltou o gás', urgente: true, porNome: 'Angelise' },
    ]);
    // ok na nota urgente
    const nota = r.json().dados.notas[1];
    expect((await a('POST', '/api/avisos-ok', { chave: `obs:${loc.id}:${nota.id}` })).statusCode).toBeLessThan(300);
    expect((await como('tecnico')('POST', `/api/movimentacoes/${loc.id}/notas`, { texto: 'x' })).statusCode).toBe(403);
    expect((await a('POST', '/api/movimentacoes/nao-existe/notas', { texto: 'x' })).statusCode).toBe(404);
  });
});

describe('fatura lançada manualmente', () => {
  it('a Angelise lança a fatura enviada por fora: vai para o histórico e marca faturado; não repete o número', async () => {
    const a = como('angelise');
    const c = (await a('POST', '/api/clientes', { nome: 'Fenix', para: ['a@fenix.com.br'], cc: [], apelidos: [], cnpj: '', observacoes: '' })).json();
    expect((await a('POST', '/api/envios/manual', { clienteId: c.id, referencia: '2026-11', data: '' })).statusCode).toBe(400);
    const r = await a('POST', '/api/envios/manual', { clienteId: c.id, referencia: '2026-11', data: '2026-11-10', numero: '4510', observacao: 'mandei pelo meu e-mail' });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: 'enviado', numero: '4510', clienteNome: 'FENIX', referencia: '2026-11', observacao: 'mandei pelo meu e-mail' });
    expect((await a('GET', '/api/envios')).json()[0]).toMatchObject({ numero: '4510', detalhe: expect.stringMatching(/manualmente/) });
    expect((await a('GET', '/api/faturamentos?de=2026-11-01&ate=2026-11-30')).json()).toEqual([expect.objectContaining({ clienteId: c.id, data: '2026-11-10', origem: 'manual' })]);
    expect((await a('POST', '/api/envios/manual', { clienteId: c.id, referencia: '2026-11', data: '2026-11-11', numero: '4510' })).statusCode).toBe(409);
    expect((await como('tecnico')('POST', '/api/envios/manual', { clienteId: c.id, referencia: '2026-11', data: '2026-11-11' })).statusCode).toBe(403);
  });
});

describe('contratos', () => {
  it('salva o contrato do cliente em várias máquinas, renova, tira máquina; técnico não pode', async () => {
    const a = como('angelise');
    const c = (await a('POST', '/api/clientes', { nome: 'Metal', para: ['a@m.com.br'], cc: [], apelidos: [], cnpj: '', observacoes: '' })).json();
    for (const f of ['10', '11']) await a('POST', '/api/movimentacoes', { tipo: 'locacao', frota: f, clienteId: c.id, data: '2026-01-10', valor: 300000 });
    expect((await a('POST', '/api/contratos', { clienteId: c.id, frotas: ['10', '99'], vencimento: '2027-01-09' })).statusCode).toBe(400);
    expect((await a('POST', '/api/contratos', { clienteId: c.id, frotas: ['10'], inicio: '2027-02-01', vencimento: '2027-01-09' })).statusCode).toBe(400);
    expect((await a('POST', '/api/contratos', { clienteId: c.id, frotas: ['FT10', '11'], numero: 'C-12', inicio: '2026-01-10', vencimento: '2027-01-09', obs: 'IPCA' })).statusCode).toBe(200);
    const ficha = async (f: string) => (await a('GET', '/api/equipamentos')).json().find((e: { frota: string }) => e.frota === f);
    expect(await ficha('11')).toMatchObject({ contratoNumero: 'C-12', contratoInicio: '2026-01-10', contratoVencimento: '2027-01-09', contratoObs: 'IPCA' });
    // renova só com a 10; a 11 sai do contrato
    await a('POST', '/api/contratos', { clienteId: c.id, frotas: ['10'], tirar: ['11'], numero: 'C-12', inicio: '2026-01-10', vencimento: '2028-01-09', renovacao: true });
    expect((await ficha('10')).contratoVencimento).toBe('2028-01-09');
    expect((await ficha('11')).contratoNumero ?? null).toBeNull();
    const log = (await a('GET', '/api/registro')).json().map((l: { acao: string }) => l.acao);
    expect(log).toContain('renovou o contrato C-12 de METAL até 09/01/2028: FT10 (saíram FT11)');
    expect((await como('tecnico')('POST', '/api/contratos', { clienteId: c.id, frotas: ['10'], vencimento: '2028-01-09' })).statusCode).toBe(403);

    // assinatura: marcar à mão, anexar o assinado (já marca), renovar volta para "falta assinar"
    await a('POST', '/api/contratos', { clienteId: c.id, frotas: ['10'], numero: 'C-12', vencimento: '2028-01-09', assinado: true, assinadoEm: '2026-11-10' });
    expect(await ficha('10')).toMatchObject({ contratoAssinado: 'sim', contratoAssinadoEm: '2026-11-10' });
    expect((await a('POST', '/api/contratos/arquivos', { clienteId: c.id, frotas: ['10'], arquivo: b64('texto'), nome: 'c.txt' })).statusCode).toBe(400);
    const arq = await a('POST', '/api/contratos/arquivos', { clienteId: c.id, frotas: ['10'], arquivo: PDF, nome: 'Contrato C-12 assinado.pdf' });
    expect(arq.statusCode).toBe(201);
    expect(arq.json()).toMatchObject({ numero: 'C-12', vencimento: '2028-01-09', frotas: ['10'], por: 'Angelise' });
    expect((await ficha('10')).contratoArquivo).toBe(arq.json().id);
    const abre = await a('GET', `/api/contratos/arquivos/${arq.json().id}`);
    expect(abre.headers['content-type']).toBe('application/pdf');
    expect((await a('GET', '/api/contratos/arquivos')).json()).toHaveLength(1);
    await a('POST', '/api/contratos', { clienteId: c.id, frotas: ['10'], numero: 'C-12', inicio: '2028-01-09', vencimento: '2029-01-09', renovacao: true });
    const f10 = await ficha('10');
    expect([f10.contratoAssinado ?? null, f10.contratoArquivo ?? null]).toEqual([null, null]);
    // o arquivo antigo continua guardado
    expect((await a('GET', `/api/contratos/arquivos/${arq.json().id}`)).statusCode).toBe(200);
  });
});

describe('fotos da empilhadeira', () => {
  it('põe, lista, abre e tira fotos da ficha; só JPEG', async () => {
    const a = como('angelise');
    const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
    expect((await a('POST', '/api/equipamentos/FT40/fotos', { arquivo: PDF })).statusCode).toBe(400);
    const r = await a('POST', '/api/equipamentos/FT40/fotos', { arquivo: JPG, legenda: 'lateral' });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ frota: '40', legenda: 'lateral', por: 'Angelise' });
    expect((await a('GET', '/api/equipamentos/40/fotos')).json()).toHaveLength(1);
    expect((await a('GET', `/api/equipamentos/fotos/${r.json().id}`)).headers['content-type']).toBe('image/jpeg');
    await a('DELETE', `/api/equipamentos/fotos/${r.json().id}`);
    expect((await a('GET', '/api/equipamentos/40/fotos')).json()).toEqual([]);
    expect(existsSync(join(pasta, 'equipamentos', `${r.json().id}.jpg`))).toBe(false);
  });
});

describe('entrega da máquina', () => {
  it('checklist na saída (atualiza horímetro), vídeo cru com Range; só locação/troca', async () => {
    const a = como('angelise');
    const c = (await a('POST', '/api/clientes', { nome: 'Gama', para: ['a@g.com.br'], cc: [], apelidos: [], cnpj: '', observacoes: '' })).json();
    const loc = (await a('POST', '/api/movimentacoes', { tipo: 'locacao', frota: '20', clienteId: c.id, data: '2026-11-13', valor: 300000 })).json();
    const itens = [
      { item: 'Pneus', estado: 'ok', obs: '' },
      { item: 'Extintor', estado: 'problema', obs: '' },
    ];
    expect((await a('PUT', `/api/entregas/${loc.id}/checklist`, { itens })).statusCode).toBe(400);
    itens[1].obs = 'vencido, trocar';
    const r = await a('PUT', `/api/entregas/${loc.id}/checklist`, { itens, horimetro: 1234.5, observacoes: 'saiu às 8h' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ frota: '20', checklist: { horimetro: 1234.5, por: 'Angelise', itens: [{ estado: 'ok' }, { estado: 'problema', obs: 'vencido, trocar' }] }, video: null });
    expect((await a('GET', '/api/equipamentos')).json().find((e: { frota: string }) => e.frota === '20').horimetro).toBe(1234.5);

    const video = Buffer.alloc(5000, 7);
    const up = await app.inject({ method: 'POST', url: `/api/entregas/${loc.id}/video`, payload: video, headers: { cookie: cookies.angelise, 'content-type': 'video/mp4', 'x-nome-arquivo': encodeURIComponent('vídeo entrega.mp4') } });
    expect(up.statusCode).toBe(201);
    expect(up.json().video).toMatchObject({ nome: 'vídeo entrega.mp4', ext: 'mp4', tamanho: 5000 });
    const parte = await app.inject({ method: 'GET', url: `/api/entregas/${loc.id}/video`, headers: { cookie: cookies.angelise, range: 'bytes=0-99' } });
    expect(parte.statusCode).toBe(206);
    expect(parte.headers['content-range']).toBe('bytes 0-99/5000');
    expect(parte.rawPayload.length).toBe(100);
    expect((await a('GET', '/api/entregas?frota=FT20')).json()).toHaveLength(1);
    const ruim = await app.inject({ method: 'POST', url: `/api/entregas/${loc.id}/video`, payload: video, headers: { cookie: cookies.angelise, 'content-type': 'application/pdf' } });
    expect(ruim.statusCode).toBeGreaterThanOrEqual(400);

    const dev = (await a('POST', '/api/movimentacoes', { tipo: 'devolucao', frota: '20', data: '2026-11-14' })).json();
    expect((await a('PUT', `/api/entregas/${dev.id}/checklist`, { itens })).statusCode).toBe(400);
  });
});

describe('adicionais da locação', () => {
  it('vão para a ficha na locação, passam para a frota nova na troca e saem na devolução', async () => {
    const a = como('angelise');
    const fichaDe = async (f: string) => (await a('GET', '/api/equipamentos')).json().find((e: { frota: string }) => e.frota === f);
    const c = (await a('POST', '/api/clientes', { nome: 'Gama Adicionais', para: ['a@g.com.br'], cc: [], apelidos: [], cnpj: '', observacoes: '' })).json();
    const loc = (await a('POST', '/api/movimentacoes', { tipo: 'locacao', frota: '41', clienteId: c.id, data: '2026-11-01', valor: 300000, modalidade: 'contrato', adicionais: ' Prolongador de garfo, Carregador ' })).json();
    expect(loc.dados.adicionais).toBe('Prolongador de garfo, Carregador');
    expect((await fichaDe('41')).adicionais).toBe('Prolongador de garfo, Carregador');
    await a('POST', '/api/movimentacoes', { tipo: 'troca', frota: '41', frotaNova: '42', clienteId: c.id, data: '2026-11-05' });
    expect((await fichaDe('42')).adicionais).toBe('Prolongador de garfo, Carregador');
    expect((await fichaDe('41')).adicionais ?? null).toBeNull();
    const dev = (await a('POST', '/api/movimentacoes', { tipo: 'devolucao', frota: '42', data: '2026-11-10', adicionais: 'Prolongador de garfo, Carregador' })).json();
    expect(dev.dados.adicionais).toBe('Prolongador de garfo, Carregador');
    expect((await fichaDe('42')).adicionais ?? null).toBeNull();
  });
});

describe('pasta do cliente', () => {
  it('junta contratos (com tipo), documentos, NF-e e entregas; faturas só para financeiro', async () => {
    const a = como('angelise');
    const c = (await a('POST', '/api/clientes', { nome: 'Delta', para: ['a@d.com.br'], cc: [], apelidos: [], cnpj: '', observacoes: '' })).json();
    const loc = (await a('POST', '/api/movimentacoes', { tipo: 'locacao', frota: '30', clienteId: c.id, data: '2026-01-10', valor: 300000 })).json();
    await a('PUT', `/api/entregas/${loc.id}/checklist`, { itens: [{ item: 'Pneus', estado: 'ok', obs: '' }] });
    await a('POST', '/api/contratos', { clienteId: c.id, frotas: ['30'], numero: 'D-1', vencimento: '2027-01-09' });
    await a('POST', '/api/contratos/arquivos', { clienteId: c.id, frotas: ['30'], arquivo: PDF, nome: 'contrato.pdf', tipo: 'assinado' });
    const adit = await a('POST', '/api/contratos/arquivos', { clienteId: c.id, frotas: ['30'], arquivo: PDF, nome: 'aditivo.pdf', tipo: 'aditivo', descricao: 'Reajuste IPCA', movId: 'x' });
    expect(adit.json()).toMatchObject({ tipo: 'aditivo', descricao: 'Reajuste IPCA' });
    // aditivo não troca o "contrato atual" da máquina
    const f30 = (await a('GET', '/api/equipamentos')).json().find((e: { frota: string }) => e.frota === '30');
    expect(f30.contratoArquivo).not.toBe(adit.json().id);
    expect((await a('POST', `/api/clientes/${c.id}/documentos`, { arquivo: PDF, nome: 'virus.exe' })).statusCode).toBe(400);
    const doc = await a('POST', `/api/clientes/${c.id}/documentos`, { arquivo: PDF, nome: 'Cartão CNPJ.pdf', descricao: 'cartão' });
    expect(doc.statusCode).toBe(201);
    await a('POST', '/api/envios/manual', { clienteId: c.id, referencia: '2026-11', data: '2026-11-10', numero: '77' });
    const pasta = (await a('GET', `/api/clientes/${c.id}/pasta`)).json();
    expect(pasta.contratos.map((x: { tipo: string }) => x.tipo).sort()).toEqual(['aditivo', 'assinado']);
    expect(pasta.documentos).toMatchObject([{ nome: 'Cartão CNPJ.pdf', descricao: 'cartão', por: 'Angelise' }]);
    expect(pasta.entregas).toHaveLength(1);
    expect(pasta.faturas).toMatchObject([{ numero: '77', manual: true, arquivos: [] }]);
    expect((await a('GET', `/api/clientes/documentos/${doc.json().id}`)).headers['content-type']).toBe('application/pdf');
    await a('DELETE', `/api/clientes/documentos/${doc.json().id}`);
    expect((await a('GET', `/api/clientes/${c.id}/pasta`)).json().documentos).toEqual([]);
  });
});

describe('acompanhamento dos contratos', () => {
  it('registra contato com retorno, pendência, resolve, muda etapa (vai para a linha do tempo) e conta alertas', async () => {
    const a = como('angelise');
    const c = (await a('POST', '/api/clientes', { nome: 'Omega', para: ['a@o.com.br'], cc: [], apelidos: [], cnpj: '', observacoes: '' })).json();
    const chave = `${c.id}|n:OM-1`;
    expect((await a('POST', '/api/contratos/registros', { clienteId: c.id, chave, tipo: 'contato', texto: '' })).statusCode).toBe(400);
    await a('POST', '/api/contratos/registros', { clienteId: c.id, chave, assunto: 'reajuste', tipo: 'contato', texto: 'Liguei, pediu proposta por e-mail', canal: 'telefone', contato: 'Carla', proximaData: '2026-01-01' });
    const pend = (await a('POST', '/api/contratos/registros', { clienteId: c.id, chave, tipo: 'pendencia', texto: 'Falta a via assinada do aditivo' })).json();
    expect((await a('GET', '/api/contratos/alertas')).json()).toEqual({ pendencias: 1, retornos: 1 });
    await a('POST', `/api/contratos/registros/${pend.id}/resolver`, { resolucao: 'chegou pelo correio' });
    expect((await a('GET', '/api/contratos/alertas')).json().pendencias).toBe(0);
    expect((await a('PUT', '/api/contratos/status', { clienteId: c.id, chave, reajuste: 'xyz' })).statusCode).toBe(400);
    const st = await a('PUT', '/api/contratos/status', { clienteId: c.id, chave, reajuste: 'proposta_enviada', reajustePercentual: 4.8 });
    expect(st.json()).toMatchObject({ reajuste: 'proposta_enviada', reajustePercentual: 4.8, renovacao: '' });
    const ac = (await a('GET', '/api/contratos/acompanhamento')).json();
    expect(ac.registros.map((r: { tipo: string }) => r.tipo).sort()).toEqual(['contato', 'etapa', 'pendencia']);
    expect(ac.registros.find((r: { tipo: string }) => r.tipo === 'pendencia')).toMatchObject({ resolucao: 'chegou pelo correio', resolvidaPor: 'Angelise' });
    expect(ac.registros.find((r: { tipo: string }) => r.tipo === 'contato')).toMatchObject({ canal: 'telefone', contato: 'Carla', por: 'Angelise', assunto: 'reajuste' });
    expect((await como('tecnico')('POST', '/api/contratos/registros', { clienteId: c.id, chave, texto: 'x' })).statusCode).toBe(403);
  });
});
