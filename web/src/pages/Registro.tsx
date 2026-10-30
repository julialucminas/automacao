import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ItemLog } from '../types';
import { dataHora } from '../lib/email';
import { chaveEmpresa } from '../lib/normalizar';
import { Chip, type Tom } from '../components/ui';
import { IcBusca } from '../components/Icones';
import { useEstado } from '../state';
import { diferencas } from './Aprovacoes';
import type { Cliente, ClienteInput } from '../types';

const AREAS: Record<string, { rotulo: string; tom: Tom }> = {
  cliente: { rotulo: 'Cadastro', tom: 'neutro' },
  movimentacao: { rotulo: 'Movimentação', tom: 'info' },
  proposta: { rotulo: 'Aprovação', tom: 'warn' },
  conferencia: { rotulo: 'Conferência', tom: 'ok' },
  configuracao: { rotulo: 'Configuração', tom: 'neutro' },
};

export function Registro() {
  const { movimentacoes, propostas, clientes } = useEstado();
  const [itens, setItens] = useState<ItemLog[] | null>(null);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [area, setArea] = useState('');

  // recarrega quando algo muda no cadastro ou nas aprovações
  useEffect(() => {
    api.listarRegistro().then(setItens, (e) => setErro(e instanceof Error ? e.message : 'Não foi possível carregar.'));
  }, [movimentacoes, propostas, clientes]);

  const q = chaveEmpresa(busca);
  const lista = (itens ?? []).filter((i) => (!area || i.area === area) && (!q || chaveEmpresa(`${i.acao} ${i.clienteNome} ${i.usuario}`).includes(q)));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Registro de alterações</h1>
          <p className="text-[13px] text-ink-3">Tudo o que foi mudado no sistema, por quem e quando. Não dá para apagar.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="relative">
            <span className="sr-only">Buscar</span>
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
              <IcBusca tamanho={15} />
            </span>
            <input className="input w-[220px] pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Cliente, pessoa ou ação" />
          </label>
          <select aria-label="Filtrar por tipo" className="input w-auto" value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">Tudo</option>
            {Object.entries(AREAS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.rotulo}
              </option>
            ))}
          </select>
        </div>
      </div>
      {erro && <p className="rounded-xl bg-bad-soft p-4 text-bad-strong">{erro}</p>}
      {itens === null && !erro && <p className="text-ink-3">Carregando…</p>}
      {itens && lista.length === 0 && <p className="rounded-xl border border-line bg-white p-6 text-center text-ink-3">Nenhum registro {itens.length ? 'com esse filtro' : 'ainda'}.</p>}
      {lista.length > 0 && (
        <ol className="overflow-hidden rounded-xl border border-line bg-white">
          {lista.map((i) => {
            const a = AREAS[i.area] ?? { rotulo: i.area, tom: 'neutro' as Tom };
            return (
              <li key={i.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 border-b border-line-soft px-4 py-3 last:border-b-0">
                <span className="w-[130px] shrink-0 text-xs tabular-nums text-ink-3">{dataHora(i.quando)}</span>
                <span className="w-[110px] shrink-0">
                  <Chip tom={a.tom}>{a.rotulo}</Chip>
                </span>
                <span className="min-w-0 flex-1 text-[13.5px]">
                  <b>{i.usuario || 'Sistema'}</b> {i.acao}
                  {i.clienteNome && !i.acao.includes(i.clienteNome) && <span className="text-ink-3"> · {i.clienteNome}</span>}
                  <Mudancas i={i} />
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** Para edições de cadastro: mostra só os campos que mudaram. */
function Mudancas({ i }: { i: ItemLog }) {
  if (i.area !== 'cliente' || !i.antes || !i.depois) return null;
  const difs = diferencas(i.antes as Cliente, i.depois as ClienteInput);
  if (!difs.length) return null;
  return (
    <ul className="mt-1 flex flex-col gap-0.5 text-xs text-ink-2">
      {difs.map((d) => (
        <li key={d.rotulo}>
          <span className="text-ink-3">{d.rotulo}:</span> <span className="line-through decoration-ink-3/50">{d.antes || '—'}</span> → <b>{d.depois || '—'}</b>
        </li>
      ))}
    </ul>
  );
}
