import { describe, expect, it } from 'vitest';
import type { Cliente } from '../types';
import { lerTextoMovimentacao } from './movimentacao';

const cli = (id: string, nome: string): Cliente => ({
  id,
  nome,
  apelidos: [],
  cnpj: '',
  para: [],
  cc: [],
  observacoes: '',
  regra: 'dia',
  diaEmissao: null,
  inicioLocacao: null,
  periodoDias: null,
  frotas: [],
  ativo: true,
  atualizadoEm: '',
});

const EXEMPLO = `NOVA LOCAÇÃO FT35
20/10/2026
FENIX NOVUS
- Valor da Locação: R$3.350,00
- Frete: Por conta da Lucminas
- 1 vasilhame de gás
- Tempo de contrato: 12 meses
- Prazo de pagamento: 30 dias após emissão da fatura
- E-mails: Compras@fenixsa.com.br comercial@fenixsa.com.br
- Contato: João Pedro (31) 98808-9842`;

describe('lerTextoMovimentacao', () => {
  it('lê a mensagem de nova locação do jeito que operações escreve', () => {
    expect(lerTextoMovimentacao(EXEMPLO, [])).toEqual({
      tipo: 'locacao',
      frota: '35',
      data: '2026-10-20',
      clienteId: null,
      clienteNome: 'FENIX NOVUS',
      valor: 335000,
      frete: 'lucminas',
      gas: 1,
      contrato: '12 meses',
      prazoPagamento: '30 dias após emissão da fatura',
      emails: ['compras@fenixsa.com.br', 'comercial@fenixsa.com.br'],
      contatoNome: 'João Pedro',
      contatoTelefone: '(31) 98808-9842',
    });
  });

  it('acha o cliente já cadastrado', () => {
    const r = lerTextoMovimentacao(EXEMPLO.replace('FENIX NOVUS', 'Fênix Novus Ltda'), [cli('c1', 'FENIX NOVUS')]);
    expect(r.clienteId).toBe('c1');
    expect(r.clienteNome).toBe('FENIX NOVUS');
  });

  it('troca e devolução', () => {
    expect(lerTextoMovimentacao('TROCA FT12 pela FT40\n05/11/2026\nPANEX', [])).toMatchObject({ tipo: 'troca', frota: '12', frotaNova: '40', clienteNome: 'PANEX' });
    expect(lerTextoMovimentacao('DEVOLUÇÃO FT 7\n01/11/2026', [])).toMatchObject({ tipo: 'devolucao', frota: '7', data: '2026-11-01' });
  });
});
