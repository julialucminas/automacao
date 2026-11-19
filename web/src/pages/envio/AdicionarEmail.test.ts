import { describe, expect, it } from 'vitest';
import { separarEmails } from './AdicionarEmail';

describe('separar e-mails colados', () => {
  it('aceita vírgula, ponto e vírgula, espaço e <>; tira repetidos e põe em minúsculas', () => {
    expect(separarEmails(' Compras@Cliente.com; nf@cliente.com, <ana@cliente.com>  nf@cliente.com\n')).toEqual(['compras@cliente.com', 'nf@cliente.com', 'ana@cliente.com']);
    expect(separarEmails('   ')).toEqual([]);
  });
});
