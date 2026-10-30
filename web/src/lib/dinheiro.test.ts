import { describe, expect, it } from 'vitest';
import { formatarReais, lerReais, reaisParaCampo } from './dinheiro';

describe('dinheiro', () => {
  it('lê os jeitos comuns de digitar valor', () => {
    expect(lerReais('1.234,56')).toBe(123456);
    expect(lerReais('R$ 1.500')).toBe(150000);
    expect(lerReais('1500')).toBe(150000);
    expect(lerReais('980,5')).toBe(98050);
    expect(lerReais('1234.56')).toBe(123456);
    expect(lerReais('1.234.567')).toBe(123456700);
    expect(lerReais('')).toBeNull();
    expect(lerReais('abc')).toBeNull();
    expect(lerReais('1,234')).toBeNull();
  });
  it('formata e volta para o campo', () => {
    expect(formatarReais(123456).replace(/\s/g, ' ')).toBe('R$ 1.234,56');
    expect(reaisParaCampo(98050)).toBe('980,50');
  });
});
