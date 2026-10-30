import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useEstado } from '../state';
import type { Pessoa, Solicitacao } from '../types';
import { dataBr, hojeIso } from '../lib/calendario';
import { chaveEmpresa } from '../lib/normalizar';
import { Chip, Modal, type Tom } from '../components/ui';
import { IcEnviar, IcMais } from '../components/Icones';

type Caixa = 'para_mim' | 'enviadas' | 'todas';
type Situacao = 'abertas' | 'concluidas';

function situacao(s: Solicitacao, hoje: string): { rotulo: string; tom: Tom } {
  if (s.status === 'concluida') return { rotulo: 'Concluída', tom: 'ok' };
  if (s.data < hoje) return { rotulo: 'Atrasada', tom: 'bad' };
  if (s.data === hoje) return { rotulo: 'Para hoje', tom: 'warn' };
  return { rotulo: 'Agendada', tom: 'neutro' };
}

const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function Solicitacoes() {
  const { usuario, solicitacoes, recarregarSolicitacoes, clientes, avisar } = useEstado();
  const [params, setParams] = useSearchParams();
  const selecionada = params.get('id');
  const hoje = hojeIso();
  const [caixa, setCaixa] = useState<Caixa>('para_mim');
  const [sit, setSit] = useState<Situacao>('abertas');
  const [aberta, setAberta] = useState<Solicitacao | null>(null);
  const [resposta, setResposta] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [nova, setNova] = useState(false);
  const fimConversa = useRef<HTMLDivElement>(null);

  const meuId = usuario?.id;
  const lista = solicitacoes
    .filter((s) => (caixa === 'para_mim' ? s.paraUsuario === meuId : caixa === 'enviadas' ? s.criadaPor === meuId : true))
    .filter((s) => (sit === 'abertas' ? s.status === 'aberta' : s.status === 'concluida'))
    .sort((a, b) => (sit === 'abertas' ? a.data.localeCompare(b.data) : b.data.localeCompare(a.data)));

  const conta = (c: Caixa) =>
    solicitacoes.filter((s) => s.status === 'aberta' && (c === 'para_mim' ? s.paraUsuario === meuId : c === 'enviadas' ? s.criadaPor === meuId : true)).length;

  const abrir = useCallback(
    async (id: string) => {
      try {
        setAberta(await api.abrirSolicitacao(id));
        recarregarSolicitacoes(); // zera o "não lida"
      } catch (e) {
        avisar(e instanceof Error ? e.message : 'Não foi possível abrir.', 'bad');
      }
    },
    [avisar, recarregarSolicitacoes],
  );

  useEffect(() => {
    if (selecionada) abrir(selecionada);
    else setAberta(null);
  }, [selecionada, abrir]);

  // se chegar mensagem nova na solicitação aberta, recarrega a conversa
  const resumoAberta = solicitacoes.find((s) => s.id === aberta?.id);
  useEffect(() => {
    if (aberta && resumoAberta && resumoAberta.totalMensagens !== (aberta.mensagens?.length ?? 0)) abrir(aberta.id);
  }, [resumoAberta, aberta, abrir]);

  useEffect(() => {
    fimConversa.current?.scrollIntoView({ block: 'end' });
  }, [aberta?.mensagens?.length]);

  const selecionar = (id: string | null) => setParams(id ? { id } : {});

  const responder = async (e: FormEvent) => {
    e.preventDefault();
    if (!aberta || !resposta.trim()) return;
    setEnviando(true);
    try {
      setAberta(await api.responderSolicitacao(aberta.id, resposta.trim()));
      setResposta('');
      recarregarSolicitacoes();
    } catch (err) {
      avisar(err instanceof Error ? err.message : 'Não foi possível enviar.', 'bad');
    } finally {
      setEnviando(false);
    }
  };

  const mudar = async (m: { status?: 'aberta' | 'concluida'; data?: string }) => {
    if (!aberta) return;
    try {
      setAberta(await api.alterarSolicitacao(aberta.id, m));
      recarregarSolicitacoes();
      if (m.status === 'concluida') avisar('Solicitação concluída.');
    } catch (err) {
      avisar(err instanceof Error ? err.message : 'Não foi possível salvar.', 'bad');
    }
  };

  const botaoFiltro = (ativo: boolean, onClick: () => void, rotulo: string) => (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={`min-h-[38px] rounded-full border px-3 text-[13px] font-semibold ${ativo ? 'border-ink bg-ink text-white' : 'border-line-strong bg-white text-ink-2 hover:bg-canvas'}`}
    >
      {rotulo}
    </button>
  );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Equipe</div>
          <h1 className="mt-1 text-[26px] font-bold">Solicitações</h1>
          <p className="text-[13px] text-ink-3">Pedidos entre vocês (ex.: nova fatura), com data. No dia, aparece um aviso no topo para quem recebeu.</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setNova(true)}>
          <IcMais /> Nova solicitação
        </button>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <section aria-label="Lista de solicitações" className="card min-w-0 flex-[1_1_340px] overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-line p-3">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Caixa">
              {botaoFiltro(caixa === 'para_mim', () => setCaixa('para_mim'), `Para mim (${conta('para_mim')})`)}
              {botaoFiltro(caixa === 'enviadas', () => setCaixa('enviadas'), `Enviadas (${conta('enviadas')})`)}
              {botaoFiltro(caixa === 'todas', () => setCaixa('todas'), 'Todas')}
            </div>
            <div className="flex gap-1.5" role="group" aria-label="Situação">
              {botaoFiltro(sit === 'abertas', () => setSit('abertas'), 'Abertas')}
              {botaoFiltro(sit === 'concluidas', () => setSit('concluidas'), 'Concluídas')}
            </div>
          </div>
          {lista.length === 0 && <div className="px-4 py-6 text-[13px] text-ink-3">Nenhuma solicitação aqui.</div>}
          <ul>
            {lista.map((s) => {
              const st = situacao(s, hoje);
              const ativa = s.id === selecionada;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => selecionar(s.id)}
                    className={`flex w-full flex-col gap-1 border-b border-line-soft px-4 py-3 text-left text-[13px] ${ativa ? 'bg-brand-tint shadow-[inset_4px_0_0_#FFC400]' : 'hover:bg-[#FAFAF7]'}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate ${s.naoLidas ? 'font-bold' : 'font-semibold'}`}>{s.titulo}</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {s.naoLidas > 0 && (
                          <span className="inline-flex min-w-[20px] justify-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-ink" aria-label={`${s.naoLidas} não lidas`}>
                            {s.naoLidas}
                          </span>
                        )}
                        <Chip tom={st.tom}>{st.rotulo}</Chip>
                      </span>
                    </span>
                    <span className="text-xs text-ink-3">
                      {dataBr(s.data)}
                      {s.clienteNome && ` · ${s.clienteNome}`} · {s.criadaPor === meuId ? `para ${s.paraNome}` : `de ${s.criadaPorNome}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-label="Conversa" className="card flex min-h-[420px] min-w-0 flex-[2_1_480px] flex-col">
          {!aberta ? (
            <div className="m-auto p-6 text-center text-[13px] text-ink-3">Escolha uma solicitação na lista ou crie uma nova.</div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-4">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold">{aberta.titulo}</h2>
                  <div className="text-[13px] text-ink-3">
                    De {aberta.criadaPorNome} para {aberta.paraNome}
                    {aberta.clienteNome && (
                      <>
                        {' · '}cliente <b className="text-ink-2">{aberta.clienteNome}</b>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[13px] text-ink-3">
                    Data
                    <input type="date" value={aberta.data} onChange={(e) => e.target.value && mudar({ data: e.target.value })} className="input min-h-[36px] w-auto py-0 text-[13px]" />
                  </label>
                  <Chip tom={situacao(aberta, hoje).tom}>{situacao(aberta, hoje).rotulo}</Chip>
                  {aberta.status === 'aberta' ? (
                    <button type="button" className="btn-primary btn-sm" onClick={() => mudar({ status: 'concluida' })}>
                      Marcar como concluída
                    </button>
                  ) : (
                    <button type="button" className="btn-secondary btn-sm" onClick={() => mudar({ status: 'aberta' })}>
                      Reabrir
                    </button>
                  )}
                </div>
              </div>

              <div className="flex max-h-[460px] flex-1 flex-col gap-2.5 overflow-y-auto bg-[#FAFAF7] p-4" aria-live="polite">
                {(aberta.mensagens ?? []).length === 0 && <div className="text-[13px] text-ink-3">Sem mensagens ainda.</div>}
                {(aberta.mensagens ?? []).map((m) => {
                  const minha = m.usuarioId === meuId;
                  const sistema = /^(✔|↺|Mudou a data)/.test(m.texto);
                  if (sistema)
                    return (
                      <div key={m.id} className="self-center text-xs text-ink-3">
                        {m.autor} · {m.texto} · {hora(m.criadaEm)}
                      </div>
                    );
                  return (
                    <div key={m.id} className={`flex max-w-[85%] flex-col gap-0.5 ${minha ? 'self-end items-end' : 'self-start items-start'}`}>
                      <div className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13.5px] ${minha ? 'rounded-br-md bg-ink text-white' : 'rounded-bl-md border border-line bg-white'}`}>{m.texto}</div>
                      <div className="text-[11px] text-ink-3">
                        {minha ? 'Você' : m.autor} · {hora(m.criadaEm)}
                      </div>
                    </div>
                  );
                })}
                <div ref={fimConversa} />
              </div>

              <form onSubmit={responder} className="flex gap-2 border-t border-line p-3">
                <label htmlFor="resposta" className="sr-only">
                  Responder
                </label>
                <textarea
                  id="resposta"
                  rows={2}
                  value={resposta}
                  onChange={(e) => setResposta(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder="Escreva uma mensagem (Enter envia, Shift+Enter quebra linha)"
                  className="input min-w-0 flex-1 resize-none py-2 text-[13px]"
                />
                <button type="submit" className="btn-primary self-end" disabled={enviando || !resposta.trim()} aria-label="Enviar mensagem">
                  <IcEnviar />
                </button>
              </form>
            </>
          )}
        </section>
      </div>

      <NovaSolicitacaoModal
        aberto={nova}
        fechar={() => setNova(false)}
        clientes={clientes.filter((c) => c.ativo).map((c) => ({ id: c.id, nome: c.nome }))}
        criada={(s) => {
          setNova(false);
          setCaixa(s.paraUsuario === meuId ? 'para_mim' : 'enviadas');
          setSit('abertas');
          recarregarSolicitacoes();
          selecionar(s.id);
          avisar(`Solicitação enviada para ${s.paraNome}.`);
        }}
      />
    </div>
  );
}

function NovaSolicitacaoModal({
  aberto,
  fechar,
  clientes,
  criada,
}: {
  aberto: boolean;
  fechar: () => void;
  clientes: { id: string; nome: string }[];
  criada: (s: Solicitacao) => void;
}) {
  const { usuario } = useEstado();
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [para, setPara] = useState<number | ''>('');
  const [data, setData] = useState(hojeIso());
  const [titulo, setTitulo] = useState('Nova fatura');
  const [cliente, setCliente] = useState('');
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setErro('');
    api.listarUsuarios().then((l) => {
      setPessoas(l);
      // sugere a outra pessoa (quem não é você)
      const outra = l.find((p) => p.id !== usuario?.id) ?? l[0];
      setPara((v) => (v === '' && outra ? outra.id : v));
    });
  }, [aberto, usuario]);

  const clienteEscolhido = clientes.find((c) => chaveEmpresa(c.nome) === chaveEmpresa(cliente));

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (para === '') return setErro('Escolha para quem é a solicitação.');
    if (!titulo.trim()) return setErro('Escreva o assunto.');
    if (cliente.trim() && !clienteEscolhido) return setErro(`Cliente "${cliente}" não encontrado. Escolha da lista ou deixe em branco.`);
    setSalvando(true);
    try {
      const s = await api.criarSolicitacao({ paraUsuario: para, data, clienteId: clienteEscolhido?.id ?? null, titulo: titulo.trim(), texto: texto.trim() });
      setTitulo('Nova fatura');
      setCliente('');
      setTexto('');
      setData(hojeIso());
      criada(s);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível criar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal aberto={aberto} fechar={fechar} titulo="Nova solicitação">
      <form onSubmit={salvar} className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sol-para" className="label">
              Para
            </label>
            <select id="sol-para" value={para} onChange={(e) => setPara(e.target.value ? Number(e.target.value) : '')} className="input">
              {pessoas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.chamar || p.nome}
                  {p.id === usuario?.id ? ' (você)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sol-data" className="label">
              Para fazer em
            </label>
            <input id="sol-data" type="date" value={data} onChange={(e) => setData(e.target.value)} className="input" required />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sol-titulo" className="label">
            Assunto
          </label>
          <input id="sol-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} className="input" list="sol-assuntos" />
          <datalist id="sol-assuntos">
            <option value="Nova fatura" />
            <option value="Fatura avulsa" />
            <option value="Cancelar fatura" />
            <option value="Conferir valores" />
          </datalist>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sol-cliente" className="label">
            Cliente <span className="font-normal text-ink-3">(opcional)</span>
          </label>
          <input id="sol-cliente" value={cliente} onChange={(e) => setCliente(e.target.value)} className="input" list="sol-clientes" placeholder="Comece a digitar o nome" />
          <datalist id="sol-clientes">
            {clientes.map((c) => (
              <option key={c.id} value={c.nome} />
            ))}
          </datalist>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sol-texto" className="label">
            Mensagem
          </label>
          <textarea id="sol-texto" rows={4} value={texto} onChange={(e) => setTexto(e.target.value)} className="input resize-y py-2.5 text-[13px]" placeholder="Ex.: faturar a frota 45 extra, 10 dias, R$ 1.200,00" />
        </div>
        {erro && (
          <div role="alert" className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">
            {erro}
          </div>
        )}
        <div className="flex justify-end gap-2.5">
          <button type="button" className="btn-secondary" onClick={fechar}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={salvando}>
            {salvando ? 'Enviando…' : 'Enviar solicitação'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
