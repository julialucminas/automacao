import { useMemo, useRef, useState } from 'react';
import type { Cliente } from '../types';
import { useEstado } from '../state';
import { exportarCsv, lerCsv, lerPlanilha, modeloCsv, proporImportacao, type Celula, type Distribuicao, type Leitura } from '../lib/importacao';
import { Cartao, Chip, type Tom } from './ui';
import { IcAlerta, IcUpload } from './Icones';

const ACAO: Record<string, { rotulo: string; tom: Tom }> = {
  novo: { rotulo: 'Novo', tom: 'ok' },
  atualizar: { rotulo: 'Acrescentar e-mails', tom: 'info' },
  igual: { rotulo: 'Já cadastrado', tom: 'neutro' },
  invalido: { rotulo: 'Sem e-mail válido', tom: 'bad' },
};

async function lerArquivo(f: File): Promise<Celula[][]> {
  if (/\.csv$/i.test(f.name)) return lerCsv(await f.text());
  // carregado só quando precisa, para não pesar a tela inicial
  const { default: readXlsxFile } = await import('read-excel-file');
  return (await readXlsxFile(f)) as Celula[][];
}

function baixar(conteudo: string, nome: string) {
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const baixarModelo = () => baixar(modeloCsv(), 'modelo-clientes.csv');

export function exportarClientes(clientes: Cliente[]) {
  const hoje = new Date().toISOString().slice(0, 10);
  baixar(exportarCsv(clientes), `clientes-lucminas-${hoje}.csv`);
}

/** Botão + prévia da importação. A prévia aparece no lugar da lista enquanto estiver aberta. */
export function useImportacao() {
  const { clientes, importarClientes, avisar } = useEstado();
  const input = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState('');
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [dist, setDist] = useState<Distribuicao>('todos_para');
  const [desmarcados, setDesmarcados] = useState<Set<number>>(new Set());
  const [soAvisos, setSoAvisos] = useState(false);
  const [salvando, setSalvando] = useState<number | null>(null);

  const propostas = useMemo(() => (leitura ? proporImportacao(leitura, clientes, dist) : []), [leitura, clientes, dist]);
  const aplicaveis = propostas.filter((p) => (p.acao === 'novo' || p.acao === 'atualizar') && !desmarcados.has(p.lido.linha));

  const abrir = () => input.current?.click();
  const fechar = () => {
    setLeitura(null);
    setDesmarcados(new Set());
    setSoAvisos(false);
  };

  const escolher = async (f: File | undefined) => {
    if (!f) return;
    try {
      const linhas = await lerArquivo(f);
      const l = lerPlanilha(linhas);
      if (!l.clientes.length) {
        avisar('Não encontrei clientes nessa planilha.', 'bad');
        return;
      }
      setArquivo(f.name);
      setLeitura(l);
      setDesmarcados(new Set());
    } catch {
      avisar('Não consegui ler o arquivo. Use .xlsx ou .csv.', 'bad');
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const confirmar = async () => {
    setSalvando(0);
    try {
      const n = await importarClientes(
        aplicaveis.map((p) => p.input),
        (k) => setSalvando(k),
      );
      avisar(`${n} cliente${n > 1 ? 's' : ''} importado${n > 1 ? 's' : ''}.`);
      fechar();
    } finally {
      setSalvando(null);
    }
  };

  const botao = (
    <>
      <button type="button" className="btn-secondary" onClick={abrir}>
        <IcUpload /> Importar planilha
      </button>
      <input ref={input} type="file" className="hidden" accept=".xlsx,.csv" onChange={(e) => escolher(e.target.files?.[0])} />
    </>
  );

  const conta = (a: string) => propostas.filter((p) => p.acao === a).length;
  const comAviso = propostas.filter((p) => p.lido.avisos.length);
  const visiveis = soAvisos ? comAviso : propostas;

  const previa = leitura && (
    <section aria-label="Prévia da importação" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Importação</div>
          <h2 className="mt-1 text-xl font-bold">Prévia de {arquivo}</h2>
          <p className="text-[13px] text-ink-3">Nada foi gravado ainda. Clientes que já existem nunca perdem e-mails: os novos são acrescentados.</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button type="button" className="btn-secondary" onClick={fechar} disabled={salvando !== null}>
            Cancelar
          </button>
          <button type="button" className="btn-primary" onClick={confirmar} disabled={!aplicaveis.length || salvando !== null}>
            {salvando !== null ? `Importando ${salvando} de ${aplicaveis.length}…` : `Importar ${aplicaveis.length} cliente${aplicaveis.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
        <Cartao rotulo="Clientes novos" valor={conta('novo')} cor="text-ok" />
        <Cartao rotulo="Já existem, com e-mail novo" valor={conta('atualizar')} cor="text-info" />
        <Cartao rotulo="Já cadastrados, sem mudança" valor={conta('igual')} />
        <Cartao rotulo="Com algo para conferir" valor={comAviso.length} cor="text-warn" />
      </div>

      {!leitura.temColunaCopia && (
        <fieldset className="card flex flex-col gap-2 p-4">
          <legend className="sr-only">Como distribuir os e-mails</legend>
          <div className="label">A planilha não separa Para e Cópia. Como distribuir os e-mails de cada cliente?</div>
          <label className="flex items-center gap-2">
            <input type="radio" name="dist" checked={dist === 'todos_para'} onChange={() => setDist('todos_para')} className="h-[18px] w-[18px] accent-ink" />
            Todos em <b>Para</b> <span className="text-ink-3">(recomendado: todos recebem como destinatário principal)</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="dist" checked={dist === 'primeiro_para'} onChange={() => setDist('primeiro_para')} className="h-[18px] w-[18px] accent-ink" />
            O primeiro em <b>Para</b> e os demais em <b>Cópia</b>
          </label>
          <p className="text-xs text-ink-3">Dá para ajustar cliente por cliente depois, na tela de edição.</p>
        </fieldset>
      )}

      {leitura.avisosGerais.length > 0 && (
        <div className="rounded-xl border border-warn-line bg-warn-soft px-4 py-3 text-[13px] text-warn-strong">
          {leitura.avisosGerais.map((a) => (
            <div key={a}>{a}</div>
          ))}
        </div>
      )}

      {comAviso.length > 0 && (
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" checked={soAvisos} onChange={(e) => setSoAvisos(e.target.checked)} className="h-[18px] w-[18px] accent-ink" />
          Mostrar só os que têm algo para conferir ({comAviso.length})
        </label>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[48px_minmax(180px,1fr)_minmax(260px,2fr)_170px] gap-3 border-b border-line bg-[#F8F7F3] px-4 py-2.5 text-xs font-semibold text-ink-3">
              <span>
                <span className="sr-only">Incluir</span>
              </span>
              <span>Cliente</span>
              <span>E-mails</span>
              <span>O que acontece</span>
            </div>
            {visiveis.map((p) => {
              const marcavel = p.acao === 'novo' || p.acao === 'atualizar';
              const marcado = marcavel && !desmarcados.has(p.lido.linha);
              const a = ACAO[p.acao];
              return (
                <div key={p.lido.linha} className={`grid grid-cols-[48px_minmax(180px,1fr)_minmax(260px,2fr)_170px] items-start gap-3 border-b border-line-soft px-4 py-3 text-[13px] ${marcavel ? '' : 'opacity-70'}`}>
                  <div className="flex min-h-[28px] items-center justify-center">
                    <input
                      type="checkbox"
                      className="h-[18px] w-[18px] accent-ink"
                      disabled={!marcavel}
                      checked={marcado}
                      aria-label={`Importar ${p.lido.nome}`}
                      onChange={() =>
                        setDesmarcados((s) => {
                          const n = new Set(s);
                          if (n.has(p.lido.linha)) n.delete(p.lido.linha);
                          else n.add(p.lido.linha);
                          return n;
                        })
                      }
                    />
                  </div>
                  <div>
                    <div className="font-semibold">{p.lido.nome}</div>
                    <div className="text-xs text-ink-3">linha {p.lido.linha}</div>
                    {p.existente && p.existente.nome !== p.lido.nome && <div className="text-xs text-ink-3">cadastrado como {p.existente.nome}</div>}
                  </div>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex flex-wrap gap-1">
                      {p.input.para.map((e) => (
                        <span key={e} className={`rounded-md px-2 py-0.5 text-[12.5px] ${p.novosEmails.includes(e) || p.acao === 'novo' ? 'bg-brand-soft text-brand-text' : 'bg-line-soft text-ink-2'}`}>
                          {e}
                        </span>
                      ))}
                      {p.input.cc.map((e) => (
                        <span key={e} className="rounded-md border border-line px-2 py-0.5 text-[12.5px] text-ink-2">
                          cc: {e}
                        </span>
                      ))}
                    </div>
                    {p.lido.avisos.map((av) => (
                      <div key={av} className="flex items-start gap-1.5 text-xs text-warn-strong">
                        <IcAlerta tamanho={13} className="mt-px shrink-0" /> {av}
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-col items-start gap-1">
                    <Chip tom={a.tom}>{a.rotulo}</Chip>
                    {p.acao === 'atualizar' && p.novosEmails.length > 0 && <span className="text-xs text-ink-3">+{p.novosEmails.length} e-mail{p.novosEmails.length > 1 ? 's' : ''}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );

  return { botao, previa, aberta: !!leitura };
}
