import { describe, expect, it } from 'vitest';
import { abrirBanco, repositorio } from './db.js';
import { equipamentos } from './equipamentos.js';
import { fotos } from './fotos.js';
import { gerarHash } from './senha.js';

describe('foto mensal', () => {
  it('soma a receita dos clientes ativos, conta frota sem as baixadas e congela o mês que passou', async () => {
    const db = abrirBanco(':memory:');
    const repo = repositorio(db);
    const u = repo.criarUsuario('a@lucminas.com.br', 'A', await gerarHash('senha-teste-1'), '', 'admin');
    const base = { apelidos: [], cnpj: '', para: ['x@y.com'], cc: [], observacoes: '' };
    repo.salvarCliente({ ...base, nome: 'UM', frotas: [{ numero: '1', valor: 300000, descricao: '', modalidade: 'contrato' }, { numero: '2', valor: 200000, descricao: '' }] }, u.id, 't');
    repo.salvarCliente({ ...base, nome: 'DOIS', frotas: [{ numero: '3', valor: 100000, descricao: '' }] }, u.id, 't');
    const eq = equipamentos(db);
    eq.salvar('4', { marca: 'YALE' }, u.id);
    eq.salvar('5', { situacao: 'baixada' }, u.id);
    const f = fotos(db);
    expect(f.gravar(new Date('2026-10-31T12:00:00Z'))).toBe('2026-10');
    repo.salvarCliente({ ...base, nome: 'TRES', frotas: [{ numero: '4', valor: 50000, descricao: '' }] }, u.id, 't');
    f.gravar(new Date('2026-11-05T12:00:00Z'));
    f.gravar(new Date('2026-11-06T12:00:00Z'));
    expect(f.listar()).toMatchObject([
      { mes: '2026-10', receita: 600000, receitaContrato: 300000, locadas: 3, frota: 4, clientes: 2 },
      { mes: '2026-11', receita: 650000, locadas: 4, frota: 4, clientes: 3 },
    ]);
    // 1º de dezembro às 01h UTC ainda é 30/11 em Brasília
    expect(f.gravar(new Date('2026-12-01T01:00:00Z'))).toBe('2026-11');
  });
});
