import { useMemo, useRef, useState } from 'react';
import { useEstado } from '../state';
import type { ResultadoCompletarCadastro } from '../api';
import { lerPlanilhaLocacao, proporCadastros, type LinhaLocacao, type PropostaCadastro } from '../lib/cadastroLocacao';
import { Cartao, Chip, type Tom } from './ui';
import { IcAlerta, IcUpload } from './Icones';

const ACAO: Record<PropostaCadastro['acao'], { rotulo: string; tom: Tom }> = {
  completar: { rotulo: 'Completar', tom: 'ok' },
  igual: { rotulo: 'Nada a acrescentar', tom: 'neutro' },
  sem_dados: { rotulo: 'Sem dados na planilha', tom: 'warn' },
  sem_cliente: { rotulo: 'Cliente não achado aqui', tom: 'bad' },
};

/**
 * "Completar cadastro (sistema de locação)": lê a planilha conferida e preenche razão social, endereço, IE, CNPJ…
 * Só preenche o que está vazio. E-mails (Para/Cópia) nunca são lidos nem alterados.
 */
export function useCadastroLocacao() {
  const { clientes, completarCadastros, avisar } = useEstado();
  const input = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState('');
  const [linhas, setLinhas] = useState<LinhaLocacao[] | null>(null);
  const [desmarcados, setDesmarcados] = useState<Set<number>>(new Set());
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoCompletarCadastro | null>(null);

  const propostas = useMemo(() => (linhas ? proporCadastros(linhas, clientes) : []), [linhas, clientes]);
  const aplicaveis = propostas.filter((p) => p.acao === 'completar' && p.item && !desmarcados.has(p.lido.linha));

  const fechar = () => {
    setLinhas(null);
    setDesmarcados(new Set());
    setResultado(null);
  };

  const escolher = async (f: File | undefined) => {
    if (!f) return;
    try {
      if (!/\.xlsx$/i.test(f.name)) throw new Error('Envie a planilha em .xlsx (a que foi conferida).');
      const { default: readXlsxFile } = await import('read-excel-file');
      const l = lerPlanilhaLocacao((await readXlsxFile(f)) as never);
      if (!l.length) throw new Error('A planilha está vazia.');
      setArquivo(f.name);
      setLinhas(l);
      setDesmarcados(new Set());
      setResultado(null);
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não consegui ler o arquivo.', 'bad');
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const confirmar = async () => {
    setSalvando(true);
    try {
      const r = await completarCadastros(aplicaveis.map((p) => p.item!));
      avisar(`Cadastro completado em ${r.atualizados} cliente${r.atualizados === 1 ? '' : 's'}. Nenhum e-mail foi alterado.`);
      setResultado(r);
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível salvar.', 'bad');
    } finally {
      setSalvando(false);
    }
  };

  const botao = (
    <>
      <button type="button" className="btn-secondary" onClick={() => input.current?.click()}>
        <IcUpload /> Completar cadastro (sistema de locação)
      </button>
      <input ref={input} type="file" className="hidden" accept=".xlsx" onChange={(e) => void escolher(e.target.files?.[0])} />
    </>
  );

  const conta = (a: PropostaCadastro['acao']) => propostas.filter((p) => p.acao === a).length;
  const paraConferir = propostas.filter((p) => p.lido.cadastro.conferir || p.cnpjDiferente || p.acao === 'sem_dados' || p.acao === 'sem_cliente');

  const previa = linhas && (
    <section aria-label="Prévia do cadastro" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Completar cadastro</div>
          <h2 className="mt-1 text-xl font-bold">{resultado ? 'Cadastro completado' : `Prévia de ${arquivo}`}</h2>
          <p className="text-[13px] text-ink-3">
            {resultado
              ? 'Os clientes abaixo continuam com os mesmos e-mails. O que precisa de conferência ficou marcado na pasta de cada um.'
              : 'Nada foi gravado ainda. Só entra o que hoje está vazio; nada já cadastrado é trocado, e os e-mails (Para/Cópia) não são tocados.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button type="button" className="btn-secondary" onClick={fechar} disabled={salvando}>
            {resultado ? 'Fechar' : 'Cancelar'}
          </button>
          {!resultado && (
            <button type="button" className="btn-primary" onClick={() => void confirmar()} disabled={!aplicaveis.length || salvando}>
              {salvando ? 'Gravando…' : `Completar ${aplicaveis.length} cliente${aplicaveis.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>

      {resultado && resultado.cnpjDiferente.length > 0 && (
        <div className="rounded-xl border border-warn-line bg-warn-soft px-4 py-3 text-[13px] text-warn-strong">
          <b>CNPJ diferente (mantive o que já estava):</b>
          {resultado.cnpjDiferente.map((d) => (
            <div key={d.id}>
              {d.nome}: cadastrado {d.atual} · planilha {d.planilha}
            </div>
          ))}
        </div>
      )}

      {!resultado && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
          <Cartao rotulo="Vão ser completados" valor={conta('completar')} cor="text-ok" />
          <Cartao rotulo="Nada a acrescentar" valor={conta('igual')} />
          <Cartao rotulo="Sem dados (escolher depois)" valor={conta('sem_dados')} cor="text-warn" />
          <Cartao rotulo="Não achados aqui" valor={conta('sem_cliente')} cor="text-bad" />
        </div>
      )}

      {paraConferir.length > 0 && (
        <details className="card p-4 text-[13px]">
          <summary className="cursor-pointer font-semibold">Para conferir depois ({paraConferir.length})</summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {paraConferir.map((p) => (
              <li key={p.lido.linha}>
                <b>{p.lido.nomeSistema}</b>
                <span className="text-ink-2">
                  {' — '}
                  {p.acao === 'sem_cliente'
                    ? 'não achei esse nome no cadastro daqui'
                    : p.acao === 'sem_dados'
                      ? 'sem dados na planilha: ' + (p.lido.cadastro.conferir || 'escolher qual empresa é')
                      : [p.cnpjDiferente ? `CNPJ cadastrado é diferente do da planilha (${p.lido.cnpj})` : '', p.lido.cadastro.conferir ?? ''].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[48px_minmax(170px,1fr)_minmax(280px,2.4fr)_150px] gap-3 border-b border-line bg-[#F8F7F3] px-4 py-2.5 text-xs font-semibold text-ink-3">
              <span>
                <span className="sr-only">Incluir</span>
              </span>
              <span>Cliente</span>
              <span>O que entra</span>
              <span>Situação</span>
            </div>
            {propostas.map((p) => {
              const marcavel = p.acao === 'completar' && !resultado;
              const a = ACAO[p.acao];
              return (
                <div key={p.lido.linha} className={`grid grid-cols-[48px_minmax(170px,1fr)_minmax(280px,2.4fr)_150px] items-start gap-3 border-b border-line-soft px-4 py-3 text-[13px] ${p.acao === 'completar' ? '' : 'opacity-70'}`}>
                  <div className="flex min-h-[28px] items-center justify-center">
                    <input
                      type="checkbox"
                      className="h-[18px] w-[18px] accent-ink"
                      disabled={!marcavel}
                      checked={p.acao === 'completar' && !desmarcados.has(p.lido.linha)}
                      aria-label={`Completar ${p.lido.nomeSistema}`}
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
                    <div className="font-semibold">{p.lido.nomeSistema}</div>
                    {p.lido.cadastro.razaoSocial && <div className="text-xs text-ink-3">{p.lido.cadastro.razaoSocial}</div>}
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    {p.novos.length > 0 && (
                      <div className="text-xs text-ink-2">
                        {p.novos
                          .filter((n) => n.rotulo !== 'Conferir')
                          .map((n) => (
                            <span key={n.rotulo} className="mr-3 inline-block">
                              <span className="text-ink-3">{n.rotulo}:</span> {n.valor}
                            </span>
                          ))}
                      </div>
                    )}
                    {p.cnpjDiferente && (
                      <div className="flex items-start gap-1.5 text-xs text-warn-strong">
                        <IcAlerta tamanho={13} className="mt-px shrink-0" /> CNPJ cadastrado ({p.cliente?.cnpj}) é diferente do da planilha ({p.lido.cnpj}); fica o cadastrado.
                      </div>
                    )}
                    {p.lido.cadastro.conferir && (
                      <div className="flex items-start gap-1.5 text-xs text-warn-strong">
                        <IcAlerta tamanho={13} className="mt-px shrink-0" /> {p.lido.cadastro.conferir}
                      </div>
                    )}
                  </div>
                  <div>
                    <Chip tom={a.tom}>{a.rotulo}</Chip>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );

  return { botao, previa, aberta: !!linhas };
}
