import { useState } from 'react';
import { api } from '../api';
import { useEstado } from '../state';
import type { Solicitacao } from '../types';
import { Gaveta } from '../components/ui';
import { IcBusca } from '../components/Icones';
import { Conversa } from '../components/AvisosWidget';
import { chaveEmpresa } from '../lib/normalizar';

const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Histórico de avisos: os avisos (já concluídos ou não) para consultar. O dia a dia fica no canto da tela. */
export function Solicitacoes() {
  const { usuario, solicitacoes, alterarSolicitacao, pode, avisar } = useEstado();
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState<'concluidas' | 'abertas' | 'todas'>('concluidas');
  const [aberta, setAberta] = useState<Solicitacao | null>(null);
  const q = chaveEmpresa(busca);
  const lista = solicitacoes
    .filter((s) => sit === 'todas' || (sit === 'abertas' ? s.status === 'aberta' : s.status === 'concluida'))
    .filter((s) => !q || [s.titulo, s.criadaPorNome, s.paraNome, s.clienteNome].some((t) => chaveEmpresa(t ?? '').includes(q)))
    .sort((a, b) => (b.concluidaEm ?? b.ultimaMensagemEm ?? b.criadaEm).localeCompare(a.concluidaEm ?? a.ultimaMensagemEm ?? a.criadaEm));

  const abrir = async (id: string) => {
    try {
      setAberta(await api.abrirSolicitacao(id));
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível abrir.', 'bad');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[22px] font-bold">Histórico de avisos</h1>
        <p className="text-[13.5px] text-ink-3">Para mandar um aviso ou responder, use o botão 🔔 Avisos no canto da tela. Aqui ficam os avisos para consultar.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['concluidas', 'Concluídos'],
            ['abertas', 'Em aberto'],
            ['todas', 'Todos'],
          ] as const
        ).map(([k, r]) => (
          <button key={k} type="button" aria-pressed={sit === k} onClick={() => setSit(k)} className={`min-h-[36px] rounded-full border px-3.5 text-[13px] font-semibold ${sit === k ? 'border-ink bg-ink text-white' : 'border-line-strong bg-white text-ink-2'}`}>
            {r}
          </button>
        ))}
        <label className="ml-auto flex h-9 w-full items-center gap-2 rounded-[10px] border border-line-strong bg-white px-3 text-ink-3 sm:w-72">
          <IcBusca />
          <span className="sr-only">Buscar aviso</span>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por texto ou pessoa" className="w-full bg-transparent text-[13px] text-ink outline-none" />
        </label>
      </div>
      <section aria-label="Avisos" className="rounded-xl border border-line bg-white">
        {lista.length === 0 ? (
          <p className="px-5 py-6 text-ink-3">Nenhum aviso aqui.</p>
        ) : (
          <ul>
            {lista.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => void abrir(s.id)} className="flex w-full flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-line-soft px-5 py-3 text-left text-[13.5px] last:border-0 hover:bg-[#FAFAF7]">
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{s.titulo}</span>
                    <span className="block text-xs text-ink-3">
                      {s.criadaPorNome} → {s.paraNome} · {hora(s.criadaEm)}
                    </span>
                  </span>
                  <span className={`text-xs ${s.status === 'concluida' ? 'text-ok' : 'font-semibold text-warn-strong'}`}>
                    {s.status === 'concluida' ? `✓ concluído${s.concluidaPorNome ? ` por ${s.concluidaPorNome}` : ''}${s.concluidaEm ? ` em ${hora(s.concluidaEm)}` : ''}` : 'em aberto'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Gaveta aberto={!!aberta} fechar={() => setAberta(null)} titulo="Aviso">
        {aberta && (
          <div className="flex min-h-[60vh] flex-col overflow-hidden rounded-xl border border-line">
            <Conversa
              s={aberta}
              meuId={usuario?.id}
              escreve={pode('solicitacoes', 2) && (aberta.paraUsuario === usuario?.id || aberta.criadaPor === usuario?.id)}
              mudou={setAberta}
              concluir={async () => {
                setAberta(await alterarSolicitacao(aberta.id, { status: 'concluida' }));
                avisar('Aviso concluído.');
              }}
            />
            {aberta.status === 'concluida' && pode('solicitacoes', 2) && (
              <button
                type="button"
                className="btn-secondary btn-sm m-3"
                onClick={async () => {
                  setAberta(await alterarSolicitacao(aberta.id, { status: 'aberta' }));
                  avisar('Aviso reaberto: voltou para o canto da tela.');
                }}
              >
                Reabrir
              </button>
            )}
          </div>
        )}
      </Gaveta>
    </div>
  );
}
