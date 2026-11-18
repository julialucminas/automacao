import { describe, expect, it } from 'vitest';
import { lerPlanilhaLocacao, proporCadastros } from './cadastroLocacao';
import type { Cliente } from '../types';

const cli = (nome: string, extra: Partial<Cliente> = {}) =>
  ({ id: nome, nome, apelidos: [], cnpj: '', para: ['a@x.com'], cc: [], observacoes: '', regra: 'dia', diaEmissao: null, inicioLocacao: null, periodoDias: null, frotas: [], ativo: true, atualizadoEm: '', ...extra }) as Cliente;

const CAB = ['Nome no sistema', 'Situação', 'O que conferir', 'Código locação', 'Razão social', 'Nome fantasia', 'CNPJ/CPF', 'Inscrição estadual', 'Cidade', 'UF', 'Telefone', 'Celular', 'E-mail na locação (só referência, NÃO será usado)'];

describe('completar cadastro com a planilha do sistema de locação', () => {
  it('lê pelo cabeçalho, casa por nome/apelido, ignora e-mail e não troca o que existe', () => {
    const linhas = lerPlanilhaLocacao([
      CAB,
      ['ACME', 'OK', null, '00123', 'ACME LTDA', 'ACME', '11.111.111/0001-11', '123', 'CONTAGEM', 'MG', '', '31-9999', 'outro@acme.com'],
      ['BETA SA', 'Conferir', 'confira a filial', '00456', 'BETA S/A', '', '22.222.222/0001-22', '', 'BH', 'MG', '31-3333', '', ''],
      ['GAMA', 'Escolher', 'empresas diferentes', null, null, null, null, null, null, null, null, null, null],
      ['ZETA', 'OK', null, '1', 'ZETA', '', '33.333.333/0001-33', '', '', '', '', '', ''],
    ]);
    expect(linhas[0]).toMatchObject({ nomeSistema: 'ACME', cnpj: '11.111.111/0001-11', telefone: '31-9999' });
    expect(JSON.stringify(linhas)).not.toContain('outro@acme.com');

    const p = proporCadastros(linhas, [cli('ACME'), cli('BETA', { apelidos: ['BETA S.A.'], cnpj: '99.999.999/0001-99', cadastro: { cidade: 'NOVA LIMA' } }), cli('GAMA')]);
    expect(p.map((x) => x.acao)).toEqual(['completar', 'completar', 'sem_dados', 'sem_cliente']);
    expect(p[0].item).toMatchObject({ id: 'ACME', cnpj: '11.111.111/0001-11' });
    expect(p[1].cnpjDiferente).toBe(true);
    expect(p[1].novos.map((n) => n.rotulo)).not.toContain('CNPJ');
    expect(p[1].novos.map((n) => n.rotulo)).not.toContain('Cidade');
    expect(p[1].novos.find((n) => n.rotulo === 'Conferir')?.valor).toBe('confira a filial');
    expect(() => lerPlanilhaLocacao([['nome', 'email']])).toThrow(/Nome no sistema/);
  });
});
