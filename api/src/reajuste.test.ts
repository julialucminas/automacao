import { beforeEach, describe, expect, it } from 'vitest';
import { abrirBanco, repositorio } from './db.js';
import { criarApp } from './app.js';
import { equipamentos } from './equipamentos.js';
import { gerarHash } from './senha.js';

let app: ReturnType<typeof criarApp>;
let db: ReturnType<typeof abrirBanco>;
let clienteId = '';
const cookies: Record<string, string> = {};
const como = (quem: string) => (method: 'GET' | 'POST', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as object, headers: { cookie: cookies[quem] } });

beforeEach(async () => {
  db = abrirBanco(':memory:');
  const repo = repositorio(db);
  const h = await gerarHash('senha-teste-1');
  repo.criarUsuario('financeiro@lucminas.com.br', 'Angelise', h, '', 'financeiro');
  repo.criarUsuario('locacao@lucminas.com.br', 'Júnior', h, '', 'operacoes');
  const u = repo.criarUsuario('admin@lucminas.com.br', 'Admin', h, '', 'admin');
  clienteId = repo.salvarCliente(
    {
      nome: 'METALFISA',
      apelidos: [],
      cnpj: '',
      para: ['a@metalfisa.com.br'],
      cc: [],
      observacoes: '',
      frotas: [
        { numero: '53', valor: 385000, descricao: '' },
        { numero: '63', valor: 385000, descricao: '' },
      ],
    },
    u.id,
    'teste',
  ).id;
  equipamentos(db).salvar('53', { contratoValor: 385000, contratoReajuste: 400000, contratoVencimento: '2026-11-20' }, u.id);
  app = criarApp(db, { cookieSeguro: false });
  for (const [k, e] of [
    ['angelise', 'financeiro@lucminas.com.br'],
    ['junior', 'locacao@lucminas.com.br'],
  ]) {
    const r = await app.inject({ method: 'POST', url: '/api/sessao', payload: { email: e, senha: 'senha-teste-1' } });
    cookies[k] = String(r.headers['set-cookie']).split(';')[0];
  }
});

describe('reajuste de valor', () => {
  it('operações registra, financeiro aprova: valor muda no cliente e na ficha, com o antes guardado', async () => {
    expect((await como('junior')('POST', '/api/movimentacoes', { tipo: 'reajuste', clienteId, data: '2026-12-01', itens: [{ frota: '99', novo: 1 }] })).statusCode).toBe(400);
    expect((await como('junior')('POST', '/api/movimentacoes', { tipo: 'reajuste', clienteId, data: '2026-12-01', itens: [] })).statusCode).toBe(400);
    const r = await como('junior')('POST', '/api/movimentacoes', {
      tipo: 'reajuste',
      clienteId,
      data: '2026-12-01',
      percentual: 3.9,
      renovaAte: '2027-11-20',
      observacoes: 'IPCA anual',
      itens: [
        { frota: 'FT53', novo: 400000 },
        { frota: '63', novo: 400000 },
      ],
    });
    expect(r.statusCode).toBe(201);
    const m = r.json();
    expect(m).toMatchObject({ tipo: 'reajuste', status: 'pendente', frota: '53, 63', clienteNome: 'METALFISA' });
    expect(m.dados.itens).toEqual([
      { frota: '53', antes: 385000, novo: 400000 },
      { frota: '63', antes: 385000, novo: 400000 },
    ]);
    // ainda não aplicou
    const antes = (await como('angelise')('GET', '/api/clientes')).json();
    expect((antes.clientes ?? antes).find((c: { id: string }) => c.id === clienteId).frotas[0].valor).toBe(385000);

    const ap = await como('angelise')('POST', `/api/movimentacoes/${m.id}/aprovar`);
    expect(ap.statusCode).toBe(200);
    expect(ap.json().status).toBe('aprovada');
    const depois = (await como('angelise')('GET', '/api/clientes')).json();
    const c = (depois.clientes ?? depois).find((x: { id: string }) => x.id === clienteId);
    expect(c.frotas.map((f: { valor: number; fim?: string }) => [f.valor, f.fim])).toEqual([
      [400000, '2027-11-20'],
      [400000, '2027-11-20'],
    ]);
    const ficha = equipamentos(db).buscar('53')!;
    expect(ficha).toMatchObject({ contratoValor: 400000, contratoVencimento: '2027-11-20' });
    expect(ficha.contratoReajuste).toBeUndefined();
  });

  it('financeiro registra e já aplica; devolução guarda o valor que a frota tinha', async () => {
    const m = (await como('angelise')('POST', '/api/movimentacoes', { tipo: 'reajuste', clienteId, data: '2026-12-01', itens: [{ frota: '63', novo: 410000 }] })).json();
    expect(m.status).toBe('aprovada');
    const d = (await como('angelise')('POST', '/api/movimentacoes', { tipo: 'devolucao', frota: '63', data: '2026-12-10' })).json();
    expect(d.dados.valorAnterior).toBe(410000);
  });

  it('locação, troca e devolução mantêm o contrato da ficha; venda tira da frota; compra cria a ficha', async () => {
    const base = { frete: '', gas: 0, contrato: '', prazoPagamento: '', emails: [], contatoNome: '', contatoTelefone: '', descricao: '', observacoes: '' };
    const a = como('angelise');
    const ficha = (f: string) => equipamentos(db).buscar(f);
    const clienteDe = async (f: string) => {
      const r = (await a('GET', '/api/clientes')).json();
      return (r.clientes ?? r).find((c: { frotas: { numero: string }[] }) => c.frotas.some((x) => x.numero === f))?.nome ?? null;
    };

    // compra: FT121 entra na frota com a ficha montada
    let r = await a('POST', '/api/movimentacoes', {
      ...base,
      tipo: 'compra',
      frota: 'FT121',
      data: '2026-11-10',
      clienteNome: 'TRADIMAQ',
      valor: 9500000,
      nf: '4521',
      descricao: 'YALE GLP050VX',
      maquina: { marca: 'YALE', modelo: '50 VX', serie: 'A975Y99999', ano: 2024, capacidade: 2500, combustivel: 'glp' },
    });
    expect(r.statusCode).toBe(201);
    expect(ficha('121')).toMatchObject({ descricao: 'YALE GLP050VX', marca: 'YALE', serie: 'A975Y99999', ano: 2024, combustivel: 'glp', compraValor: 9500000, compraNf: '4521', fornecedor: 'TRADIMAQ', compraData: '2026-11-10' });
    // não compra de novo um número que já existe
    expect((await a('POST', '/api/movimentacoes', { ...base, tipo: 'compra', frota: '121', data: '2026-11-11', descricao: 'X' })).statusCode).toBe(409);
    expect((await a('POST', '/api/movimentacoes', { ...base, tipo: 'compra', frota: '122', data: '2026-11-11' })).statusCode).toBe(400);

    // locação da 121: contrato vai para a ficha
    r = await a('POST', '/api/movimentacoes', { ...base, tipo: 'locacao', frota: '121', data: '2026-11-12', clienteId, valor: 390000, fim: '2027-11-12' });
    expect(r.statusCode).toBe(201);
    expect(ficha('121')).toMatchObject({ contratoValor: 390000, contratoVencimento: '2027-11-12' });

    // troca 53 → 121? (121 já está no cliente) — troca da 63 pela 130: contrato passa para a 130
    equipamentos(db).salvar('63', { contratoNumero: '034/2024', contratoValor: 385000, contratoVencimento: '2027-01-01' }, 1);
    r = await a('POST', '/api/movimentacoes', { ...base, tipo: 'troca', frota: '63', frotaNova: '130', data: '2026-11-12', valor: null });
    expect(r.statusCode).toBe(201);
    expect(ficha('130')).toMatchObject({ contratoNumero: '034/2024', contratoValor: 385000, contratoVencimento: '2027-01-01' });
    expect(ficha('63')!.contratoNumero).toBeUndefined();
    expect(await clienteDe('130')).toBe('METALFISA');

    // devolução da 121: contrato sai da ficha
    r = await a('POST', '/api/movimentacoes', { ...base, tipo: 'devolucao', frota: '121', data: '2026-11-13', valor: null });
    expect(r.json().dados.valorAnterior).toBe(390000);
    expect(ficha('121')!.contratoValor).toBeUndefined();
    expect(await clienteDe('121')).toBeNull();

    // venda da 53 (estava locada na METALFISA): sai do cliente, ficha baixada
    r = await a('POST', '/api/movimentacoes', { ...base, tipo: 'venda', frota: '53', data: '2026-11-14', clienteNome: 'FENIX NOVUS', valor: 6500000, nf: '1200' });
    expect(r.statusCode).toBe(201);
    expect(r.json().dados.valorAnterior).toBe(385000);
    expect(await clienteDe('53')).toBeNull();
    expect(ficha('53')).toMatchObject({ situacao: 'baixada', vendaValor: 6500000, vendaComprador: 'FENIX NOVUS', vendaNf: '1200', vendaData: '2026-11-14' });
    expect(ficha('53')!.contratoValor).toBeUndefined();
    // máquina vendida não volta a ser locada
    expect((await a('POST', '/api/movimentacoes', { ...base, tipo: 'locacao', frota: '53', data: '2026-11-15', clienteId, valor: 1 })).statusCode).toBe(409);
    expect((await a('POST', '/api/movimentacoes', { ...base, tipo: 'venda', frota: '53', data: '2026-11-15' })).statusCode).toBe(409);
  });
});

describe('modalidade e janela da conferência', () => {
  it('locação grava contrato/esporádico na frota do cliente', async () => {
    const r = await como('angelise')('POST', '/api/movimentacoes', {
      tipo: 'locacao', frota: '90', data: '2026-11-12', clienteId, valor: 100000, modalidade: 'esporadico',
      frete: '', gas: 0, contrato: '', prazoPagamento: '', emails: [], contatoNome: '', contatoTelefone: '', descricao: '', observacoes: '',
    });
    expect(r.statusCode).toBe(201);
    const l = (await como('angelise')('GET', '/api/clientes')).json();
    const c = (l.clientes ?? l).find((x: { id: string }) => x.id === clienteId);
    expect(c.frotas.find((f: { numero: string }) => f.numero === '90').modalidade).toBe('esporadico');
    expect((await como('angelise')('POST', '/api/movimentacoes', { tipo: 'locacao', frota: '91', data: '2026-11-12', clienteId, modalidade: 'x' })).statusCode).toBe(400);
  });
  it('janela: do dia 25 até o dia 5 do mês seguinte', async () => {
    const { janelaConferencia } = await import('./app.js');
    expect(janelaConferencia('2026-11-12', 25, 5)).toEqual({ aberta: false, referencia: '2026-11' });
    expect(janelaConferencia('2026-11-25', 25, 5)).toEqual({ aberta: true, referencia: '2026-11' });
    expect(janelaConferencia('2026-12-03', 25, 5)).toEqual({ aberta: true, referencia: '2026-11' });
    expect(janelaConferencia('2027-01-05', 25, 5)).toEqual({ aberta: true, referencia: '2026-12' });
    expect(janelaConferencia('2027-01-06', 25, 5).aberta).toBe(false);
  });
});

describe('novas movimentações e frete do cliente', () => {
  it('o que outra pessoa registra aparece como nova até a pessoa dar ciente; quem registra já viu', async () => {
    const base = { frete: 'cliente', freteValor: 35000, gas: 0, contrato: '', prazoPagamento: '', emails: [], contatoNome: '', contatoTelefone: '', descricao: '', observacoes: '', modalidade: 'contrato' };
    // a Angelise registra (já aplicada): para ela não é nova; para o Júnior é
    const m = (await como('angelise')('POST', '/api/movimentacoes', { ...base, tipo: 'locacao', frota: '95', data: '2026-11-12', clienteId, valor: 100000 })).json();
    expect(m.dados.freteValor).toBe(35000);
    const cli = (await como('angelise')('GET', '/api/clientes')).json();
    expect((cli.clientes ?? cli).find((c: { id: string }) => c.id === clienteId).frotas.find((f: { numero: string }) => f.numero === '95')).toMatchObject({ frete: 'cliente', freteValor: 35000 });
    const daAngelise = (await como('angelise')('GET', '/api/movimentacoes')).json();
    expect(daAngelise.find((x: { id: string }) => x.id === m.id).vista).toBe(true);
    let doJunior = (await como('junior')('GET', '/api/movimentacoes')).json();
    expect(doJunior.find((x: { id: string }) => x.id === m.id).vista).toBe(false);
    await como('junior')('POST', '/api/movimentacoes/vistas', { ids: [m.id] });
    doJunior = (await como('junior')('GET', '/api/movimentacoes')).json();
    expect(doJunior.every((x: { vista: boolean }) => x.vista)).toBe(true);
    // o Júnior registra (pendente): nova para a Angelise; ao aprovar, deixa de ser
    const p = (await como('junior')('POST', '/api/movimentacoes', { ...base, frete: 'lucminas', tipo: 'locacao', frota: '96', data: '2026-11-12', clienteId, valor: 100000 })).json();
    expect(p.dados.freteValor).toBeUndefined();
    expect((await como('angelise')('GET', '/api/movimentacoes')).json().find((x: { id: string }) => x.id === p.id).vista).toBe(false);
    await como('angelise')('POST', `/api/movimentacoes/${p.id}/aprovar`);
    expect((await como('angelise')('GET', '/api/movimentacoes')).json().find((x: { id: string }) => x.id === p.id).vista).toBe(true);
    // marcar todas
    expect((await como('angelise')('POST', '/api/movimentacoes/vistas', { ids: 'x' })).statusCode).toBe(400);
    expect((await como('angelise')('POST', '/api/movimentacoes/vistas', {})).statusCode).toBe(200);
  });
});

describe('ok nas pendências', () => {
  it('dá ok, lista com quem e quando, desfaz; chave inválida é recusada', async () => {
    const a = como('angelise');
    expect((await a('POST', '/api/avisos-ok', { chave: 'envio:abc-123', obs: 'cliente trocou o e-mail' })).statusCode).toBe(200);
    expect((await a('POST', '/api/avisos-ok', { chave: 'x; drop' })).statusCode).toBe(400);
    let l = (await como('junior')('GET', '/api/avisos-ok')).json();
    expect(l).toEqual([expect.objectContaining({ chave: 'envio:abc-123', feitoPor: 'Angelise', obs: 'cliente trocou o e-mail' })]);
    await a('POST', '/api/avisos-ok/desfazer', { chave: 'envio:abc-123' });
    l = (await a('GET', '/api/avisos-ok')).json();
    expect(l).toEqual([]);
  });
});
