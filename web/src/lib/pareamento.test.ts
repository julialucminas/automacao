import { describe, expect, it } from 'vitest';
import type { ArquivoLido, Cliente, Lote } from '../types';
import { chaveEmpresa } from './normalizar';
import { acrescentarAoLote, anexarNoItem, classificar, encontrarCliente, parear, statusDoItem, sugerirClientes } from './pareamento';
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
  regra: 'dia',
    diaEmissao: null,
    inicioLocacao: null,
    periodoDias: null,
  frotas: [],
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

describe('sugerirClientes', () => {
  const clientes = [cli('m', 'MINASBEV'), cli('s', 'SETE LAGOS'), cli('a', 'AD'), cli('t', 'TOP ANDAIMES'), cli('x', 'ADAMANTINA')];
  const nomes = (e: string) => sugerirClientes(e, clientes).map((c) => c.nome);
  it('acha o nome curto dentro da razão social', () => {
    expect(nomes('MINASBEV INDUSTRIA DE BEBIDAS LTDA')).toEqual(['MINASBEV']);
    expect(nomes('MINERACAO SETE LAGOS')).toEqual(['SETE LAGOS']);
    expect(nomes('TOP ANDAIMES E ESCORAMENTOS')[0]).toBe('TOP ANDAIMES');
  });
  it('siglas só contam no começo', () => {
    expect(nomes('AD CIMENTOS')).toEqual(['AD']);
    expect(nomes('MATERIAIS AD')).toEqual([]);
  });
  it('não sugere nada sem relação', () => {
    expect(nomes('EMPRESA DESCONHECIDA')).toEqual([]);
  });
});

describe('acrescentar arquivos a um lote aberto', () => {
  const arq = (nome: string): ArquivoLido => ({ nome, caminho: nome, blob: new Blob(['%PDF']) });
  const cli = [{ id: 'm', nome: 'MINASBEV', apelidos: [], cnpj: '', para: ['a@m.com'], cc: [], observacoes: '', regra: 'dia', diaEmissao: 5, inicioLocacao: null, periodoDias: null, frotas: [], ativo: true, atualizadoEm: '' }] as unknown as Cliente[];
  const base = (): Lote => {
    const { itens, naoReconhecidos } = parear([arq('1234 MINASBEV.pdf'), arq('BOLETO 1234.pdf'), arq('1235 MINASBEV.pdf')], cli);
    return { id: '1', referencia: '2026-10', origem: 'x', criadoEm: '', itens, naoReconhecidos };
  };

  it('completa a fatura que estava sem boleto e mantém o que já foi feito', () => {
    const l = base();
    l.itens[0] = { ...l.itens[0], enviado: true, marcado: false, observacao: 'ok' };
    const r = acrescentarAoLote(l, [arq('BOLETO 1235.pdf'), arq('1236 MINASBEV.pdf'), arq('BOLETO 1236.pdf')], cli);
    expect(r.adicionados).toBe(3);
    expect(r.completados).toEqual(['1235']); // a 1236 é nova, não "completada"
    const por = Object.fromEntries(r.lote.itens.map((i) => [i.numero, i]));
    expect(por['1234']).toMatchObject({ enviado: true, observacao: 'ok', marcado: false });
    expect(por['1235']).toMatchObject({ marcado: true, boleto: { nome: 'BOLETO 1235.pdf' } });
    expect(por['1236'].marcado).toBe(true);
  });

  it('anexa boleto com nome fora do padrão direto no item, e ele continua lá ao acrescentar mais', () => {
    const l = anexarNoItem(base(), '1235', 'boleto', arq('scan_0001.pdf'), cli);
    expect(l.itens.find((i) => i.numero === '1235')).toMatchObject({ marcado: true, boleto: { nome: 'BOLETO 1235.pdf', caminho: 'scan_0001.pdf' } });
    const r = acrescentarAoLote(l, [arq('1237 MINASBEV.pdf')], cli);
    expect(r.lote.itens.find((i) => i.numero === '1235')?.boleto?.nome).toBe('BOLETO 1235.pdf');
    expect(r.lote.naoReconhecidos).toEqual([]);
  });
});
