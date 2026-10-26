import type { ArquivoLido } from '../types';

/*
 * Arquivos de EXEMPLO para demonstrar a tela sem os PDFs reais.
 * Gera PDFs mínimos (uma página com texto) cobrindo todos os casos da conferência.
 */

function pdfSimples(linhas: string[]): Blob {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => '\\' + c);
  const conteudo =
    'BT /F1 20 Tf 60 770 Td (' + esc(linhas[0]) + ') Tj /F1 12 Tf ' +
    linhas.slice(1).map((l) => '0 -22 Td (' + esc(l) + ') Tj').join(' ') +
    ' ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let s = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(s.length);
    s += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  s += offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Latin-1: cada caractere vira um byte (acentos incluídos)
  const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
  return new Blob([bytes], { type: 'application/pdf' });
}

const fatura = (n: string, empresa: string): ArquivoLido => ({
  nome: `${n} ${empresa}.PDF`,
  caminho: `FATURAS EXEMPLO/${n} ${empresa}.PDF`,
  blob: pdfSimples([`FATURA DE LOCAÇÃO Nº ${n}`, `Cliente: ${empresa}`, 'Lucminas Empilhadeiras', '', 'Documento de exemplo, gerado só para demonstração.']),
});

const boleto = (n: string): ArquivoLido => ({
  nome: `BOLETO ${n}.PDF`,
  caminho: `FATURAS EXEMPLO/BOLETO ${n}.PDF`,
  blob: pdfSimples([`BOLETO · Fatura nº ${n}`, 'Lucminas Empilhadeiras', '', 'Documento de exemplo, gerado só para demonstração.']),
});

export function arquivosDeExemplo(): ArquivoLido[] {
  return [
    fatura('1301', 'METALURGICA SERRA AZUL'), boleto('1301'),
    fatura('1302', 'TRANSPORTADORA PARAOPEBA'), boleto('1302'),
    fatura('1303', 'CONSTRUTORA ALTO VALE'), boleto('1303'),
    fatura('1304', 'DISTRIBUIDORA MINAS FORTE'), // sem boleto
    fatura('1305', 'LATICINIOS BOA ESPERANCA'), boleto('1305'), // sem acento no arquivo
    fatura('1306', 'ATACADO CENTRO OESTE'), boleto('1306'), // cliente novo
    fatura('1307', 'CERAMICA SANTA LUZIA LTDA'), boleto('1307'), // com LTDA
    fatura('1308', 'SERRA AZUL'), boleto('1308'), // apelido
    boleto('1312'), // boleto sem fatura
    { nome: 'RELATORIO DE LOCACOES.PDF', caminho: 'FATURAS EXEMPLO/RELATORIO DE LOCACOES.PDF', blob: pdfSimples(['Relatório']) },
  ];
}
