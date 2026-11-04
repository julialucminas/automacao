import { beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirBanco, repositorio } from './db.js';
import { criarApp } from './app.js';
import { gerarHash } from './senha.js';
import { salvarConta, type Carteiro } from './envio.js';
import { pdfDeTeste } from './email.js';

let app: ReturnType<typeof criarApp>;
let pasta = '';
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
let enviados: { para: string[]; bruto: string }[] = [];
const carteiro: Carteiro = {
  async enviar(_c, bruto, dest) {
    enviados.push({ para: dest, bruto: bruto.toString('utf8') });
    return { aceitos: dest, recusados: [], resposta: '250 OK' };
  },
  async salvarEnviados() {
    return 'Itens Enviados';
  },
};
const como = (quem: string) => (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as object, headers: { cookie: cookies[quem] } });
// PNG 1x1
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]).toString('base64');

beforeEach(async () => {
  pasta = mkdtempSync(join(tmpdir(), 'os-'));
  enviados = [];
  const db = abrirBanco(':memory:');
  const repo = repositorio(db);
  const h = await gerarHash('senha-teste-1');
  ids.julia = repo.criarUsuario('juliamaria@lucminas.com.br', 'Júlia', h, '', 'admin').id;
  ids.junior = repo.criarUsuario('locacao@lucminas.com.br', 'Júnior', h, '', 'operacoes').id;
  ids.fabricio = repo.criarUsuario('fabricio@lucminas.com.br', 'Fabrício', h, '', 'tecnico').id;
  ids.eneiton = repo.criarUsuario('eneiton@lucminas.com.br', 'Eneiton', h, '', 'tecnico').id;
  ids.dono = repo.criarUsuario('arnaldo@lucminas.com.br', 'Arnaldo', h, '', 'diretoria').id;
  app = criarApp(db, { cookieSeguro: false, pastaDados: pasta, carteiro, esperaCopiaMs: 200 });
  for (const [k, e] of [
    ['julia', 'juliamaria@lucminas.com.br'],
    ['junior', 'locacao@lucminas.com.br'],
    ['fabricio', 'fabricio@lucminas.com.br'],
    ['eneiton', 'eneiton@lucminas.com.br'],
    ['dono', 'arnaldo@lucminas.com.br'],
  ]) {
    const r = await app.inject({ method: 'POST', url: '/api/sessao', payload: { email: e, senha: 'senha-teste-1' } });
    cookies[k] = String(r.headers['set-cookie']).split(';')[0];
  }
});

describe('modelos de OS', () => {
  it('vem com os modelos prontos; gerência cria e edita; técnico só lê', async () => {
    const lista = (await como('fabricio')('GET', '/api/modelos-os')).json();
    expect(lista.modelos.map((m: { nome: string }) => m.nome)).toContain('Preventiva');
    expect(lista.modelos.length).toBe(6);
    expect((await como('fabricio')('POST', '/api/modelos-os', { nome: 'X', tipoBase: 'vistoria', campos: [] })).statusCode).toBe(403);
    expect((await como('junior')('POST', '/api/modelos-os', { nome: 'X', tipoBase: 'vistoria', campos: [{ tipo: 'opcoes', rotulo: 'Cor', opcoes: ['a'] }] })).statusCode).toBe(400);
    const m = (
      await como('junior')('POST', '/api/modelos-os', {
        nome: 'Vistoria de bateria',
        tipoBase: 'vistoria',
        exigeHorimetro: false,
        exigeAssinatura: false,
        fotosMinimas: 1,
        campos: [
          { tipo: 'secao', rotulo: 'Bateria' },
          { id: 'tensao', tipo: 'numero', rotulo: 'Tensão', unidade: 'V', obrigatorio: true },
          { id: 'estado', tipo: 'opcoes', rotulo: 'Estado', opcoes: ['Boa', 'Fraca', 'Trocar'], obrigatorio: true },
          { id: 'agua', tipo: 'simnao', rotulo: 'Completou água?', obrigatorio: true },
          { id: 'foto', tipo: 'foto', rotulo: 'Foto da etiqueta', obrigatorio: true },
          { id: 'obs', tipo: 'textoLongo', rotulo: 'Observações' },
        ],
      })
    ).json();
    expect(m).toMatchObject({ nome: 'Vistoria de bateria', ativo: true, atualizadoPor: 'Júnior' });
    expect(m.campos[0].obrigatorio).toBe(false);
    const ed = (await como('junior')('PUT', `/api/modelos-os/${m.id}`, { ...m, ativo: false })).json();
    expect(ed.ativo).toBe(false);
    expect((await como('junior')('POST', '/api/ordens', { frota: '40', modeloId: m.id })).statusCode).toBe(400);
  });

  it('OS aberta com modelo: técnico preenche o formulário e só conclui com tudo respondido', async () => {
    const m = (
      await como('junior')('POST', '/api/modelos-os', {
        nome: 'Vistoria de bateria',
        tipoBase: 'vistoria',
        exigeHorimetro: false,
        exigeAssinatura: false,
        fotosMinimas: 0,
        campos: [
          { id: 'tensao', tipo: 'numero', rotulo: 'Tensão', obrigatorio: true },
          { id: 'estado', tipo: 'opcoes', rotulo: 'Estado', opcoes: ['Boa', 'Fraca'], obrigatorio: true },
          { id: 'itens', tipo: 'checklist', rotulo: 'Cabos', obrigatorio: true },
          { id: 'foto', tipo: 'foto', rotulo: 'Foto da etiqueta', obrigatorio: true },
        ],
      })
    ).json();
    let o = (await como('junior')('POST', '/api/ordens', { frota: '40', modeloId: m.id, tecnicoId: ids.fabricio, agendadaPara: '2026-11-05' })).json();
    expect(o.tipo).toBe('vistoria');
    expect(o.execucao.formulario.nome).toBe('Vistoria de bateria');
    expect(o.execucao.checklist).toBeUndefined();

    // mudar o modelo depois não mexe na OS já aberta
    await como('junior')('PUT', `/api/modelos-os/${m.id}`, { ...m, nome: 'Outro nome' });
    expect((await como('fabricio')('GET', `/api/ordens/${o.id}`)).json().execucao.formulario.nome).toBe('Vistoria de bateria');

    const f = como('fabricio');
    await f('POST', `/api/ordens/${o.id}/checkin`, {});
    expect((await f('PUT', `/api/ordens/${o.id}/execucao`, { respostas: { estado: 'Azul' } })).statusCode).toBe(400);
    expect((await f('PUT', `/api/ordens/${o.id}/execucao`, { respostas: { tensao: '24,5'.replace(',', '.'), estado: 'Boa' }, servico: 'Vistoria feita' })).statusCode).toBe(200);
    let r = await f('POST', `/api/ordens/${o.id}/concluir`, {});
    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toMatch(/Cabos/);
    expect(r.json().erro).toMatch(/Foto da etiqueta/);
    expect(r.json().erro).not.toMatch(/horímetro|assinatura/);
    await f('PUT', `/api/ordens/${o.id}/execucao`, { respostas: { itens: { resposta: 'ok', obs: '' } } });
    expect((await f('POST', `/api/ordens/${o.id}/fotos`, { imagem: `data:image/png;base64,${PNG}`, campoId: 'nao-existe' })).statusCode).toBe(400);
    o = (await f('POST', `/api/ordens/${o.id}/fotos`, { imagem: `data:image/png;base64,${PNG}`, campoId: 'foto' })).json();
    expect(o.execucao.respostas.foto).toHaveLength(1);
    expect(o.execucao.respostas.tensao).toBe(24.5);
    expect((await f('GET', `/api/ordens/${o.id}/arquivos/${o.execucao.respostas.foto[0]}`)).statusCode).toBe(200);
    r = await f('POST', `/api/ordens/${o.id}/concluir`, {});
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('concluida');
  });
});
