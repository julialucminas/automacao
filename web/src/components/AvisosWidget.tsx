import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api';
import { useEstado } from '../state';
import type { Pessoa, Solicitacao } from '../types';
import { hojeIso } from '../lib/calendario';

const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const CHAVE_VISTOS = 'avisos:fechados';
const lerFechados = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_VISTOS) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
};

/**
 * Avisos: um recado para alguém, que aparece no canto da tela de quem recebe e vira conversa.
 * Some quando alguém conclui (fica só em "Histórico de avisos").
 */
export function AvisosWidget() {
  const { usuario, solicitacoes, recarregarSolicitacoes, alterarSolicitacao, pode, avisar } = useEstado();
  const meuId = usuario?.id;
  const [aberto, setAberto] = useState(false);
  const [conversa, setConversa] = useState<Solicitacao | null>(null);
  const [novo, setNovo] = useState(false);
  // cartões que a pessoa fechou (×): voltam quando chega mensagem nova
  const [fechados, setFechados] = useState<Record<string, number>>(lerFechados);
  const escreve = pode('solicitacoes', 2);
  const local = useLocation();

  const meus = solicitacoes.filter((s) => s.status === 'aberta' && (s.paraUsuario === meuId || s.criadaPor === meuId));
  const novos = meus.filter((s) => s.naoLidas > 0);
  // cartões no canto: avisos com mensagem nova que a pessoa não fechou
  const cartoes = aberto ? [] : novos.filter((s) => (fechados[s.id] ?? -1) < s.totalMensagens).slice(0, 3);

  const fechar = (s: Solicitacao) => {
    const n = { ...fechados, [s.id]: s.totalMensagens };
    setFechados(n);
    try {
      localStorage.setItem(CHAVE_VISTOS, JSON.stringify(n));
    } catch {
      /* sem armazenamento: só não lembra */
    }
  };
  const abrir = async (id: string) => {
    setAberto(true);
    setNovo(false);
    try {
      setConversa(await api.abrirSolicitacao(id));
      void recarregarSolicitacoes();
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível abrir.', 'bad');
    }
  };
  // conversa aberta: atualiza quando chega mensagem (o estado confere a cada 15 s)
  const resumo = conversa ? solicitacoes.find((s) => s.id === conversa.id) : undefined;
  useEffect(() => {
    if (!conversa || !resumo) return;
    if (resumo.status !== conversa.status || resumo.totalMensagens !== (conversa.mensagens?.length ?? 0)) void api.abrirSolicitacao(conversa.id).then(setConversa, () => undefined);
  }, [resumo, conversa]);

  // no app do dono (tela de celular com barra embaixo) não aparece
  if (!usuario || !pode('solicitacoes') || local.pathname.startsWith('/app')) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2 print:hidden">
      {cartoes.map((s) => {
        const ultima = s.criadaPor === meuId ? 'Resposta nova' : `${s.criadaPorNome} mandou um aviso`;
        return (
          <div key={s.id} role="status" className="pointer-events-auto w-[320px] max-w-full rounded-2xl border-2 border-brand bg-white p-3.5 shadow-lg">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-ink-3">🔔 {ultima}</div>
                <div className="mt-0.5 line-clamp-3 text-[14px] font-semibold">{s.titulo}</div>
              </div>
              <button type="button" aria-label="Fechar o aviso" className="text-[18px] leading-none text-ink-3 hover:text-ink" onClick={() => fechar(s)}>
                ×
              </button>
            </div>
            <div className="mt-2.5 flex gap-2">
              <button type="button" className="btn-primary btn-sm flex-1" onClick={() => void abrir(s.id)}>
                Abrir conversa
              </button>
              {escreve && (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={async () => {
                    await alterarSolicitacao(s.id, { status: 'concluida' });
                    avisar('Aviso concluído.');
                  }}
                >
                  ✓ Concluir
                </button>
              )}
            </div>
          </div>
        );
      })}

      {aberto && (
        <section aria-label="Avisos" className="pointer-events-auto flex max-h-[min(560px,calc(100vh-6rem))] w-[360px] max-w-full flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-xl">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            {conversa || novo ? (
              <button
                type="button"
                className="text-[13px] font-semibold text-info"
                onClick={() => {
                  setConversa(null);
                  setNovo(false);
                }}
              >
                ‹ Avisos
              </button>
            ) : (
              <b className="text-[15px]">Avisos</b>
            )}
            <div className="flex items-center gap-2">
              {!conversa && !novo && escreve && (
                <button type="button" className="btn-primary btn-sm" onClick={() => setNovo(true)}>
                  + Novo aviso
                </button>
              )}
              <button type="button" aria-label="Fechar" className="px-1 text-[20px] leading-none text-ink-3 hover:text-ink" onClick={() => setAberto(false)}>
                ×
              </button>
            </div>
          </div>
          {novo ? (
            <NovoAviso
              enviado={(s) => {
                setNovo(false);
                setConversa(s);
                void recarregarSolicitacoes();
              }}
            />
          ) : conversa ? (
            <Conversa
              s={conversa}
              meuId={meuId}
              escreve={escreve}
              mudou={(s) => setConversa(s)}
              concluir={async () => {
                await alterarSolicitacao(conversa.id, { status: 'concluida' });
                avisar('Aviso concluído. Ele fica no Histórico de avisos.');
                setConversa(null);
              }}
            />
          ) : (
            <div className="flex-1 overflow-y-auto">
              {meus.length === 0 ? (
                <p className="px-4 py-6 text-center text-[13px] text-ink-3">Nenhum aviso em aberto.</p>
              ) : (
                <ul>
                  {meus.map((s) => (
                    <li key={s.id}>
                      <button type="button" onClick={() => void abrir(s.id)} className="flex w-full items-start gap-2.5 border-b border-line-soft px-4 py-3 text-left hover:bg-[#FAFAF7]">
                        <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${s.naoLidas ? 'bg-brand' : 'bg-transparent'}`} />
                        <span className="min-w-0 flex-1">
                          <span className={`line-clamp-2 text-[13.5px] ${s.naoLidas ? 'font-bold' : 'font-semibold'}`}>{s.titulo}</span>
                          <span className="block text-xs text-ink-3">
                            {s.criadaPor === meuId ? `para ${s.paraNome}` : `de ${s.criadaPorNome}`} · {hora(s.ultimaMensagemEm || s.criadaEm)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/solicitacoes" onClick={() => setAberto(false)} className="block px-4 py-2.5 text-center text-[12.5px] font-semibold text-info hover:underline">
                Histórico de avisos
              </Link>
            </div>
          )}
        </section>
      )}

      <button
        type="button"
        onClick={() => {
          setAberto(!aberto);
          setConversa(null);
          setNovo(false);
        }}
        className="pointer-events-auto inline-flex h-12 items-center gap-2 rounded-full bg-ink px-4 text-[14px] font-semibold text-white shadow-lg hover:bg-ink-2"
        aria-expanded={aberto}
      >
        <span aria-hidden>🔔</span> Avisos
        {(novos.length > 0 || meus.length > 0) && (
          <span className={`inline-flex min-w-[22px] justify-center rounded-full px-1.5 text-[12px] font-bold ${novos.length ? 'bg-brand text-ink' : 'bg-white/20 text-white'}`}>{novos.length || meus.length}</span>
        )}
      </button>
    </div>
  );
}

export function Conversa({ s, meuId, escreve, mudou, concluir }: { s: Solicitacao; meuId?: number; escreve: boolean; mudou: (s: Solicitacao) => void; concluir: () => Promise<void> }) {
  const { avisar } = useEstado();
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  useEffect(() => fim.current?.scrollIntoView({ block: 'end' }), [s.mensagens?.length]);
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!texto.trim()) return;
    setEnviando(true);
    try {
      mudou(await api.responderSolicitacao(s.id, texto.trim()));
      setTexto('');
    } catch (err) {
      avisar(err instanceof Error ? err.message : 'Não foi possível enviar.', 'bad');
    } finally {
      setEnviando(false);
    }
  };
  return (
    <>
      <div className="border-b border-line-soft px-4 py-2 text-xs text-ink-3">
        {s.criadaPor === meuId ? `Você para ${s.paraNome}` : `${s.criadaPorNome} para você`} · {hora(s.criadaEm)}
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto bg-[#F8F7F3] px-3 py-3">
        {(s.mensagens ?? []).map((m) =>
          /^[✔↺]/.test(m.texto) ? (
            <div key={m.id} className="text-center text-[11.5px] text-ink-3">
              {m.autor}: {m.texto.replace(/^[✔↺]\s*/, '').toLowerCase()} · {hora(m.criadaEm)}
            </div>
          ) : (
            <div key={m.id} className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13.5px] ${m.usuarioId === meuId ? 'self-end bg-ink text-white' : 'self-start border border-line bg-white'}`}>
              {m.usuarioId !== meuId && <div className="text-[11px] font-semibold text-ink-3">{m.autor}</div>}
              <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.texto}</div>
              <div className={`mt-0.5 text-right text-[10.5px] ${m.usuarioId === meuId ? 'text-white/60' : 'text-ink-3'}`}>{hora(m.criadaEm)}</div>
            </div>
          ),
        )}
        <div ref={fim} />
      </div>
      {s.status === 'aberta' && escreve ? (
        <div className="flex flex-col gap-2 border-t border-line p-3">
          <form onSubmit={enviar} className="flex gap-2">
            <input aria-label="Responder" className="input flex-1" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escreva…" />
            <button type="submit" className="btn-secondary btn-sm" disabled={enviando || !texto.trim()}>
              Enviar
            </button>
          </form>
          <button type="button" className="btn-primary btn-sm" onClick={() => void concluir()}>
            ✓ Concluir aviso
          </button>
        </div>
      ) : (
        <p className="border-t border-line px-4 py-2.5 text-[12.5px] text-ink-3">{s.status === 'concluida' ? `Concluído${s.concluidaPorNome ? ` por ${s.concluidaPorNome}` : ''}.` : ''}</p>
      )}
    </>
  );
}

function NovoAviso({ enviado }: { enviado: (s: Solicitacao) => void }) {
  const { usuario, avisar } = useEstado();
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [para, setPara] = useState<number | ''>('');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    api.listarUsuarios().then((l) => setPessoas([...l].filter((p) => p.id !== usuario?.id).sort((a, b) => a.nome.localeCompare(b.nome))), () => undefined);
  }, [usuario]);
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (para === '') return avisar('Escolha para quem é o aviso.', 'bad');
    const t = texto.trim();
    if (!t) return avisar('Escreva o aviso.', 'bad');
    setEnviando(true);
    try {
      // o "assunto" é o começo do próprio aviso
      const titulo = t.split('\n')[0].slice(0, 120);
      enviado(await api.criarSolicitacao({ paraUsuario: para, data: hojeIso(), clienteId: null, titulo, texto: t }));
      avisar('Aviso enviado. Aparece no canto da tela de quem recebe.');
    } catch (err) {
      avisar(err instanceof Error ? err.message : 'Não foi possível enviar.', 'bad');
    } finally {
      setEnviando(false);
    }
  };
  return (
    <form onSubmit={enviar} className="flex flex-col gap-3 p-4">
      <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink-2">
        Para
        <select className="input" value={para} onChange={(e) => setPara(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Escolha…</option>
          {pessoas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink-2">
        Aviso
        <textarea autoFocus rows={4} className="input resize-y py-2 text-[14px] font-normal" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ex.: a Essenza pediu a 2ª via do boleto de novembro" />
      </label>
      <button type="submit" className="btn-primary" disabled={enviando}>
        {enviando ? 'Enviando…' : 'Enviar aviso'}
      </button>
    </form>
  );
}
