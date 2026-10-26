import { describe, expect, it } from 'vitest';
import type { ArquivoLido, Cliente } from '../types';
import { chaveEmpresa } from './normalizar';
import { classificar, encontrarCliente, parear, statusDoItem } from './pareamento';
import { decodificarNomeZip } from './leitura';

const arq = (nome: string): ArquivoLido => ({ nome, caminho: nome, blob: new Blob() });
const cli = (id: string, nome: string, apelidos: string[] = []): Cliente => ({
  id,
  nome,
  apelidos,
  cnpj: '',
  para: [`${id}@x.com`],
  cc: [],
  observacoes: '',
  ativo: true,
  atualizadoEm: '',
});

describe('classificar', () => {
  it('reconhece o padrão combinado', () => {
    expect(classificar('1234 METALURGICA SERRA AZUL.PDF')).toEqual({
      tipo: 'fatura',
      numero: '1234',
      empresa: 'METALURGICA SERRA AZUL',
    });
    expect(classificar('BOLETO 1234.PDF')).toEqual({ tipo: 'boleto', numero: '1234' });
  });

  it('tolera variações comuns', () => {
    expect(classificar('boleto 001234.pdf')).toEqual({ tipo: 'boleto', numero: '1234' });
    expect(classificar('BOLETO-1234.PDF')).toEqual({ tipo: 'boleto', numero: '1234' });
    expect(classificar('BOLETO1234.PDF')).toEqual({ tipo: 'boleto', numero: '1234' });
    expect(classificar('1234 - Cerâmica  Santa Luzia .pdf')).toMatchObject({ tipo: 'fatura', numero: '1234' });
  });

  it('não confunde outros arquivos', () => {
    expect(classificar('RELATORIO.PDF').tipo).toBe('desconhecido');
    expect(classificar('1234 EMPRESA.DOCX').tipo).toBe('desconhecido');
    expect(classificar('1234.PDF').tipo).toBe('desconhecido');
  });
});

describe('chaveEmpresa', () => {
  it('ignora acento, pontuação, espaços e sufixo societário', () => {
    const k = chaveEmpresa('CERAMICA SANTA LUZIA');
    expect(chaveEmpresa('Cerâmica Santa Luzia Ltda.')).toBe(k);
    expect(chaveEmpresa('CERÂMICA  SANTA LUZIA - ME')).toBe(k);
    expect(chaveEmpresa('Ceramica Santa Luzia S/A')).toBe(k);
    expect(chaveEmpresa('Ceramica Santa Luzia S.A.')).toBe(k);
  });
});

describe('encontrarCliente', () => {
  const clientes = [cli('a', 'METALURGICA SERRA AZUL', ['SERRA AZUL']), cli('b', 'CERÂMICA SANTA LUZIA')];
  it('acha por nome e por apelido', () => {
    expect(encontrarCliente('METALÚRGICA SERRA AZUL LTDA', clientes)).toEqual({ clienteId: 'a', vinculo: 'nome' });
    expect(encontrarCliente('SERRA AZUL', clientes)).toEqual({ clienteId: 'a', vinculo: 'apelido' });
    expect(encontrarCliente('CERAMICA SANTA LUZIA', clientes)?.clienteId).toBe('b');
    expect(encontrarCliente('OUTRA EMPRESA', clientes)).toBeNull();
  });
  it('ignora clientes inativos', () => {
    const inativo = { ...cli('c', 'EMPRESA VELHA'), ativo: false };
    expect(encontrarCliente('EMPRESA VELHA', [inativo])).toBeNull();
  });
});

describe('parear', () => {
  const clientes = [cli('a', 'EMPRESA A'), cli('b', 'EMPRESA B')];

  it('junta fatura e boleto e aponta cada tipo de problema', () => {
    const { itens, naoReconhecidos } = parear(
      [
        arq('1001 EMPRESA A.PDF'),
        arq('BOLETO 1001.PDF'),
        arq('1002 EMPRESA B.PDF'), // sem boleto
        arq('1003 EMPRESA NOVA.PDF'),
        arq('BOLETO 1003.PDF'), // sem cadastro
        arq('BOLETO 1004.PDF'), // órfão
        arq('1005 EMPRESA A.PDF'),
        arq('1005 EMPRESA B.PDF'),
        arq('BOLETO 1005.PDF'), // número repetido
        arq('PLANILHA.PDF'),
      ],
      clientes,
    );
    const st = Object.fromEntries(itens.map((i) => [`${i.numero}${i.empresaNoArquivo}`, statusDoItem(i)]));
    expect(st).toEqual({
      '1001EMPRESA A': 'pronto',
      '1002EMPRESA B': 'sem_boleto',
      '1003EMPRESA NOVA': 'sem_cadastro',
      '1004': 'boleto_sem_fatura',
      '1005EMPRESA A': 'numero_duplicado',
      '1005EMPRESA B': 'numero_duplicado',
    });
    expect(naoReconhecidos.map((a) => a.nome)).toEqual(['PLANILHA.PDF']);
  });

  it('marca para envio só os prontos', () => {
    const { itens } = parear([arq('1 EMPRESA A.PDF'), arq('BOLETO 1.PDF'), arq('2 EMPRESA B.PDF')], clientes);
    expect(itens.map((i) => i.marcado)).toEqual([true, false]);
  });

  it('pareia mesmo com zeros à esquerda diferentes', () => {
    const { itens } = parear([arq('0042 EMPRESA A.PDF'), arq('BOLETO 42.PDF')], clientes);
    expect(itens).toHaveLength(1);
    expect(statusDoItem(itens[0])).toBe('pronto');
  });
});

describe('decodificarNomeZip', () => {
  it('lê nomes em UTF-8 e em CP850 (zip do Windows)', () => {
    expect(decodificarNomeZip(new TextEncoder().encode('1240 CERÂMICA.PDF'))).toBe('1240 CERÂMICA.PDF');
    // "CERÂMICA" em CP850: Â = 0xB6
    const cp850 = Uint8Array.from([0x43, 0x45, 0x52, 0xb6, 0x4d, 0x49, 0x43, 0x41]);
    expect(decodificarNomeZip(cp850)).toBe('CERÂMICA');
  });
});
