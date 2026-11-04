import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useEstado } from '../state';
import type { CampoModelo, ModeloOS, TipoCampo, TipoOS } from '../types';
import { TIPOS_CAMPO, TIPOS_OS } from '../lib/ordens';
import { Chip, Gaveta } from '../components/ui';
import { IcMais } from '../components/Icones';

type Rascunho = Omit<ModeloOS, 'id' | 'atualizadoEm' | 'atualizadoPor'> & { id?: string };

const novoId = () => `f${Math.random().toString(36).slice(2, 10)}`;
const VAZIO: Rascunho = { nome: '', descricao: '', tipoBase: 'corretiva', campos: [], exigeHorimetro: true, exigeAssinatura: true, fotosMinimas: 0, ativo: true };
const quando = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

/** Operação → Modelos de OS: cada tipo de OS com o formulário que o técnico preenche. */
export function ModelosOS() {
  const { pode } = useEstado();
  const gerencia = pode('ordens', 2) && pode('manutencao', 2);
  const [lista, setLista] = useState<ModeloOS[] | null>(null);
  const [erro, setErro] = useState('');
  const [editando, setEditando] = useState<Rascunho | null>(null);
  const [verInativos, setVerInativos] = useState(false);

  const carregar = () =>
    api.listarModelosOS().then(
      (l) => setLista(l),
      (e) => setErro(e instanceof Error ? e.message : 'Não foi possível carregar.'),
    );
  useEffect(() => {
    void carregar();
  }, []);

  const inativos = (lista ?? []).filter((m) => !m.ativo).length;
  const visiveis = (lista ?? []).filter((m) => verInativos || m.ativo);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">
            <Link to="/ordens" className="hover:underline">
              Ordens de serviço
            </Link>
          </div>
          <h1 className="mt-1 text-[26px] font-bold">Modelos de OS</h1>
          <p className="max-w-[640px] text-[13px] text-ink-3">
            Cada modelo é um tipo de OS com o seu formulário. Ao abrir uma OS, o escritório escolhe o modelo e o técnico preenche essas perguntas no celular. Mudar um modelo vale para as próximas
            OS; as já abertas continuam com o formulário de quando foram criadas.
          </p>
        </div>
        {gerencia && (
          <button type="button" className="btn-primary" onClick={() => setEditando({ ...VAZIO, campos: [] })}>
            <IcMais tamanho={16} /> Novo modelo
          </button>
        )}
      </div>

      {erro && <p className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">{erro}</p>}
      {!lista && !erro && <p className="text-ink-3">Carregando…</p>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visiveis.map((m) => {
          const perguntas = m.campos.filter((c) => c.tipo !== 'secao');
          return (
            <article key={m.id} className={`flex flex-col gap-2 rounded-xl border border-line bg-white p-4 ${m.ativo ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-[17px] font-bold leading-tight">{m.nome}</h2>
                {!m.ativo && <Chip tom="neutro">desativado</Chip>}
              </div>
              <p className="text-[13px] text-ink-3">
                {TIPOS_OS[m.tipoBase].split(' (')[0]} · {perguntas.length} pergunta{perguntas.length === 1 ? '' : 's'}
                {perguntas.filter((c) => c.obrigatorio).length ? ` (${perguntas.filter((c) => c.obrigatorio).length} obrigatórias)` : ''}
              </p>
              {m.descricao && <p className="text-[13.5px] text-ink-2">{m.descricao}</p>}
              <p className="flex flex-wrap gap-1.5 text-xs">
                {m.exigeHorimetro && <Chip tom="info">horímetro</Chip>}
                {m.exigeAssinatura && <Chip tom="info">assinatura</Chip>}
                {m.fotosMinimas > 0 && <Chip tom="info">mín. {m.fotosMinimas} foto{m.fotosMinimas > 1 ? 's' : ''}</Chip>}
              </p>
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                <button type="button" className="btn-secondary btn-sm" onClick={() => setEditando(structuredClone(m))}>
                  {gerencia ? 'Editar' : 'Ver'}
                </button>
                {gerencia && (
                  <button
                    type="button"
                    className="btn btn-sm text-ink-2 underline"
                    onClick={() => {
                      const c = structuredClone(m) as Rascunho;
                      delete c.id;
                      setEditando({ ...c, nome: `${m.nome} (cópia)`, ativo: true });
                    }}
                  >
                    Duplicar
                  </button>
                )}
                <span className="ml-auto text-xs text-ink-3">
                  {m.atualizadoPor ? `${m.atualizadoPor}, ${quando(m.atualizadoEm)}` : 'modelo inicial'}
                </span>
              </div>
            </article>
          );
        })}
      </div>
      {inativos > 0 && (
        <button type="button" className="btn btn-sm self-start text-ink-3 underline" onClick={() => setVerInativos(!verInativos)}>
          {verInativos ? 'Esconder desativados' : `Mostrar ${inativos} desativado${inativos > 1 ? 's' : ''}`}
        </button>
      )}

      {editando && (
        <Editor
          inicial={editando}
          podeEditar={gerencia}
          fechar={() => setEditando(null)}
          salvo={(m) => {
            setLista((l) => (l?.some((x) => x.id === m.id) ? l.map((x) => (x.id === m.id ? m : x)) : [...(l ?? []), m]));
            setEditando(null);
          }}
        />
      )}
    </div>
  );
}

function Editor({ inicial, podeEditar, fechar, salvo }: { inicial: Rascunho; podeEditar: boolean; fechar: () => void; salvo: (m: ModeloOS) => void }) {
  const { avisar } = useEstado();
  const [m, setM] = useState<Rascunho>(inicial);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [aba, setAba] = useState<'montar' | 'previa'>('montar');
  const mudar = (d: Partial<Rascunho>) => setM((x) => ({ ...x, ...d }));
  const campo = (i: number, d: Partial<CampoModelo>) => mudar({ campos: m.campos.map((c, j) => (j === i ? { ...c, ...d } : c)) });
  const mover = (i: number, d: -1 | 1) => {
    const l = [...m.campos];
    [l[i], l[i + d]] = [l[i + d], l[i]];
    mudar({ campos: l });
  };
  const adicionar = (tipo: TipoCampo) =>
    mudar({
      campos: [
        ...m.campos,
        { id: novoId(), tipo, rotulo: '', obrigatorio: tipo !== 'secao' && tipo !== 'foto', ...(tipo === 'opcoes' || tipo === 'multipla' ? { opcoes: ['', ''] } : {}) },
      ],
    });

  const salvar = async (extra?: Partial<Rascunho>) => {
    setErro('');
    const final = { ...m, ...extra, campos: m.campos.map((c) => (c.opcoes ? { ...c, opcoes: c.opcoes.map((o) => o.trim()).filter(Boolean) } : c)) };
    setSalvando(true);
    try {
      const r = final.id ? await api.salvarModeloOS(final.id, final) : await api.criarModeloOS(final);
      avisar(extra?.ativo === false ? `Modelo "${r.nome}" desativado.` : `Modelo "${r.nome}" salvo.`);
      salvo(r);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  const perguntas = m.campos.filter((c) => c.tipo !== 'secao').length;

  return (
    <Gaveta aberto largo fechar={fechar} titulo={m.id ? m.nome || 'Modelo' : 'Novo modelo de OS'}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Nome do modelo
            <input className="input font-normal" disabled={!podeEditar} value={m.nome} onChange={(e) => mudar({ nome: e.target.value })} placeholder="Ex.: Preventiva 500 h" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Tipo de serviço
            <select className="input font-normal" disabled={!podeEditar} value={m.tipoBase} onChange={(e) => mudar({ tipoBase: e.target.value as TipoOS })}>
              {Object.entries(TIPOS_OS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <span className="font-normal text-ink-3">Diz o que a OS faz na ficha da máquina ao ser encerrada.</span>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold sm:col-span-2">
            Descrição (opcional)
            <input className="input font-normal" disabled={!podeEditar} value={m.descricao} onChange={(e) => mudar({ descricao: e.target.value })} placeholder="Quando usar este modelo" />
          </label>
        </div>

        <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[10px] bg-[#F8F7F3] p-3 text-[14px]">
          <legend className="sr-only">O que o técnico precisa entregar</legend>
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={!podeEditar} checked={m.exigeHorimetro} onChange={(e) => mudar({ exigeHorimetro: e.target.checked })} />
            Pede horímetro
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={!podeEditar} checked={m.exigeAssinatura} onChange={(e) => mudar({ exigeAssinatura: e.target.checked })} />
            Pede assinatura do cliente
          </label>
          <label className="flex items-center gap-2">
            Fotos no mínimo
            <input
              className="input h-8 w-[60px] text-right"
              inputMode="numeric"
              disabled={!podeEditar}
              value={String(m.fotosMinimas)}
              onChange={(e) => mudar({ fotosMinimas: Math.min(12, Number(e.target.value.replace(/\D/g, '')) || 0) })}
            />
          </label>
        </fieldset>

        <div className="flex items-center gap-1 border-b border-line">
          {(
            [
              ['montar', `Perguntas (${perguntas})`],
              ['previa', 'Como o técnico vê'],
            ] as const
          ).map(([k, r]) => (
            <button
              key={k}
              type="button"
              aria-pressed={aba === k}
              onClick={() => setAba(k)}
              className={`-mb-px border-b-2 px-3 py-2 text-[14px] font-semibold ${aba === k ? 'border-brand text-ink' : 'border-transparent text-ink-3'}`}
            >
              {r}
            </button>
          ))}
        </div>

        {aba === 'montar' ? (
          <>
            <ol className="flex flex-col gap-2">
              {m.campos.map((c, i) => (
                <li key={c.id} className={`flex flex-col gap-2 rounded-xl border p-3 ${c.tipo === 'secao' ? 'border-brand bg-brand-tint' : 'border-line bg-white'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-6 text-right text-xs font-bold text-ink-3">{i + 1}</span>
                    <select
                      aria-label={`Tipo da pergunta ${i + 1}`}
                      className="input h-9 w-auto text-[13px]"
                      disabled={!podeEditar}
                      value={c.tipo}
                      onChange={(e) => {
                        const tipo = e.target.value as TipoCampo;
                        const lista = tipo === 'opcoes' || tipo === 'multipla';
                        campo(i, { tipo, opcoes: lista ? (c.opcoes ?? ['', '']) : undefined, unidade: tipo === 'numero' ? c.unidade : undefined, obrigatorio: tipo === 'secao' ? false : c.obrigatorio });
                      }}
                    >
                      {Object.entries(TIPOS_CAMPO).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.rotulo}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`Pergunta ${i + 1}`}
                      className={`input h-9 min-w-[180px] flex-1 ${c.tipo === 'secao' ? 'font-bold' : ''}`}
                      disabled={!podeEditar}
                      value={c.rotulo}
                      placeholder={c.tipo === 'secao' ? 'Nome da seção' : 'Escreva a pergunta'}
                      onChange={(e) => campo(i, { rotulo: e.target.value })}
                    />
                    {c.tipo === 'numero' && (
                      <input
                        aria-label={`Unidade da pergunta ${i + 1}`}
                        className="input h-9 w-[72px]"
                        disabled={!podeEditar}
                        value={c.unidade ?? ''}
                        placeholder="unid."
                        onChange={(e) => campo(i, { unidade: e.target.value })}
                      />
                    )}
                    {c.tipo !== 'secao' && (
                      <label className="flex items-center gap-1.5 text-[13px]">
                        <input type="checkbox" disabled={!podeEditar} checked={c.obrigatorio} onChange={(e) => campo(i, { obrigatorio: e.target.checked })} />
                        obrigatória
                      </label>
                    )}
                    {podeEditar && (
                      <span className="ml-auto flex items-center">
                        <button type="button" className="btn btn-sm px-2 text-ink-3" disabled={i === 0} aria-label="Subir" onClick={() => mover(i, -1)}>
                          ↑
                        </button>
                        <button type="button" className="btn btn-sm px-2 text-ink-3" disabled={i === m.campos.length - 1} aria-label="Descer" onClick={() => mover(i, 1)}>
                          ↓
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm px-2 text-ink-3"
                          aria-label="Copiar pergunta"
                          title="Copiar"
                          onClick={() => mudar({ campos: [...m.campos.slice(0, i + 1), { ...c, id: novoId() }, ...m.campos.slice(i + 1)] })}
                        >
                          ⧉
                        </button>
                        <button type="button" className="btn btn-sm px-2 text-ink-3" aria-label="Tirar pergunta" onClick={() => mudar({ campos: m.campos.filter((_, j) => j !== i) })}>
                          ✕
                        </button>
                      </span>
                    )}
                  </div>
                  {(c.tipo === 'opcoes' || c.tipo === 'multipla') && (
                    <div className="flex flex-wrap items-center gap-1.5 pl-8">
                      {(c.opcoes ?? []).map((o, k) => (
                        <span key={k} className="flex items-center">
                          <input
                            aria-label={`Opção ${k + 1} da pergunta ${i + 1}`}
                            className="input h-8 w-[130px] text-[13px]"
                            disabled={!podeEditar}
                            value={o}
                            placeholder={`Opção ${k + 1}`}
                            onChange={(e) => campo(i, { opcoes: (c.opcoes ?? []).map((x, j) => (j === k ? e.target.value : x)) })}
                          />
                          {podeEditar && (c.opcoes ?? []).length > 2 && (
                            <button type="button" className="btn btn-sm px-1.5 text-ink-3" aria-label="Tirar opção" onClick={() => campo(i, { opcoes: (c.opcoes ?? []).filter((_, j) => j !== k) })}>
                              ✕
                            </button>
                          )}
                        </span>
                      ))}
                      {podeEditar && (
                        <button type="button" className="btn btn-sm text-ink-2 underline" onClick={() => campo(i, { opcoes: [...(c.opcoes ?? []), ''] })}>
                          + opção
                        </button>
                      )}
                    </div>
                  )}
                  {c.tipo !== 'secao' && (podeEditar || c.ajuda) && (
                    <input
                      aria-label={`Dica da pergunta ${i + 1}`}
                      className="input ml-8 h-8 w-auto text-[13px]"
                      disabled={!podeEditar}
                      value={c.ajuda ?? ''}
                      placeholder="Dica para o técnico (opcional)"
                      onChange={(e) => campo(i, { ajuda: e.target.value })}
                    />
                  )}
                </li>
              ))}
            </ol>
            {m.campos.length === 0 && <p className="rounded-xl border border-dashed border-line-strong p-4 text-center text-[14px] text-ink-3">Nenhuma pergunta ainda. Adicione abaixo.</p>}
            {podeEditar && (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-ink-3">Adicionar</span>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(TIPOS_CAMPO).map(([k, v]) => (
                    <button key={k} type="button" className="btn-secondary btn-sm" title={v.dica} onClick={() => adicionar(k as TipoCampo)}>
                      <IcMais tamanho={13} /> {v.rotulo}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <Previa m={m} />
        )}

        {erro && <p className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">{erro}</p>}
        {podeEditar && (
          <div className="sticky bottom-0 -mx-1 flex flex-wrap justify-between gap-2 border-t border-line bg-white px-1 pt-3">
            {m.id ? (
              <button type="button" className="btn-secondary" disabled={salvando} onClick={() => void salvar({ ativo: !m.ativo })}>
                {m.ativo ? 'Desativar modelo' : 'Reativar modelo'}
              </button>
            ) : (
              <span />
            )}
            <span className="flex gap-2">
              <button type="button" className="btn-secondary" onClick={fechar}>
                Cancelar
              </button>
              <button type="button" className="btn-primary" disabled={salvando} onClick={() => void salvar()}>
                {salvando ? 'Salvando…' : 'Salvar modelo'}
              </button>
            </span>
          </div>
        )}
      </div>
    </Gaveta>
  );
}

/** Prévia simples do formulário, do jeito que aparece no celular. */
function Previa({ m }: { m: Rascunho }) {
  return (
    <div className="mx-auto flex w-full max-w-[380px] flex-col gap-3 rounded-[28px] border-[6px] border-noite bg-canvas p-4">
      <p className="text-[13px] font-bold">{m.nome || 'Modelo sem nome'}</p>
      {m.exigeHorimetro && <Falsa rotulo="Horímetro" obrigatorio />}
      {m.campos.map((c) =>
        c.tipo === 'secao' ? (
          <h3 key={c.id} className="mt-1 border-b-2 border-brand pb-1 text-[12px] font-bold uppercase tracking-wide text-ink-2">
            {c.rotulo || 'Seção'}
          </h3>
        ) : (
          <Falsa key={c.id} rotulo={c.rotulo || '(sem pergunta)'} obrigatorio={c.obrigatorio} ajuda={c.ajuda}>
            {c.tipo === 'checklist' ? (
              <Botoes l={['OK', 'Problema', 'Não tem']} />
            ) : c.tipo === 'simnao' ? (
              <Botoes l={['Sim', 'Não']} />
            ) : c.tipo === 'opcoes' || c.tipo === 'multipla' ? (
              <Botoes l={(c.opcoes ?? []).filter(Boolean)} />
            ) : c.tipo === 'foto' ? (
              <span className="self-start rounded-lg border border-line-strong bg-white px-3 py-1.5 text-[12px] font-semibold">Tirar foto</span>
            ) : (
              <span className={`rounded-lg border border-line bg-white ${c.tipo === 'textoLongo' ? 'h-14' : 'h-8'}`}>
                {c.unidade && <span className="float-right px-2 py-1 text-[12px] text-ink-3">{c.unidade}</span>}
              </span>
            )}
          </Falsa>
        ),
      )}
      <Falsa rotulo="O que foi feito" obrigatorio />
      {m.exigeAssinatura && <Falsa rotulo="Assinatura do cliente" obrigatorio />}
    </div>
  );
}
function Falsa({ rotulo, obrigatorio, ajuda, children }: { rotulo: string; obrigatorio?: boolean; ajuda?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-white p-2.5">
      <span className="text-[13px] font-semibold">
        {rotulo}
        {obrigatorio && <span className="text-bad"> *</span>}
      </span>
      {ajuda && <span className="text-[11.5px] text-ink-3">{ajuda}</span>}
      {children ?? <span className="h-8 rounded-lg border border-line bg-white" />}
    </div>
  );
}
function Botoes({ l }: { l: string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {l.map((x) => (
        <span key={x} className="rounded-lg border border-line-strong bg-white px-2 py-1 text-[12px] font-semibold text-ink-2">
          {x}
        </span>
      ))}
    </span>
  );
}
