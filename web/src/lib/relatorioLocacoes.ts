import type { Cliente, Frota, FrotaOficina } from '../types';
import { dataBr, intervaloDoMes } from './calendario';
import { formatarReais } from './dinheiro';
import { referenciaTitulo } from './email';

/*
 * Relatório de locações ativas do mês (PDF com a logo).
 * montarRelatorio separa os dados (testável); gerarPdfLocacoes desenha o PDF.
 */

export type LinhaLocacao = { cliente: Cliente; frota: Frota; oficina: FrotaOficina | null; terminaNoMes: boolean };
export type Relatorio = {
  referencia: string;
  grupos: { cliente: Cliente; linhas: LinhaLocacao[]; total: number }[];
  terminando: LinhaLocacao[];
  oficina: { o: FrotaOficina; cliente: Cliente | null }[];
  resumo: { frotas: number; clientes: number; valorTotal: number; terminando: number; naOficina: number };
};

const comparaNumero = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });

/** Locação ativa no mês: começou até o fim do mês (ou sem data) e termina depois do início do mês (ou sem término). */
export function montarRelatorio(clientes: Cliente[], oficina: FrotaOficina[], referencia: string): Relatorio {
  const [a, m] = referencia.split('-').map(Number);
  const { de, ate } = intervaloDoMes(a, m);
  const porFrota = new Map(oficina.map((o) => [o.frota, o]));
  const grupos = clientes
    .filter((c) => c.ativo)
    .map((c) => {
      const linhas = c.frotas
        .filter((f) => (!f.inicio || f.inicio <= ate) && (!f.fim || f.fim >= de))
        .sort((x, y) => comparaNumero(x.numero, y.numero))
        .map((f) => ({ cliente: c, frota: f, oficina: porFrota.get(f.numero) ?? null, terminaNoMes: !!f.fim && f.fim >= de && f.fim <= ate }));
      return { cliente: c, linhas, total: linhas.reduce((s, l) => s + l.frota.valor, 0) };
    })
    .filter((g) => g.linhas.length)
    .sort((x, y) => x.cliente.nome.localeCompare(y.cliente.nome, 'pt-BR'));
  const todas = grupos.flatMap((g) => g.linhas);
  const terminando = todas.filter((l) => l.terminaNoMes).sort((x, y) => (x.frota.fim ?? '').localeCompare(y.frota.fim ?? ''));
  const dono = (n: string) => clientes.find((c) => c.ativo && c.frotas.some((f) => f.numero === n)) ?? null;
  const ofi = [...oficina].sort((x, y) => comparaNumero(x.frota, y.frota)).map((o) => ({ o, cliente: dono(o.frota) }));
  return {
    referencia,
    grupos,
    terminando,
    oficina: ofi,
    resumo: {
      frotas: new Set(todas.map((l) => l.frota.numero)).size,
      clientes: grupos.length,
      valorTotal: todas.reduce((s, l) => s + l.frota.valor, 0),
      terminando: terminando.length,
      naOficina: oficina.length,
    },
  };
}

const AMARELO: [number, number, number] = [255, 196, 0];
const PRETO: [number, number, number] = [20, 20, 20];
const CINZA: [number, number, number] = [110, 110, 110];
const ROXO: [number, number, number] = [91, 33, 182];
const LARANJA: [number, number, number] = [180, 83, 9];

async function carregarImagem(url: string): Promise<{ dado: string; w: number; h: number } | null> {
  try {
    const blob = await (await fetch(url)).blob();
    const dado = await new Promise<string>((ok, erro) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = erro;
      r.readAsDataURL(blob);
    });
    const img = new Image();
    await new Promise((ok, erro) => {
      img.onload = ok;
      img.onerror = erro;
      img.src = dado;
    });
    return { dado, w: img.naturalWidth, h: img.naturalHeight };
  } catch {
    return null;
  }
}

const frete = (f: Frota) => (f.frete === 'lucminas' ? 'Lucminas' : f.frete === 'cliente' ? 'Cliente' : '');

/** Gera e baixa o PDF. comValores = false esconde valores e somas (perfil de operações). */
export async function gerarPdfLocacoes(r: Relatorio, opcoes: { comValores: boolean; geradoPor: string }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const L = doc.internal.pageSize.getWidth();
  const A = doc.internal.pageSize.getHeight();
  const M = 14;
  const titulo = `Locações ativas · ${referenciaTitulo(r.referencia)}`;

  // ---- cabeçalho ----
  const logo = await carregarImagem('./logo-lucminas.png');
  if (logo) {
    const h = 11;
    doc.addImage(logo.dado, 'PNG', M, 10, (logo.w / logo.h) * h, h);
  } else {
    doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...PRETO).text('Lucminas', M, 18);
  }
  doc.setFont('helvetica', 'bold').setFontSize(17).setTextColor(...PRETO).text('Relatório de locações ativas', L - M, 15, { align: 'right' });
  const agora = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  doc
    .setFont('helvetica', 'normal')
    .setFontSize(9.5)
    .setTextColor(...CINZA)
    .text(`${referenciaTitulo(r.referencia)}  ·  gerado em ${agora}${opcoes.geradoPor ? ` por ${opcoes.geradoPor}` : ''}`, L - M, 20.5, { align: 'right' });
  doc.setFillColor(...AMARELO).rect(M, 25, L - 2 * M, 1.4, 'F');

  // ---- resumo ----
  const cartoes: [string, string, [number, number, number]?][] = [
    ['Frotas locadas', String(r.resumo.frotas)],
    ['Clientes', String(r.resumo.clientes)],
    ['Terminam no mês', String(r.resumo.terminando), r.resumo.terminando ? ROXO : undefined],
    ['Na oficina', String(r.resumo.naOficina), r.resumo.naOficina ? LARANJA : undefined],
  ];
  if (opcoes.comValores) cartoes.push(['Valor mensal das locações', formatarReais(r.resumo.valorTotal)]);
  const gap = 4;
  const w = (L - 2 * M - gap * (cartoes.length - 1)) / cartoes.length;
  cartoes.forEach(([rot, val, cor], i) => {
    const x = M + i * (w + gap);
    doc.setDrawColor(225, 222, 212).setFillColor(250, 249, 245).roundedRect(x, 30, w, 17, 2, 2, 'FD');
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...CINZA).text(rot.toUpperCase(), x + 4, 35.5);
    doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(...(cor ?? PRETO)).text(val, x + 4, 43);
  });

  // ---- tabela principal (agrupada por cliente) ----
  const cab = ['Frota', 'Equipamento', 'Início', 'Término', 'Contrato', 'Gás', 'Frete', ...(opcoes.comValores ? ['Valor mensal'] : [])];
  type Celula = string | { content: string; colSpan?: number; styles?: Record<string, unknown> };
  const corpo: Celula[][] = [];
  for (const g of r.grupos) {
    const extra = [g.cliente.contato, g.cliente.telefone].filter(Boolean).join(' · ');
    corpo.push([
      {
        content: `${g.cliente.nome}${extra ? `   ${extra}` : ''}`,
        colSpan: opcoes.comValores ? cab.length - 1 : cab.length,
        styles: { fontStyle: 'bold', fillColor: [255, 244, 204], textColor: PRETO },
      },
      ...(opcoes.comValores ? [{ content: formatarReais(g.total), styles: { fontStyle: 'bold', fillColor: [255, 244, 204], halign: 'right' } }] : []),
    ]);
    for (const l of g.linhas) {
      const f = l.frota;
      corpo.push([
        { content: `FT${f.numero}${l.oficina ? '  OFICINA' : ''}`, styles: l.oficina ? { textColor: LARANJA, fontStyle: 'bold' } : { fontStyle: 'bold' } },
        f.descricao || '',
        f.inicio ? dataBr(f.inicio) : '',
        { content: f.fim ? dataBr(f.fim) : '', styles: l.terminaNoMes ? { textColor: ROXO, fontStyle: 'bold' } : {} },
        f.contrato || '',
        f.gas ? String(f.gas) : '',
        frete(f),
        ...(opcoes.comValores ? [{ content: f.valor ? formatarReais(f.valor) : 'sem valor', styles: { halign: 'right', textColor: f.valor ? PRETO : LARANJA } }] : []),
      ]);
    }
  }
  const estilo = {
    theme: 'grid' as const,
    margin: { left: M, right: M, top: 18, bottom: 16 },
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.8, lineColor: [232, 229, 220] as [number, number, number], lineWidth: 0.2, textColor: PRETO },
    headStyles: { fillColor: PRETO, textColor: [255, 255, 255] as [number, number, number], fontStyle: 'bold' as const },
  };
  autoTable(doc, {
    ...estilo,
    startY: 53,
    head: [cab],
    body: corpo as never,
    columnStyles: { 0: { cellWidth: 26 }, 2: { cellWidth: 22 }, 3: { cellWidth: 22 }, 4: { cellWidth: 26 }, 5: { cellWidth: 12, halign: 'center' }, 6: { cellWidth: 20 } },
  });

  const proximoY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 9;
  const secao = (t: string, y: number) => {
    if (y > A - 40) {
      doc.addPage();
      y = 20;
    }
    doc.setFont('helvetica', 'bold').setFontSize(11.5).setTextColor(...PRETO).text(t, M, y);
    return y + 3;
  };

  if (r.terminando.length) {
    const y = secao(`Locações que terminam em ${referenciaTitulo(r.referencia).toLowerCase()}`, proximoY());
    autoTable(doc, {
      ...estilo,
      startY: y,
      headStyles: { ...estilo.headStyles, fillColor: ROXO },
      head: [['Término', 'Frota', 'Cliente', 'Contato', 'Início', 'Contrato']],
      body: r.terminando.map((l) => [
        l.frota.fim ? dataBr(l.frota.fim) : '',
        `FT${l.frota.numero}`,
        l.cliente.nome,
        [l.cliente.contato, l.cliente.telefone].filter(Boolean).join(' · '),
        l.frota.inicio ? dataBr(l.frota.inicio) : '',
        l.frota.contrato || '',
      ]),
    });
  }

  if (r.oficina.length) {
    const y = secao('Frotas na oficina', proximoY());
    autoTable(doc, {
      ...estilo,
      startY: y,
      headStyles: { ...estilo.headStyles, fillColor: LARANJA },
      head: [['Frota', 'Desde', 'Motivo', 'Cliente']],
      body: r.oficina.map(({ o, cliente }) => [`FT${o.frota}`, dataBr(o.desde.slice(0, 10)), o.observacao || '', cliente?.nome ?? 'sem cliente']),
    });
  }

  // ---- rodapé em todas as páginas ----
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(225, 222, 212).line(M, A - 11, L - M, A - 11);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...CINZA);
    doc.text(`Lucminas Empilhadeiras  ·  ${titulo}`, M, A - 6.5);
    doc.text(`Página ${i} de ${total}`, L - M, A - 6.5, { align: 'right' });
  }

  doc.save(`locacoes-ativas-${r.referencia}.pdf`);
}
