import { describe, expect, it } from 'vitest';
import type { Cliente } from '../types';
import { avisosDeDominio, exportarCsv, lerCsv, lerPlanilha, modeloCsv, proporImportacao } from './importacao';

// Dados fictícios no mesmo formato da planilha do financeiro
const SIMPLES = [
  ['Cliente', 'Email'],
  ['Alfa', 'joao@alfa.com.br '],
  [null, 'contas@alfa.com.br'],
  ['Beta Log', 'fin@betalog.com.br'],
  [null, 'adm@betlaog.com.br'], // erro de digitação no domínio
  [null, 'x@betalog.com'], // mesmo domínio, final diferente
  ['Gama', 'nao-e-email'],
  [null, null],
  ['alfa', 'outro@alfa.com.br'], // repetido
];

describe('lerPlanilha (formato simples)', () => {
  const r = lerPlanilha(SIMPLES);

  it('junta as linhas de continuação no cliente de cima', () => {
    expect(r.clientes.map((c) => c.nome)).toEqual(['ALFA', 'BETA LOG', 'GAMA']);
    expect(r.clientes[0].para).toEqual(['joao@alfa.com.br', 'contas@alfa.com.br', 'outro@alfa.com.br']);
    expect(r.temColunaCopia).toBe(false);
  });

  it('aponta repetição, e-mail inválido e domínios suspeitos', () => {
    expect(r.clientes[0].avisos.join()).toMatch(/Aparece de novo na linha 9/);
    expect(r.clientes[2].avisos.join()).toMatch(/não é um e-mail válido/);
    expect(r.clientes[2].avisos.join()).toMatch(/Sem e-mail: o cliente entra/);
    const beta = r.clientes[1].avisos.join(' ');
    expect(beta).toMatch(/muito parecidos: betalog\.com\.br × betlaog\.com\.br/);
    expect(beta).toMatch(/finais diferentes: betalog\.com\.br × betalog\.com/);
  });
});

describe('lerPlanilha (modelo completo)', () => {
  it('lê todas as colunas e vários e-mails por célula', () => {
    const r = lerPlanilha([
      ['Nome no arquivo', 'Outros nomes', 'CNPJ', 'Para', 'Cópia', 'Observações'],
      ['DELTA LTDA', 'DELTA; DELTA SA', '11.111.111/0001-11', 'a@delta.com.br; b@delta.com.br', 'cont@esc.com.br', 'Ligar antes'],
    ]);
    expect(r.temColunaCopia).toBe(true);
    expect(r.clientes[0]).toMatchObject({
      nome: 'DELTA LTDA',
      apelidos: ['DELTA', 'DELTA SA'],
      cnpj: '11.111.111/0001-11',
      para: ['a@delta.com.br', 'b@delta.com.br'],
      cc: ['cont@esc.com.br'],
      observacoes: 'Ligar antes',
    });
  });
});

describe('avisosDeDominio', () => {
  it('não reclama de domínios genéricos nem de domínios diferentes de verdade', () => {
    expect(avisosDeDominio(['a@gmail.com', 'b@gmail.com', 'c@empresa.com.br'])).toEqual([]);
    expect(avisosDeDominio(['a@fitlog.com.br', 'b@fitlogistica.com.br'])).toEqual([]);
  });
});

describe('proporImportacao', () => {
  const existente: Cliente = {
    id: 'x',
    nome: 'ALFA',
    apelidos: [],
    cnpj: '',
    para: ['joao@alfa.com.br'],
    cc: [],
    observacoes: '',
    regra: 'dia',
    diaEmissao: null,
    inicioLocacao: null,
    periodoDias: null,
    frotas: [],
    ativo: true,
    atualizadoEm: '',
  };
  const leitura = lerPlanilha(SIMPLES);

  it('classifica novo, atualizar e inválido; nunca remove e-mail existente', () => {
    const p = proporImportacao(leitura, [existente], 'todos_para');
    expect(p.map((x) => x.acao)).toEqual(['atualizar', 'novo', 'novo']);
    expect(p[0].input.para).toEqual(['joao@alfa.com.br', 'contas@alfa.com.br', 'outro@alfa.com.br']);
    expect(p[0].novosEmails).toEqual(['contas@alfa.com.br', 'outro@alfa.com.br']);
  });

  it('pode mandar o primeiro em Para e o resto em Cópia', () => {
    const p = proporImportacao(leitura, [], 'primeiro_para');
    expect(p[1].input.para).toEqual(['fin@betalog.com.br']);
    expect(p[1].input.cc).toEqual(['adm@betlaog.com.br', 'x@betalog.com']);
  });

  it('marca como igual quando não há nada novo', () => {
    const p = proporImportacao(lerPlanilha([['Cliente', 'Email'], ['Alfa', 'joao@alfa.com.br']]), [existente], 'todos_para');
    expect(p[0].acao).toBe('igual');
  });
});

describe('CSV', () => {
  it('o modelo baixado volta igual ao ser lido', () => {
    const linhas = lerCsv(modeloCsv());
    const r = lerPlanilha(linhas);
    expect(r.clientes[0].para).toEqual(['financeiro@exemplo.com.br', 'contas@exemplo.com.br']);
    expect(r.clientes[0].apelidos).toEqual(['EXEMPLO', 'EMPRESA EXEMPLO LTDA']);
  });
});

describe('exportarCsv', () => {
  it('o que é exportado volta igual na importação', () => {
    const c: Cliente = { id: '1', nome: 'ALFA; BETA', apelidos: ['A'], cnpj: '1', para: ['a@a.com', 'b@a.com'], cc: ['c@c.com'], observacoes: 'diz "oi"', regra: 'dia', inicioLocacao: null, periodoDias: null, diaEmissao: 5, frotas: [{ numero: 'F-1', valor: 150000, descricao: '' }], ativo: true, atualizadoEm: '' };
    const r = lerPlanilha(lerCsv(exportarCsv([c])));
    expect(r.clientes[0]).toMatchObject({ nome: 'ALFA; BETA', apelidos: ['A'], para: ['a@a.com', 'b@a.com'], cc: ['c@c.com'], observacoes: 'diz "oi"' });
  });
});

describe('faturamento na planilha', () => {
  it('lê dia de emissão e frotas e o modelo volta igual', () => {
    const r = lerPlanilha(lerCsv(modeloCsv()));
    expect(r.clientes[0].diaEmissao).toBe(5);
    expect(r.clientes[0].frotas).toEqual([
      { numero: 'F-101', valor: 150000, descricao: 'Empilhadeira 2,5t' },
      { numero: 'F-102', valor: 98050, descricao: '' },
    ]);
  });
  it('planilha sem essas colunas não mexe no cadastro', () => {
    const r = lerPlanilha([['Cliente', 'Email'], ['Alfa', 'a@alfa.com']]);
    expect(r.clientes[0].diaEmissao).toBeUndefined();
    expect(r.clientes[0].frotas).toBeUndefined();
  });
  it('avisa dia inválido e valor não entendido', () => {
    const r = lerPlanilha([['Cliente', 'Email', 'Dia de emissão', 'Frotas'], ['Alfa', 'a@alfa.com', '40', 'F1 = abc']]);
    expect(r.clientes[0].avisos.join(' ')).toMatch(/dia de emissão "40" inválido/);
    expect(r.clientes[0].avisos.join(' ')).toMatch(/não entendido/);
    expect(r.clientes[0].frotas).toEqual([{ numero: 'F1', valor: 0, descricao: '' }]);
  });
});

describe('regra por período na planilha', () => {
  it('lê início e período (inclusive data do Excel) e exporta de volta', () => {
    const r = lerPlanilha([
      ['Cliente', 'Email', 'Início da locação', 'Período (dias)'],
      ['Alfa', 'a@alfa.com', '10/10/2026', '30 dias'],
      ['Beta', 'b@beta.com', new Date(Date.UTC(2026, 10, 1)), '15'],
      ['Gama', 'g@gama.com', '10/10/2026', ''],
    ]);
    expect(r.clientes[0]).toMatchObject({ regra: 'periodo', inicioLocacao: '2026-10-10', periodoDias: 30 });
    expect(r.clientes[1]).toMatchObject({ regra: 'periodo', inicioLocacao: '2026-11-01', periodoDias: 15 });
    expect(r.clientes[2].regra).toBeUndefined();
    expect(r.clientes[2].avisos.join(' ')).toMatch(/data de início E o período/);

    const c: Cliente = { id: '1', nome: 'ALFA', apelidos: [], cnpj: '', para: ['a@alfa.com'], cc: [], observacoes: '', regra: 'periodo', diaEmissao: null, inicioLocacao: '2026-10-10', periodoDias: 30, frotas: [], ativo: true, atualizadoEm: '' };
    const volta = lerPlanilha(lerCsv(exportarCsv([c])));
    expect(volta.clientes[0]).toMatchObject({ regra: 'periodo', inicioLocacao: '2026-10-10', periodoDias: 30 });
    expect(proporImportacao(volta, [c], 'todos_para')[0].acao).toBe('igual');
  });
});

describe('planilha só de frotas', () => {
  it('atualiza frotas de cliente existente sem precisar de e-mail; cliente novo sem e-mail entra para preencher depois', () => {
    const existente: Cliente = { id: 'x', nome: 'HIGRA', apelidos: [], cnpj: '', para: ['f@higra.com'], cc: [], observacoes: '', regra: 'dia', diaEmissao: null, inicioLocacao: null, periodoDias: null, frotas: [], ativo: true, atualizadoEm: '' };
    const r = lerPlanilha([['Cliente', 'Outros nomes', 'Frotas'], ['HIGRA', 'HIGRA MINING', '9; 45'], ['NOVA EMPRESA', '', '20']]);
    const p = proporImportacao(r, [existente], 'todos_para');
    expect(p[0].acao).toBe('atualizar');
    expect(p[0].input.para).toEqual(['f@higra.com']);
    expect(p[0].input.frotas?.map((f) => f.numero)).toEqual(['9', '45']);
    expect(p[0].input.apelidos).toEqual(['HIGRA MINING']);
    expect(p[1].acao).toBe('novo');
  });
});
