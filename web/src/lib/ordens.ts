import type { Ordem, StatusOS, TipoOS } from '../types';
import { dataBr } from './calendario';
import { carregarImagem } from './relatorioLocacoes';

export const TIPOS_OS: Record<TipoOS, string> = {
  preventiva: 'Preventiva',
  corretiva: 'Corretiva',
  entrega: 'Entrega (saída para o cliente)',
  devolucao: 'Devolução (volta do cliente)',
  vistoria: 'Vistoria',
  externo: 'Serviço externo (máquina do cliente)',
};

export const STATUS_OS: Record<StatusOS, { rotulo: string; tom: 'ok' | 'warn' | 'info' | 'neutro' | 'bad'; ordem: number }> = {
  concluida: { rotulo: 'Concluída · revisar', tom: 'warn', ordem: 0 },
  execucao: { rotulo: 'Em execução', tom: 'info', ordem: 1 },
  aguardando_peca: { rotulo: 'Aguardando peça', tom: 'warn', ordem: 2 },
  agendada: { rotulo: 'Agendada', tom: 'neutro', ordem: 3 },
  aberta: { rotulo: 'Aberta', tom: 'neutro', ordem: 4 },
  encerrada: { rotulo: 'Encerrada', tom: 'ok', ordem: 5 },
  cancelada: { rotulo: 'Cancelada', tom: 'neutro', ordem: 6 },
};

export const RESPOSTAS = { ok: 'OK', problema: 'Problema', na: 'Não se aplica' } as const;

export const progressoChecklist = (o: Ordem) => {
  const l = o.execucao.checklist ?? [];
  return { feitos: l.filter((c) => c.resposta).length, total: l.length, problemas: l.filter((c) => c.resposta === 'problema').length };
};

/** O que ainda falta para o técnico poder concluir (o servidor confere de novo). */
export function faltaParaConcluir(o: Ordem): string[] {
  const ex = o.execucao;
  const f: string[] = [];
  if (!ex.checkin) f.push('check-in');
  if (o.tipo !== 'externo' && (ex.horimetro === undefined || ex.horimetro === null)) f.push('horímetro');
  const p = progressoChecklist(o);
  if (p.feitos < p.total) f.push(`checklist (${p.total - p.feitos})`);
  if (!ex.servico?.trim()) f.push('o que foi feito');
  if (!ex.assinatura && !ex.semAssinatura?.trim()) f.push('assinatura');
  return f;
}

export const urlArquivo = (o: Ordem, nome: string) => `/api/ordens/${o.id}/arquivos/${encodeURIComponent(nome)}`;

const AMARELO: [number, number, number] = [255, 196, 0];
const PRETO: [number, number, number] = [20, 20, 20];
const CINZA: [number, number, number] = [110, 110, 110];
const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Relatório da OS em PDF (com a logo, checklist, peças, fotos e assinatura).
 * Devolve o PDF em base64 (para o e-mail) e o Blob (para baixar).
 */
export async function gerarPdfOS(o: Ordem, extra: { equipamento: string; serie?: string | null }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const L = doc.internal.pageSize.getWidth();
  const A = doc.internal.pageSize.getHeight();
  const M = 14;
  const ex = o.execucao;

  const logo = await carregarImagem('./logo-lucminas.png');
  if (logo) doc.addImage(logo.dado, 'PNG', M, 10, (logo.w / logo.h) * 11, 11);
  doc
    .setFont('helvetica', 'bold')
    .setFontSize(16)
    .setTextColor(...PRETO)
    .text(`Ordem de serviço nº ${o.numero}`, L - M, 15, { align: 'right' });
  doc
    .setFont('helvetica', 'normal')
    .setFontSize(9.5)
    .setTextColor(...CINZA)
    .text(`${TIPOS_OS[o.tipo]}${o.tipoVisita ? ` · ${o.tipoVisita}` : ''}`, L - M, 20.5, { align: 'right' });
  doc.setFillColor(...AMARELO).rect(M, 25, L - 2 * M, 1.4, 'F');

  const dados: [string, string][] = [
    ['Cliente', o.clienteNome || '—'],
    ['Equipamento', `FT${o.frota}${extra.equipamento ? ` · ${extra.equipamento}` : ''}${extra.serie ? ` · série ${extra.serie}` : ''}`],
    ['Técnico', o.tecnicoNome || '—'],
    ['Chegada', ex.checkin ? hora(ex.checkin.em) : '—'],
    ['Saída', ex.checkout ? hora(ex.checkout.em) : o.concluidaEm ? hora(o.concluidaEm) : '—'],
    ['Horímetro', ex.horimetro != null ? `${ex.horimetro.toLocaleString('pt-BR')} h` : '—'],
  ];
  if (o.descricao) dados.push(['Pedido', o.descricao]);
  autoTable(doc, {
    startY: 30,
    body: dados,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: { top: 1.2, bottom: 1.2, left: 0, right: 2 }, textColor: PRETO },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 32, textColor: CINZA } },
    margin: { left: M, right: M },
  });
  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;

  const titulo = (t: string) => {
    if (y > A - 30) {
      doc.addPage();
      y = 18;
    }
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(11)
      .setTextColor(...PRETO)
      .text(t.toUpperCase(), M, y);
    y += 2;
  };

  titulo('Serviço realizado');
  const linhas = doc
    .setFont('helvetica', 'normal')
    .setFontSize(10)
    .splitTextToSize(ex.servico || '—', L - 2 * M);
  doc.text(linhas, M, y + 4);
  y += 4 + linhas.length * 4.6 + 4;

  if ((ex.pecas ?? []).length) {
    titulo('Peças utilizadas');
    autoTable(doc, {
      startY: y + 1,
      head: [['Código', 'Peça', 'Qtd.']],
      body: (ex.pecas ?? []).map((p) => [p.codigo || '—', p.descricao, String(p.quantidade).replace('.', ',')]),
      styles: { fontSize: 9.5, textColor: PRETO },
      headStyles: { fillColor: [246, 245, 241], textColor: PRETO, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 30 }, 2: { cellWidth: 16, halign: 'right' } },
      margin: { left: M, right: M },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }

  if ((ex.checklist ?? []).length) {
    titulo('Checklist');
    autoTable(doc, {
      startY: y + 1,
      head: [['Item', 'Situação', 'Observação']],
      body: (ex.checklist ?? []).map((c) => [c.item, c.resposta ? RESPOSTAS[c.resposta] : '—', c.obs || '']),
      styles: { fontSize: 9, textColor: PRETO, cellPadding: 1.4 },
      headStyles: { fillColor: [246, 245, 241], textColor: PRETO, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 70 }, 1: { cellWidth: 28 } },
      didParseCell: (d) => {
        if (d.section === 'body' && d.column.index === 1 && d.cell.raw === 'Problema') d.cell.styles.textColor = [155, 35, 24];
      },
      margin: { left: M, right: M },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }

  const fotos = (ex.fotos ?? []).filter((f) => !f.startsWith('pendente:'));
  if (fotos.length) {
    titulo('Fotos');
    y += 3;
    const larg = (L - 2 * M - 3 * 4) / 4;
    let col = 0;
    for (const f of fotos) {
      const img = await carregarImagem(urlArquivo(o, f));
      if (!img) continue;
      const alt = Math.min(larg * (img.h / img.w), 60);
      if (y + alt > A - 20) {
        doc.addPage();
        y = 18;
        col = 0;
      }
      doc.addImage(img.dado, 'JPEG', M + col * (larg + 4), y, larg, alt);
      col++;
      if (col === 4) {
        col = 0;
        y += alt + 4;
      }
    }
    if (col) y += 50;
    y += 2;
  }

  titulo('Assinatura do cliente');
  if (ex.assinatura && ex.assinatura !== 'pendente') {
    const ass = await carregarImagem(urlArquivo(o, ex.assinatura));
    if (ass) {
      const w = 70;
      const h = Math.min(w * (ass.h / ass.w), 30);
      if (y + h + 12 > A - 15) {
        doc.addPage();
        y = 18;
      }
      doc.addImage(ass.dado, 'PNG', M, y + 2, w, h);
      y += h + 4;
    }
    doc.setDrawColor(...CINZA).line(M, y, M + 80, y);
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(9.5)
      .setTextColor(...CINZA)
      .text(ex.assinadoPor || '', M, y + 4.5);
  } else {
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(10)
      .setTextColor(...CINZA)
      .text(`Sem assinatura: ${ex.semAssinatura || '—'}`, M, y + 5);
  }

  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(8)
      .setTextColor(...CINZA)
      .text(`Lucminas Empilhadeiras · OS ${o.numero} · ${o.agendadaPara ? dataBr(o.agendadaPara) : ''}`, M, A - 8)
      .text(`página ${i} de ${paginas}`, L - M, A - 8, { align: 'right' });
  }
  const blob = doc.output('blob');
  const base64 = doc.output('datauristring').split(',')[1];
  return { blob, base64, nome: `OS ${o.numero} FT${o.frota}.pdf` };
}
