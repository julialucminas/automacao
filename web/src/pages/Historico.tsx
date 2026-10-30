import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useEstado } from '../state';
import type { Envio, StatusEnvio } from '../types';
import { dataHora, referenciaTitulo } from '../lib/email';
import { chaveEmpresa, semAcento } from '../lib/normalizar';
import { Chip, type Tom } from '../components/ui';
import { IcBusca } from '../components/Icones';

const STATUS: Record<StatusEnvio, { rotulo: string; tom: Tom }> = {
  enviado: { rotulo: 'Enviado', tom: 'ok' },
  lido: { rotulo: 'Lido pelo cliente', tom: 'info' },
  devolvido: { rotulo: 'Devolvido', tom: 'bad' },
  falhou: { rotulo: 'Falhou', tom: 'bad' },
};

type Filtro = 'todos' | StatusEnvio;

const COLUNAS = 'grid grid-cols-[136px_64px_minmax(200px,1.2fr)_minmax(200px,1.2fr)_minmax(220px,1.5fr)_164px] gap-3';

export function Historico() {
  const { envios, recarregarEnvios, avisar } = useEstado();
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);
  const [reenviando, setReenviando] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [ultima, setUltima] = useState<string | null>(null);

  // a caixa de entrada é lida sozinha a cada 5 minutos no servidor; aqui só atualiza a lista
  useEffect(() => {
    api.situacaoEnvio().then(
      (s) => setUltima(s.ultimaVerificacao ?? null),
      () => undefined,
    );
    const t = setInterval(() => void recarregarEnvios(), 60_000);
    return () => clearInterval(t);
  }, [recarregarEnvios]);

  const verificarAgora = async () => {
    setVerificando(true);
    try {
      const r = await api.verificarCaixa();
      setUltima(r.ultimaVerificacao);
      await recarregarEnvios();
      avisar(
        r.atualizados
          ? `${r.atualizados} envio${r.atualizados > 1 ? 's' : ''} atualizado${r.atualizados > 1 ? 's' : ''} (leitura ou devolução).`
          : 'Caixa de entrada conferida: nada novo.',
      );
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível conferir a caixa de entrada.', 'bad');
    } finally {
      setVerificando(false);
    }
  };

  const lista = useMemo(() => {
    const q = semAcento(busca).toUpperCase().trim();
    return envios.filter((e) => {
      if (filtro !== 'todos' && e.status !== filtro) return false;
      if (!q) return true;
      return e.numero.includes(q) || chaveEmpresa(e.clienteNome).includes(chaveEmpresa(busca)) || [...e.para, ...e.cc].some((x) => x.toUpperCase().includes(q));
    });
  }, [envios, filtro, busca]);

  const conta = (s: StatusEnvio) => envios.filter((e) => e.status === s).length;
  const filtros: { id: Filtro; rotulo: string }[] = [
    { id: 'todos', rotulo: `Todos (${envios.length})` },
    { id: 'enviado', rotulo: `Enviados (${conta('enviado')})` },
    { id: 'lido', rotulo: `Lidos (${conta('lido')})` },
    { id: 'devolvido', rotulo: `Devolvidos (${conta('devolvido')})` },
  ];
  if (conta('falhou')) filtros.push({ id: 'falhou', rotulo: `Falharam (${conta('falhou')})` });

  const reenviar = async (e: Envio) => {
    setReenviando(e.id);
    try {
      const novo = await api.reenviar(e.id);
      await recarregarEnvios();
      avisar(
        novo.status === 'falhou'
          ? `Não foi possível reenviar a fatura ${e.numero}: ${novo.detalhe}`
          : `Fatura ${e.numero} reenviada para ${[...novo.para, ...novo.cc].join(', ')}.`,
        novo.status === 'falhou' ? 'bad' : 'ok',
      );
    } catch (err) {
      avisar(err instanceof Error ? err.message : 'Não foi possível reenviar.', 'bad');
    } finally {
      setReenviando(null);
    }
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Rastreamento</div>
          <h1 className="mt-1 text-[26px] font-bold">Histórico de envios</h1>
          <p className="max-w-[640px] text-[13px] text-ink-3">
            Cada envio fica registrado aqui e com uma cópia na pasta Enviados do e-mail. Devoluções e confirmações de leitura que chegam na caixa de entrada atualizam a situação.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-col items-end">
            <button type="button" className="btn-secondary" disabled={verificando} onClick={verificarAgora}>
              {verificando ? 'Conferindo…' : 'Conferir caixa de entrada agora'}
            </button>
            <span className="mt-0.5 text-[11.5px] text-ink-3">
              {ultima ? `Última conferência: ${dataHora(ultima)} · automática a cada 5 min` : 'Conferência automática a cada 5 min'}
            </span>
          </div>
          <label className="flex min-h-[44px] items-center gap-2 rounded-[10px] border border-line-strong bg-white px-3 text-ink-3">
            <IcBusca />
            <span className="sr-only">Buscar envio</span>
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Nº da fatura, cliente ou e-mail"
              className="w-[240px] bg-transparent text-ink outline-none"
            />
          </label>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar envios">
        {filtros.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filtro === f.id}
            onClick={() => setFiltro(f.id)}
            className={`min-h-[40px] rounded-full border px-3.5 text-[13px] font-semibold ${
              filtro === f.id ? 'border-ink bg-ink text-white' : 'border-line-strong bg-white text-ink-2 hover:bg-canvas'
            }`}
          >
            {f.rotulo}
          </button>
        ))}
      </div>

      <section aria-label="Envios" className="card overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[920px]">
            <div className={`${COLUNAS} border-b border-line bg-[#F8F9FB] px-4 py-2.5 text-xs font-semibold text-ink-3`}>
              <span>Enviado em</span>
              <span>Fatura</span>
              <span>Cliente</span>
              <span>Destinatários</span>
              <span>Situação</span>
              <span className="sr-only">Ações</span>
            </div>
            {lista.map((e) => {
              const total = e.para.length + e.cc.length;
              const st = STATUS[e.status];
              const estaAberto = aberto === e.id;
              return (
                <Fragment key={e.id}>
                  <div className={`${COLUNAS} items-start border-b border-line-soft px-4 py-3 text-[13px]`}>
                    <span className="text-ink-2">{dataHora(e.enviadoEm)}</span>
                    <span className="font-mono font-medium">{e.numero}</span>
                    <div>
                      <div className="font-semibold">{e.clienteNome}</div>
                      <div className="text-xs text-ink-3">{referenciaTitulo(e.referencia)}</div>
                    </div>
                    <span className="min-w-0 [overflow-wrap:anywhere] text-ink-2">
                      {e.para[0]}
                      {total > 1 ? `  +${total - 1}` : ''}
                    </span>
                    <div className="flex flex-col items-start gap-1">
                      <Chip tom={st.tom}>{st.rotulo}</Chip>
                      {e.lidoEm && (
                        <span className="text-xs font-medium text-info">
                          Lido em {dataHora(e.lidoEm)}
                          {e.lidoPor ? ` por ${e.lidoPor}` : ''}
                        </span>
                      )}
                      {e.devolucao && <span className="text-xs font-medium text-bad">{e.devolucao}</span>}
                      {!e.lidoEm && !e.devolucao && <span className="text-xs text-ink-3">{e.detalhe}</span>}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(e.status === 'devolvido' || e.status === 'falhou') && (
                        <button type="button" className="btn-primary btn-sm" disabled={reenviando === e.id} onClick={() => reenviar(e)}>
                          {reenviando === e.id ? 'Reenviando…' : 'Reenviar'}
                        </button>
                      )}
                      <button type="button" className="btn-secondary btn-sm" aria-expanded={estaAberto} onClick={() => setAberto(estaAberto ? null : e.id)}>
                        {estaAberto ? 'Fechar' : 'Detalhes'}
                      </button>
                    </div>
                  </div>
                  {estaAberto && (
                    <dl className="mx-4 mb-3.5 mt-1 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-x-5 gap-y-2.5 rounded-[10px] border border-line bg-[#F8F9FB] px-3.5 py-3 text-[12.5px]">
                      <div>
                        <dt className="text-ink-3">Para</dt>
                        <dd className="[overflow-wrap:anywhere]">{e.para.join(', ')}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-3">Cópia</dt>
                        <dd className="[overflow-wrap:anywhere]">{e.cc.length ? e.cc.join(', ') : '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-3">Assunto</dt>
                        <dd>{e.assunto}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-3">Anexos</dt>
                        <dd className="font-mono text-[11.5px]">{e.anexos.join(' · ')}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-3">Identificador da mensagem</dt>
                        <dd className="[overflow-wrap:anywhere] font-mono text-[11.5px]">{e.messageId}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-3">Cópia no e-mail</dt>
                        <dd>{e.copiaEmEnviados ? `Pasta Enviados · ${dataHora(e.enviadoEm)}` : 'Não foi possível salvar a cópia'}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-3">Confirmação de leitura</dt>
                        <dd>
                          {e.lidoEm ? `Confirmada em ${dataHora(e.lidoEm)}${e.lidoPor ? ` por ${e.lidoPor}` : ''}` : e.pediuLeitura ? 'Pedida, ainda não confirmada' : 'Não pedida'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-ink-3">Entrega</dt>
                        <dd>
                          {e.devolvidoEm
                            ? `Devolvido em ${dataHora(e.devolvidoEm)}: ${e.devolucao}`
                            : e.status === 'falhou'
                              ? 'Não saiu'
                              : 'Aceito pelo servidor; nenhuma devolução recebida'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-ink-3">Observação</dt>
                        <dd>{e.observacao || '—'}</dd>
                      </div>
                    </dl>
                  )}
                </Fragment>
              );
            })}
            {lista.length === 0 && <div className="px-4 py-6 text-ink-3">Nenhum envio encontrado.</div>}
          </div>
        </div>
      </section>
    </div>
  );
}
