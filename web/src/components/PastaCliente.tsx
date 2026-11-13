import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useEstado } from '../state';
import type { Cliente, PastaCliente as Pasta, TipoDocContrato } from '../types';
import { dataBr } from '../lib/calendario';
import { dataHora, referenciaPorExtenso } from '../lib/email';
import { NOMES_TIPO } from '../lib/movimentacao';
import { lerBase64 } from './NfeAnexo';
import { Gaveta } from './ui';
import { IcBusca } from './Icones';

export const ROTULO_DOC: Record<TipoDocContrato, string> = {
  contrato: 'Contrato',
  assinado: 'Contrato assinado',
  aditivo: 'Aditivo de reajuste',
  renovacao: 'Renovação',
  outro: 'Outro',
};
const kb = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);

/** Pasta do cliente: tudo o que o sistema guarda dele, em subpastas. */
export function PastaCliente({ cliente, fechar }: { cliente: Cliente; fechar: () => void }) {
  const { pode, avisar } = useEstado();
  const [p, setP] = useState<Pasta | null>(null);
  const [busca, setBusca] = useState('');
  const [enviando, setEnviando] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const edita = pode('clientes', 2);
  const carregar = () => api.pastaCliente(cliente.id).then(setP, (e) => avisar(e instanceof Error ? e.message : 'Não foi possível abrir a pasta.', 'bad'));
  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recarrega só ao trocar de cliente
  }, [cliente.id]);

  const q = busca.trim().toLowerCase();
  const tem = (...t: (string | null | undefined)[]) => !q || t.some((x) => (x ?? '').toLowerCase().includes(q));

  const enviar = async (lista: File[]) => {
    setEnviando(true);
    for (const a of lista) {
      if (a.size > 15 * 1024 * 1024) {
        avisar(`${a.name}: grande demais (máximo 15 MB).`, 'bad');
        continue;
      }
      try {
        await api.enviarDocumentoCliente(cliente.id, await lerBase64(a), a.name, '');
      } catch (e) {
        avisar(e instanceof Error ? `${a.name}: ${e.message}` : 'Não foi possível enviar.', 'bad');
      }
    }
    setEnviando(false);
    void carregar();
  };

  // contratos agrupados pelo número (ou pelas máquinas)
  const porContrato = new Map<string, Pasta['contratos']>();
  for (const a of p?.contratos ?? []) {
    if (!tem(a.nome, a.numero, a.descricao, ROTULO_DOC[a.tipo], ...a.frotas.map((f) => `FT${f}`))) continue;
    const k = a.numero || `FT${a.frotas.join(', FT')}`;
    porContrato.set(k, [...(porContrato.get(k) ?? []), a]);
  }
  const faturas = (p?.faturas ?? []).filter((f) => tem(f.numero, referenciaPorExtenso(f.referencia), ...f.arquivos));
  const porMes = new Map<string, typeof faturas>();
  for (const f of faturas) porMes.set(f.referencia, [...(porMes.get(f.referencia) ?? []), f]);
  const nfe = (p?.nfe ?? []).filter((n) => tem(n.arquivo.nome, n.nf, `FT${n.frota}`));
  const entregas = (p?.entregas ?? []).filter((e) => tem(`FT${e.frota}`, e.video?.nome));
  const docs = (p?.documentos ?? []).filter((d) => tem(d.nome, d.descricao));

  return (
    <Gaveta aberto fechar={fechar} titulo={`Pasta · ${cliente.nome}`} largo>
      <label className="flex h-10 items-center gap-2 rounded-[10px] border border-line-strong bg-white px-3 text-ink-3">
        <IcBusca />
        <span className="sr-only">Buscar na pasta</span>
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar na pasta (nº, mês, frota, nome do arquivo)" className="w-full bg-transparent text-ink outline-none" />
      </label>
      {!p ? (
        <p className="text-ink-3">Abrindo a pasta…</p>
      ) : (
        <div className="flex flex-col gap-3">
          <Subpasta titulo="Contratos" n={[...porContrato.values()].reduce((s, l) => s + l.length, 0)} aberta>
            {[...porContrato.entries()].map(([k, l]) => (
              <div key={k} className="flex flex-col gap-1">
                <div className="text-[12.5px] font-semibold text-ink-2">{/^FT/.test(k) ? k : `Contrato ${k}`}</div>
                <ul className="flex flex-col gap-1">
                  {l.map((a) => (
                    <Arquivo
                      key={a.id}
                      href={`/api/contratos/arquivos/${a.id}`}
                      nome={a.nome}
                      etiqueta={ROTULO_DOC[a.tipo]}
                      detalhe={`${dataHora(a.enviadoEm)}${a.por ? ` · ${a.por}` : ''}${a.descricao ? ` · ${a.descricao}` : ''} · FT${a.frotas.join(', FT')}`}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </Subpasta>

          {p.faturas !== null && (
            <Subpasta titulo="Faturas e boletos" n={faturas.length}>
              {[...porMes.entries()].map(([mes, l]) => (
                <div key={mes} className="flex flex-col gap-1">
                  <div className="text-[12.5px] font-semibold text-ink-2">{referenciaPorExtenso(mes)}</div>
                  <ul className="flex flex-col gap-1">
                    {l.map((f) =>
                      f.arquivos.length ? (
                        f.arquivos.map((n) => (
                          <Arquivo
                            key={f.id + n}
                            href={`/api/envios/${f.id}/arquivos/${encodeURIComponent(n)}`}
                            nome={n}
                            etiqueta={/boleto/i.test(n) ? 'Boleto' : 'Fatura'}
                            detalhe={`nº ${f.numero} · enviada em ${dataHora(f.enviadoEm)}${f.status === 'devolvido' ? ' · e-mail voltou' : ''}`}
                          />
                        ))
                      ) : (
                        <li key={f.id} className="rounded-lg bg-[#F8F7F3] px-3 py-2 text-[13px] text-ink-3">
                          Fatura nº {f.numero} · {f.manual ? 'lançada à mão (enviada por fora, sem arquivo no sistema)' : 'sem arquivo guardado'}
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              ))}
            </Subpasta>
          )}

          <Subpasta titulo="NF-e" n={nfe.length}>
            <ul className="flex flex-col gap-1">
              {nfe.map((n) => (
                <Arquivo key={n.movId} href={`/api/movimentacoes/${n.movId}/nfe`} nome={n.arquivo.nome} etiqueta={NOMES_TIPO[n.tipo]} detalhe={`FT${n.frota} · ${dataBr(n.data)}${n.nf ? ` · NF ${n.nf}` : ''}`} />
              ))}
            </ul>
          </Subpasta>

          <Subpasta titulo="Entregas" n={entregas.length}>
            <ul className="flex flex-col gap-1">
              {entregas.map((e) => {
                const problemas = e.checklist?.itens.filter((i) => i.estado === 'problema').length ?? 0;
                return (
                  <li key={e.movId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#F8F7F3] px-3 py-2 text-[13px]">
                    <span>
                      <b>FT{e.frota}</b> <span className="text-ink-3">· {e.data ? dataBr(e.data) : ''}</span>{' '}
                      <span className={e.checklist ? (problemas ? 'text-warn-strong' : 'text-ok') : 'text-bad'}>
                        {e.checklist ? (problemas ? `⚠ checklist com ${problemas} problema(s)` : '✓ checklist ok') : '○ sem checklist'}
                      </span>
                    </span>
                    {e.video ? (
                      <a className="font-semibold text-info underline" href={`/api/entregas/${e.movId}/video`} target="_blank" rel="noopener">
                        ▶ vídeo da entrega
                      </a>
                    ) : (
                      <span className="text-bad">○ sem vídeo</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Subpasta>

          <Subpasta
            titulo="Outros documentos"
            n={docs.length}
            aberta
            acao={
              edita && (
                <>
                  <input
                    ref={ref}
                    type="file"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                    className="hidden"
                    aria-label="Pôr documentos na pasta"
                    onChange={(e) => {
                      const l = [...(e.target.files ?? [])];
                      e.target.value = '';
                      if (l.length) void enviar(l);
                    }}
                  />
                  <button type="button" className="btn-secondary btn-sm" disabled={enviando} onClick={() => ref.current?.click()}>
                    {enviando ? 'Enviando…' : '+ Pôr documento'}
                  </button>
                </>
              )
            }
          >
            <ul className="flex flex-col gap-1">
              {docs.map((d) => (
                <Arquivo
                  key={d.id}
                  href={`/api/clientes/documentos/${d.id}`}
                  nome={d.nome}
                  etiqueta={d.ext.toUpperCase()}
                  detalhe={`${dataHora(d.enviadoEm)}${d.por ? ` · ${d.por}` : ''} · ${kb(d.tamanho)}${d.descricao ? ` · ${d.descricao}` : ''}`}
                  apagar={
                    edita
                      ? async () => {
                          await api.apagarDocumentoCliente(d.id);
                          avisar('Documento tirado da pasta.');
                          void carregar();
                        }
                      : undefined
                  }
                />
              ))}
            </ul>
            {!docs.length && <p className="text-[13px] text-ink-3">Cartão CNPJ, proposta, documentos do cliente… PDF, foto, Word ou Excel.</p>}
          </Subpasta>
        </div>
      )}
    </Gaveta>
  );
}

function Subpasta({ titulo, n, aberta, acao, children }: { titulo: string; n: number; aberta?: boolean; acao?: ReactNode; children: ReactNode }) {
  const [abre, setAbre] = useState(!!aberta);
  return (
    <section aria-label={titulo} className="rounded-xl border border-line bg-white">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5">
        <button type="button" className="flex flex-1 items-center gap-2 text-left" aria-expanded={abre} onClick={() => setAbre(!abre)}>
          <span aria-hidden className={`text-ink-3 transition-transform ${abre ? 'rotate-90' : ''}`}>›</span>
          <span aria-hidden>📁</span>
          <b className="text-[14.5px]">{titulo}</b>
          <span className="text-[13px] text-ink-3">{n}</span>
        </button>
        {acao}
      </div>
      {abre && <div className="flex flex-col gap-2.5 border-t border-line-soft px-4 py-3">{n === 0 && !acao ? <p className="text-[13px] text-ink-3">Nada aqui ainda.</p> : children}</div>}
    </section>
  );
}

function Arquivo({ href, nome, etiqueta, detalhe, apagar }: { href: string; nome: string; etiqueta: string; detalhe: string; apagar?: () => Promise<void> }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#F8F7F3] px-3 py-2 text-[13px]">
      <span className="min-w-0">
        <span className="mr-2 rounded bg-white px-1.5 py-0.5 text-[11.5px] font-semibold text-ink-2">{etiqueta}</span>
        <a href={href} target="_blank" rel="noopener" className="font-semibold text-info underline underline-offset-2 [overflow-wrap:anywhere]">
          {nome}
        </a>
        <span className="block text-xs text-ink-3">{detalhe}</span>
      </span>
      {apagar && (
        <button type="button" className="text-xs text-ink-3 underline" onClick={() => void apagar()}>
          tirar
        </button>
      )}
    </li>
  );
}
