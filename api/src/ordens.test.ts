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

describe('ordens de serviço', () => {
  it('fluxo completo: abrir, técnico executa no celular, escritório encerra e manda o relatório', async () => {
    salvarConta(pasta, 'financeiro@lucminas.com.br', 'segredo');
    const c = (await como('julia')('POST', '/api/clientes', { nome: 'CAPIVARI', para: ['manutencao@capivari.com'], frotas: [{ numero: '40', valor: 280000 }] })).json();
    await como('julia')('POST', '/api/equipamentos/importar', { equipamentos: [{ frota: '40', dados: { horimetro: 25786, proximaPreventiva: 25961 } }] });
    const pend = (await como('junior')('POST', '/api/pendencias', { frota: '40', descricao: 'Motor de partida falhando' })).json();

    // técnicos para escolher
    expect((await como('junior')('GET', '/api/ordens/tecnicos')).json().map((t: { nome: string; escritorio: boolean }) => `${t.nome}${t.escritorio ? '*' : ''}`).sort()).toEqual([
      'Eneiton',
      'Fabrício',
      'Júlia*',
      'Júnior*',
    ]);

    // escritório abre
    expect((await como('fabricio')('POST', '/api/ordens', { frota: '40', tipo: 'corretiva' })).statusCode).toBe(403);
    let o = (
      await como('junior')('POST', '/api/ordens', { frota: 'FT40', clienteId: c.id, tipo: 'corretiva', tecnicoId: ids.fabricio, agendadaPara: '2026-11-05', descricao: 'Não dá partida', pendenciaId: pend.id })
    ).json();
    expect(o).toMatchObject({ numero: 1, status: 'agendada', tecnicoNome: 'Fabrício', clienteNome: 'CAPIVARI' });
    expect(o.execucao.checklist.length).toBeGreaterThan(3);

    // o técnico só vê as dele
    expect((await como('fabricio')('GET', '/api/ordens')).json()).toHaveLength(1);
    expect((await como('eneiton')('GET', '/api/ordens')).json()).toHaveLength(0);
    expect((await como('eneiton')('GET', `/api/ordens/${o.id}`)).statusCode).toBe(403);
    expect((await como('eneiton')('POST', `/api/ordens/${o.id}/checkin`, {})).statusCode).toBe(403);
    expect((await como('dono')('GET', '/api/ordens')).json()).toHaveLength(1); // diretoria vê tudo
    expect((await como('dono')('PUT', `/api/ordens/${o.id}/execucao`, { servico: 'x' })).statusCode).toBe(403);

    // execução
    o = (await como('fabricio')('POST', `/api/ordens/${o.id}/checkin`, { lat: -19.93, lng: -44.05, precisao: 12 })).json();
    expect(o.status).toBe('execucao');
    expect(o.execucao.checkin).toMatchObject({ lat: -19.93, lng: -44.05 });
    const falta = await como('fabricio')('POST', `/api/ordens/${o.id}/concluir`, {});
    expect(falta.json().erro).toMatch(/horímetro.*checklist.*o que foi feito.*assinatura/);
    o = (await como('fabricio')('PUT', `/api/ordens/${o.id}/execucao`, { aguardandoPeca: true })).json();
    expect(o.status).toBe('aguardando_peca');
    const checklist = o.execucao.checklist.map((x: { item: string }, i: number) => ({ ...x, resposta: i === 0 ? 'problema' : 'ok', obs: i === 0 ? 'motor de partida' : '' }));
    o = (
      await como('fabricio')('PUT', `/api/ordens/${o.id}/execucao`, {
        aguardandoPeca: false,
        horimetro: 25910,
        checklist,
        servico: 'Troca do bendix do motor de partida',
        pecas: [{ codigo: 'ZEN0450', descricao: 'BENDIX DO MOTOR DE PARTIDA', quantidade: 1 }],
        perifericos: ['motorPartida', 'turbo'],
      })
    ).json();
    expect(o).toMatchObject({ status: 'execucao', execucao: { horimetro: 25910, perifericos: ['motorPartida'] } });
    o = (await como('fabricio')('POST', `/api/ordens/${o.id}/fotos`, { imagem: JPG })).json();
    expect(o.execucao.fotos).toHaveLength(1);
    expect((await como('fabricio')('POST', `/api/ordens/${o.id}/fotos`, { imagem: Buffer.from('oi').toString('base64') })).statusCode).toBe(400);
    o = (await como('fabricio')('POST', `/api/ordens/${o.id}/assinatura`, { imagem: `data:image/png;base64,${PNG}`, nome: 'Carlos (encarregado)' })).json();
    expect(o.execucao.assinadoPor).toBe('Carlos (encarregado)');
    const foto = await como('julia')('GET', `/api/ordens/${o.id}/arquivos/${o.execucao.fotos[0]}`);
    expect([foto.statusCode, foto.headers['content-type']]).toEqual([200, 'image/jpeg']);
    expect((await como('julia')('GET', `/api/ordens/${o.id}/arquivos/..%2Ffaturas.db`)).statusCode).toBe(400);
    o = (await como('fabricio')('POST', `/api/ordens/${o.id}/concluir`, { lat: -19.93, lng: -44.05 })).json();
    expect(o.status).toBe('concluida');

    // escritório encerra e manda o relatório
    expect((await como('fabricio')('POST', `/api/ordens/${o.id}/encerrar`, {})).statusCode).toBe(403);
    const r = (await como('junior')('POST', `/api/ordens/${o.id}/encerrar`, { proximaPreventiva: 26260, enviar: true, pdf: pdfDeTeste('OS 1').toString('base64') })).json();
    expect(r.ordem).toMatchObject({ status: 'encerrada', encerradaPor: 'Júnior', relatorioPara: 'manutencao@capivari.com' });
    expect(r.relatorio.enviado).toBe(true);
    expect(enviados[0].para).toEqual(['manutencao@capivari.com']);
    expect(enviados[0].bruto).toMatch(/Subject: =\?UTF-8\?|ordem de servi/);

    // efeitos: ficha, histórico e pendência
    const ficha = (await como('julia')('GET', '/api/equipamentos')).json().find((e: { frota: string }) => e.frota === '40');
    expect(ficha).toMatchObject({ horimetro: 25910, proximaPreventiva: 26260, tecnico: 'Fabrício', motorPartidaHorimetro: 25910 });
    const hist = (await como('julia')('GET', '/api/equipamentos/40/historico')).json();
    expect(hist.map((h: { descricao: string; origem: string }) => `${h.origem}: ${h.descricao}`)).toEqual(['os: OS 1 · CORRETIVA', 'os: BENDIX DO MOTOR DE PARTIDA']);
    expect((await como('julia')('GET', '/api/pendencias')).json()).toEqual([]);
    expect((await como('fabricio')('PUT', `/api/ordens/${o.id}/execucao`, { servico: 'mudar depois' })).statusCode).toBe(400);
  });

  it('sem assinatura precisa de motivo; cancelar precisa de motivo; escritório pode devolver ao técnico', async () => {
    let o = (await como('junior')('POST', '/api/ordens', { frota: '12', clienteNome: 'COGRAN', tipo: 'vistoria', tecnicoId: ids.eneiton, agendadaPara: '2026-11-06' })).json();
    await como('eneiton')('POST', `/api/ordens/${o.id}/checkin`, {});
    const checklist = o.execucao.checklist.map((x: object) => ({ ...x, resposta: 'na' }));
    await como('eneiton')('PUT', `/api/ordens/${o.id}/execucao`, { horimetro: 3600, checklist, servico: 'Vistoria feita' });
    expect((await como('eneiton')('POST', `/api/ordens/${o.id}/concluir`, {})).json().erro).toMatch(/assinatura/);
    await como('eneiton')('PUT', `/api/ordens/${o.id}/execucao`, { semAssinatura: 'Cliente não estava no local' });
    o = (await como('eneiton')('POST', `/api/ordens/${o.id}/concluir`, {})).json();
    expect(o.status).toBe('concluida');
    o = (await como('junior')('POST', `/api/ordens/${o.id}/devolver`)).json();
    expect(o.status).toBe('execucao');
    expect((await como('junior')('POST', `/api/ordens/${o.id}/cancelar`, {})).statusCode).toBe(400);
    o = (await como('junior')('POST', `/api/ordens/${o.id}/cancelar`, { motivo: 'Cliente devolveu a máquina' })).json();
    expect(o).toMatchObject({ status: 'cancelada', cancelamento: 'Cliente devolveu a máquina' });
    const log = (await como('julia')('GET', '/api/registro')).json().filter((l: { area: string }) => l.area === 'ordem').map((l: { acao: string }) => l.acao);
    expect(log[0]).toBe('OS 1 (FT12): cancelou: Cliente devolveu a máquina');
  });
});
