import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirBanco, repositorio } from './db.js';
import { criarApp } from './app.js';
import { gerarHash } from './senha.js';

let app: ReturnType<typeof criarApp>;
const cookies: Record<string, string> = {};
const como = (quem: string) => (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as object, headers: { cookie: cookies[quem] } });

beforeEach(async () => {
  const db = abrirBanco(':memory:');
  const repo = repositorio(db);
  const h = await gerarHash('senha-teste-1');
  repo.criarUsuario('juliamaria@lucminas.com.br', 'Júlia', h, '', 'admin');
  repo.criarUsuario('locacao@lucminas.com.br', 'Júnior', h, '', 'operacoes');
  repo.criarUsuario('fabricio@lucminas.com.br', 'Fabrício', h, '', 'tecnico');
  app = criarApp(db, { cookieSeguro: false });
  for (const [k, e] of [
    ['julia', 'juliamaria@lucminas.com.br'],
    ['junior', 'locacao@lucminas.com.br'],
    ['tec', 'fabricio@lucminas.com.br'],
  ]) {
    const r = await app.inject({ method: 'POST', url: '/api/sessao', payload: { email: e, senha: 'senha-teste-1' } });
    cookies[k] = String(r.headers['set-cookie']).split(';')[0];
  }
});

describe('painel de manutenção', () => {
  it('perfis que já existiam ganham a aba nova sem perder o que o administrador mudou', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'perfis-'));
    const arq = join(pasta, 'b.db');
    const b0 = abrirBanco(arq);
    criarApp(b0, { cookieSeguro: false }); // cria os perfis padrão
    b0.close();
    const d = new Database(arq);
    // como estava antes da fase 3: sem 'manutencao', e o administrador tinha mudado o Histórico do Júnior
    const p = JSON.parse((d.prepare("SELECT permissoes FROM perfis WHERE id = 'operacoes'").get() as { permissoes: string }).permissoes);
    delete p.manutencao;
    p.historico = 1;
    d.prepare("UPDATE perfis SET permissoes = ? WHERE id = 'operacoes'").run(JSON.stringify(p));
    d.close();
    const db = abrirBanco(arq);
    criarApp(db, { cookieSeguro: false }); // abre os perfis
    const depois = JSON.parse((db.prepare("SELECT permissoes FROM perfis WHERE id = 'operacoes'").get() as { permissoes: string }).permissoes);
    expect(depois).toMatchObject({ manutencao: 2, historico: 1 });
  });

  it('regras vêm prontas e são validadas ao salvar', async () => {
    const cfg = (await como('julia')('GET', '/api/config')).json();
    expect(JSON.parse(cfg['manutencao.tipos']).map((t: { sigla: string }) => t.sigla)).toEqual(['CF', 'CR', 'B', 'C', 'D']);
    const tipos = JSON.parse(cfg['manutencao.tipos']);
    tipos[2].horas = 400;
    expect((await como('julia')('PUT', '/api/config', { 'manutencao.tipos': JSON.stringify(tipos) })).statusCode).toBe(200);
    expect(JSON.parse((await como('julia')('GET', '/api/config')).json()['manutencao.tipos'])[2]).toEqual({ sigla: 'B', nome: 'Preventiva B', horas: 400 });
    expect((await como('julia')('PUT', '/api/config', { 'manutencao.tipos': '[{"sigla":"B","nome":"x"},{"sigla":"b","nome":"y"}]' })).json().erro).toMatch(/duas vezes/);
    expect((await como('julia')('PUT', '/api/config', { 'manutencao.perifericos': '[{"id":"turbo","nome":"x","dias":1}]' })).statusCode).toBe(400);
    expect((await como('junior')('PUT', '/api/config', { 'manutencao.tipos': JSON.stringify(tipos) })).statusCode).toBe(403);
  });

  it('registrar visita atualiza a ficha, troca periféricos e lança no histórico (que o Auvo não apaga)', async () => {
    await como('julia')('POST', '/api/equipamentos/importar', { equipamentos: [{ frota: '40', dados: { horimetro: 25786, horimetroEm: '2026-10-21', proximaPreventiva: 25961, tipoVisita: 'CF' } }] });
    const r = await como('junior')('POST', '/api/equipamentos/40/visita', {
      data: '2026-11-03',
      horimetro: 25900,
      tipo: 'b',
      tecnico: 'Fabrício',
      cliente: 'CAPIVARI',
      proximaPreventiva: 26250,
      perifericos: ['filtroAr', 'oleoTransmissao', 'turbo'],
      observacao: 'trocado filtro',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      horimetro: 25900,
      horimetroEm: '2026-11-03',
      ultimaVisita: '2026-11-03',
      proximaPreventiva: 26250,
      tecnico: 'Fabrício',
      filtroArData: '2026-11-03',
      filtroArProximaData: '2027-02-01', // 90 dias
      oleoTransmissaoHorimetro: 25900,
      oleoTransmissaoProximaHoras: 28900, // 3000 h
    });
    // a importação do Auvo não apaga o que o sistema lançou
    await como('julia')('POST', '/api/historico-pecas/importar', { linhas: [{ data: '2025-01-01', frota: '40', descricao: 'X' }] });
    const hist = (await como('julia')('GET', '/api/equipamentos/40/historico')).json();
    expect(hist.map((h: { descricao: string; origem: string }) => `${h.origem}: ${h.descricao}`)).toEqual([
      'sistema: VISITA B · PREVENTIVA B',
      'sistema: TROCA: FILTRO DE AR',
      'sistema: TROCA: ÓLEO DE TRANSMISSÃO',
      'auvo: X',
    ]);
    // horímetro menor que o último: provável erro de digitação
    expect((await como('junior')('POST', '/api/equipamentos/40/visita', { data: '2026-11-04', horimetro: 2590, tipo: 'CF' })).json().erro).toMatch(/menor que o último/);
    expect((await como('junior')('POST', '/api/equipamentos/40/visita', { data: '2026-11-04', tipo: 'ZZ' })).statusCode).toBe(400);
    expect((await como('tec')('POST', '/api/equipamentos/40/visita', { data: '2026-11-04', tipo: 'CF' })).statusCode).toBe(403);
  });

  it('pendências: abrir, resolver, importar da planilha sem reabrir a resolvida', async () => {
    const p = (await como('junior')('POST', '/api/pendencias', { frota: 'FT 20', cliente: 'MADEREIRA', tecnico: 'Eduardo Silva', descricao: 'Trocar a bomba hidráulica' })).json();
    expect(p).toMatchObject({ frota: '20', status: 'aberta', origem: 'sistema' });
    const imp = [
      { frota: '4', cliente: 'FORMARE', abertaEm: '2026-10-02', tecnico: 'Eneiton', descricao: 'TROCAR AS LANTERNAS' },
      { frota: '12', cliente: 'COGRAN', abertaEm: '2026-10-28', tecnico: 'Eneiton', descricao: 'TROCAR FILTRO DE AR' },
    ];
    expect((await como('julia')('POST', '/api/pendencias/importar', { pendencias: imp })).json()).toEqual({ abertas: 2, jaResolvidas: 0 });
    const l = (await como('julia')('GET', '/api/pendencias')).json();
    expect(l).toHaveLength(3);
    const lanterna = l.find((x: { descricao: string }) => x.descricao === 'TROCAR AS LANTERNAS');
    const res = (await como('junior')('POST', `/api/pendencias/${lanterna.id}/resolver`, { resolucao: 'trocadas' })).json();
    expect(res).toMatchObject({ status: 'resolvida', resolucao: 'trocadas', resolvidaPor: 'Júnior' });
    // importar de novo a mesma planilha: a resolvida não volta, a do sistema fica
    expect((await como('julia')('POST', '/api/pendencias/importar', { pendencias: imp })).json()).toEqual({ abertas: 1, jaResolvidas: 1 });
    expect((await como('julia')('GET', '/api/pendencias')).json().map((x: { frota: string }) => x.frota).sort()).toEqual(['12', '20']);
    expect((await como('julia')('GET', '/api/pendencias?todas=1')).json()).toHaveLength(3);
    expect((await como('tec')('GET', '/api/pendencias')).statusCode).toBe(200);
    expect((await como('tec')('POST', '/api/pendencias', { frota: '1', descricao: 'x' })).statusCode).toBe(403);
  });
});
