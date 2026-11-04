import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useEstado } from '../state';
import { api } from '../api';
import { dataCurta, hojeIso, paraData, paraIso, proximasDatas, regraDoCliente } from '../lib/calendario';
import { referenciaAtual, referenciaPorExtenso } from '../lib/email';
import { formatarReais } from '../lib/dinheiro';

const somarDias = (iso: string, n: number) => paraIso(new Date(paraData(iso).getTime() + n * 86_400_000));

function Cartao({ titulo, link, rotuloLink, children, destaque }: { titulo: string; link?: string; rotuloLink?: string; children: ReactNode; destaque?: boolean }) {
  return (
    <section className={`flex flex-col gap-3 rounded-xl border bg-white p-5 ${destaque ? 'border-brand shadow-[inset_0_3px_0_#FFC400]' : 'border-line'}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold">{titulo}</h2>
        {link && (
          <Link to={link} className="text-[13px] font-semibold text-info hover:underline">
            {rotuloLink ?? 'Abrir'} →
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function Numero({ n, rotulo, tom = 'ink' }: { n: number | string; rotulo: string; tom?: 'ink' | 'warn' | 'bad' | 'ok' }) {
  const cor = { ink: 'text-ink', warn: 'text-warn', bad: 'text-bad', ok: 'text-ok' }[tom];
  return (
    <div>
      <div className={`text-[26px] font-bold leading-none ${cor}`}>{n}</div>
      <div className="mt-1 text-xs text-ink-3">{rotulo}</div>
    </div>
  );
}

/** Primeira tela de todo mundo: cada um vê só o que é dele. */
export function Inicio() {
  const { usuario, clientes, envios, oficina, movimentacoes, propostas, pendentesParaMim, aprova, pode, veValores } = useEstado();
  const hoje = hojeIso();
  const ref = referenciaAtual();
  const nome = usuario?.chamar?.trim() || usuario?.nome.trim().split(/\s+/)[0] || '';
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const ativos = clientes.filter((c) => c.ativo);

  // faturas de hoje e dos próximos 7 dias, pela regra de cada cliente
  const faturas = useMemo(() => {
    if (!pode('envio')) return [];
    const ate = somarDias(hoje, 7);
    return ativos
      .flatMap((c) => {
        const r = regraDoCliente(c);
        const d = r ? proximasDatas(r, 1, hoje)[0] : undefined;
        return d && d <= ate ? [{ cliente: c, data: d }] : [];
      })
      .sort((a, b) => a.data.localeCompare(b.data) || a.cliente.nome.localeCompare(b.cliente.nome));
  }, [ativos, hoje, pode]);
  const faturasHoje = faturas.filter((f) => f.data === hoje);
  const enviadasNoMes = envios.filter((e) => e.referencia === ref && e.status !== 'falhou').length;
  const devolvidos = envios.filter((e) => e.status === 'devolvido').length;

  // locações
  const frotas = ativos.flatMap((c) => c.frotas.map((f) => ({ c, f })));
  const terminando = frotas.filter(({ f }) => f.fim && f.fim >= hoje && f.fim <= somarDias(hoje, 30)).sort((a, b) => a.f.fim!.localeCompare(b.f.fim!));
  const valorMensal = frotas.reduce((s, { f }) => s + f.valor, 0);

  // aprovações
  const pendentes = movimentacoes.filter((m) => m.status === 'pendente').length + propostas.filter((p) => p.status === 'pendente').length;

  // conferência do mês
  const [conferidas, setConferidas] = useState<number | null>(null);
  const confere = pode('conferencia', 2);
  useEffect(() => {
    if (!confere) return;
    api.listarConferencia(ref).then(
      (l) => setConferidas(l.length),
      () => setConferidas(null),
    );
  }, [confere, ref]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[26px] font-bold">
          {saudacao}
          {nome ? `, ${nome}` : ''}!
        </h1>
        <p className="text-[13px] text-ink-3">
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })} · {usuario?.perfilNome}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {pode('solicitacoes') && (
          <Cartao titulo="Solicitações para você" link="/solicitacoes" destaque={pendentesParaMim.length > 0}>
            {pendentesParaMim.length === 0 ? (
              <p className="text-[13px] text-ink-3">Nada pendente para hoje.</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-[14px]">
                {pendentesParaMim.slice(0, 5).map((s) => (
                  <li key={s.id}>
                    <Link to={`/solicitacoes?id=${s.id}`} className="flex items-baseline justify-between gap-2 hover:underline">
                      <span className="truncate font-semibold">
                        {s.titulo}
                        {s.clienteNome && <span className="font-normal text-ink-3"> · {s.clienteNome}</span>}
                      </span>
                      <span className={`shrink-0 text-xs ${s.data < hoje ? 'font-bold text-bad' : 'text-ink-3'}`}>
                        {s.data < hoje ? `atrasada (${dataCurta(s.data)})` : 'hoje'}
                      </span>
                    </Link>
                  </li>
                ))}
                {pendentesParaMim.length > 5 && <li className="text-xs text-ink-3">e mais {pendentesParaMim.length - 5}</li>}
              </ul>
            )}
          </Cartao>
        )}

        {aprova ? (
          <Cartao titulo="Aprovações" link="/aprovacoes" destaque={pendentes > 0}>
            <Numero n={pendentes} rotulo={pendentes === 1 ? 'alteração esperando você aprovar' : 'alterações esperando você aprovar'} tom={pendentes ? 'warn' : 'ok'} />
          </Cartao>
        ) : (
          pendentes > 0 && (
            <Cartao titulo="Minhas alterações" link="/aprovacoes">
              <Numero n={pendentes} rotulo="aguardando aprovação do financeiro" />
            </Cartao>
          )
        )}

        {pode('envio') && (
          <Cartao titulo="Faturas" link="/calendario" rotuloLink="Calendário" destaque={faturasHoje.length > 0}>
            <div className="flex gap-6">
              <Numero n={faturasHoje.length} rotulo="para emitir hoje" tom={faturasHoje.length ? 'warn' : 'ink'} />
              <Numero n={enviadasNoMes} rotulo={`enviadas em ${referenciaPorExtenso(ref).split(' ')[0]}`} />
              {devolvidos > 0 && pode('historico') && <Numero n={devolvidos} rotulo="e-mails devolvidos" tom="bad" />}
            </div>
            {faturas.length > 0 && (
              <ul className="flex flex-col gap-1 border-t border-line-soft pt-2 text-[13px]">
                {faturas.slice(0, 6).map((f) => (
                  <li key={f.cliente.id} className="flex justify-between gap-2">
                    <span className="truncate">{f.cliente.nome}</span>
                    <span className={`shrink-0 ${f.data === hoje ? 'font-bold' : 'text-ink-3'}`}>{f.data === hoje ? 'hoje' : dataCurta(f.data)}</span>
                  </li>
                ))}
                {faturas.length > 6 && <li className="text-xs text-ink-3">e mais {faturas.length - 6} nos próximos 7 dias</li>}
              </ul>
            )}
          </Cartao>
        )}

        {pode('frotas') && (
          <Cartao titulo="Locações" link="/frotas" rotuloLink="Frotas">
            <div className="flex flex-wrap gap-6">
              <Numero n={frotas.length} rotulo="frotas locadas" />
              <Numero n={oficina.length} rotulo="na oficina" tom={oficina.length ? 'warn' : 'ink'} />
              <Numero n={terminando.length} rotulo="terminam em 30 dias" />
              {veValores && <Numero n={formatarReais(valorMensal)} rotulo="de locação por mês" />}
            </div>
            {terminando.length > 0 && (
              <ul className="flex flex-col gap-1 border-t border-line-soft pt-2 text-[13px]">
                {terminando.slice(0, 5).map(({ c, f }) => (
                  <li key={`${c.id}-${f.numero}`} className="flex justify-between gap-2">
                    <span className="truncate">
                      <b className="font-mono">FT{f.numero}</b> · {c.nome}
                    </span>
                    <span className="shrink-0 text-ink-3">termina {dataCurta(f.fim!)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>
        )}

        {confere && (
          <Cartao titulo="Conferência do mês" link="/conferencia">
            <Numero
              n={conferidas === null ? '—' : `${Math.min(conferidas, frotas.length)} de ${frotas.length}`}
              rotulo={`frotas conferidas em ${referenciaPorExtenso(ref)}`}
              tom={conferidas !== null && conferidas >= frotas.length ? 'ok' : 'ink'}
            />
          </Cartao>
        )}
      </div>
    </div>
  );
}
