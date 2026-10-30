import { useState } from 'react';
import { useEstado } from '../state';
import { api } from '../api';
import type { Cliente, ClienteInput, Proposta } from '../types';
import { dataHora } from '../lib/email';
import { formatarReais } from '../lib/dinheiro';
import { descreverRegra, regraDoCliente } from '../lib/calendario';
import { Chip } from '../components/ui';
import { CartaoMov, STATUS_MOV } from './Movimentacoes';

type Campo = { rotulo: string; ler: (c: Partial<Cliente> | ClienteInput) => string };

const lista = (v?: string[]) => (v ?? []).join(', ');
const CAMPOS: Campo[] = [
  { rotulo: 'Nome', ler: (c) => c.nome ?? '' },
  { rotulo: 'Outros nomes', ler: (c) => lista(c.apelidos) },
  { rotulo: 'CNPJ', ler: (c) => c.cnpj ?? '' },
  { rotulo: 'Para', ler: (c) => lista(c.para) },
  { rotulo: 'Cópia (Cc)', ler: (c) => lista(c.cc) },
  { rotulo: 'Contato', ler: (c) => c.contato ?? '' },
  { rotulo: 'Telefone', ler: (c) => c.telefone ?? '' },
  { rotulo: 'Prazo de pagamento', ler: (c) => c.prazoPagamento ?? '' },
  {
    rotulo: 'Faturamento',
    ler: (c) =>
      descreverRegra(
        regraDoCliente({ regra: c.regra ?? 'dia', diaEmissao: c.diaEmissao ?? null, inicioLocacao: c.inicioLocacao ?? null, periodoDias: c.periodoDias ?? null }),
      ),
  },
  {
    rotulo: 'Frotas',
    ler: (c) =>
      (c.frotas ?? [])
        .map((f) => `FT${f.numero}${f.valor ? ` ${formatarReais(f.valor)}` : ''}${f.descricao ? ` (${f.descricao})` : ''}`)
        .join(' · '),
  },
  { rotulo: 'Observações', ler: (c) => c.observacoes ?? '' },
];

/** Só os campos que mudam, com antes e depois. */
export function diferencas(atual: Cliente | null, nova: ClienteInput): { rotulo: string; antes: string; depois: string }[] {
  return CAMPOS.map((c) => ({ rotulo: c.rotulo, antes: atual ? c.ler(atual) : '', depois: c.ler(nova) })).filter((d) => d.antes !== d.depois);
}

function Decisao({ aprovar, recusar }: { aprovar: () => Promise<void>; recusar: (motivo: string) => Promise<void> }) {
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const rodar = async (f: () => Promise<void>) => {
    setOcupado(true);
    try {
      await f();
    } finally {
      setOcupado(false);
    }
  };
  if (recusando)
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <input aria-label="Motivo da recusa" className="input min-w-[200px] flex-1" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (opcional), ex.: valor errado" />
        <button type="button" className="btn-secondary" onClick={() => setRecusando(false)}>
          Voltar
        </button>
        <button type="button" className="btn bg-bad text-white hover:opacity-90" disabled={ocupado} onClick={() => rodar(() => recusar(motivo.trim()))}>
          Confirmar recusa
        </button>
      </div>
    );
  return (
    <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-line pt-3">
      <button type="button" className="btn-secondary" onClick={() => setRecusando(true)}>
        Recusar
      </button>
      <button type="button" className="btn-primary" disabled={ocupado} onClick={() => rodar(aprovar)}>
        Aprovar e aplicar
      </button>
    </div>
  );
}

export function CartaoProposta({ p, children }: { p: Proposta; children?: React.ReactNode }) {
  const st = STATUS_MOV[p.status];
  // pendente: o que muda se aprovar agora; decidida: o que a pessoa enviou
  const difs = diferencas(p.atual, p.status === 'pendente' ? p.resultado ?? p.dados : p.dados);
  return (
    <article className="rounded-xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-bold">{p.clienteId ? `Alteração no cadastro: ${p.atual?.nome ?? p.dados.nome}` : `Novo cliente: ${p.dados.nome}`}</div>
          <div className="text-xs text-ink-3">
            Proposta por {p.criadaPorNome || '—'} em {dataHora(p.criadaEm)}
            {p.decididaEm && ` · ${p.status === 'aprovada' ? 'aprovada' : 'recusada'} por ${p.decididaPorNome ?? '—'}`}
            {p.motivo && ` · motivo: ${p.motivo}`}
          </div>
        </div>
        <Chip tom={st.tom}>{st.rotulo}</Chip>
      </div>
      {difs.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">Nenhuma diferença em relação ao cadastro atual.</p>
      ) : (
        <div className="mt-2.5 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-xs text-ink-3">
                <th className="py-1 pr-3 font-medium">Campo</th>
                <th className="py-1 pr-3 font-medium">Antes</th>
                <th className="py-1 font-medium">Depois</th>
              </tr>
            </thead>
            <tbody>
              {difs.map((d) => (
                <tr key={d.rotulo} className="border-t border-line-soft align-top">
                  <td className="py-1.5 pr-3 font-medium">{d.rotulo}</td>
                  <td className="py-1.5 pr-3 text-ink-3 line-through decoration-ink-3/50">{d.antes || '—'}</td>
                  <td className="py-1.5 font-semibold">{d.depois || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {children}
    </article>
  );
}

export function Aprovacoes() {
  const { movimentacoes, propostas, recarregarOperacoes, avisar, ehFinanceiro } = useEstado();
  const movPend = movimentacoes.filter((m) => m.status === 'pendente');
  const propPend = propostas.filter((p) => p.status === 'pendente');
  const decididas = [
    ...movimentacoes.filter((m) => m.status !== 'pendente' && m.criadaPorNome && m.decididaEm && m.decididaPorNome !== m.criadaPorNome).map((m) => ({ quando: m.decididaEm!, mov: m, prop: null })),
    ...propostas.filter((p) => p.status !== 'pendente').map((p) => ({ quando: p.decididaEm ?? p.criadaEm, mov: null, prop: p })),
  ]
    .sort((a, b) => b.quando.localeCompare(a.quando))
    .slice(0, 15);

  const decidirMov = async (id: string, aprovar: boolean, motivo = '') => {
    try {
      await api.decidirMovimentacao(id, aprovar, motivo);
      await recarregarOperacoes();
      avisar(aprovar ? 'Movimentação aprovada e aplicada no cadastro.' : 'Movimentação recusada.');
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível concluir.', 'bad');
    }
  };
  const decidirProp = async (id: string, aprovar: boolean, motivo = '') => {
    try {
      await api.decidirProposta(id, aprovar, motivo);
      await recarregarOperacoes();
      avisar(aprovar ? 'Alteração aprovada e aplicada no cadastro.' : 'Alteração recusada.');
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível concluir.', 'bad');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold">{ehFinanceiro ? 'Aprovações' : 'Minhas alterações'}</h1>
        <p className="text-[13px] text-ink-3">
          {ehFinanceiro
            ? 'O que Operações registrou ou alterou e ainda não entrou no cadastro. Nada muda até você aprovar.'
            : 'O que você enviou e a situação de cada item.'}
        </p>
      </div>

      {movPend.length + propPend.length === 0 ? (
        <p className="rounded-xl border border-line bg-white p-6 text-center text-ink-3">Nada aguardando aprovação. :)</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {movPend.map((m) => (
            <li key={m.id}>
              <CartaoMov m={m}>{ehFinanceiro && <Decisao aprovar={() => decidirMov(m.id, true)} recusar={(mo) => decidirMov(m.id, false, mo)} />}</CartaoMov>
            </li>
          ))}
          {propPend.map((p) => (
            <li key={p.id}>
              <CartaoProposta p={p}>{ehFinanceiro && <Decisao aprovar={() => decidirProp(p.id, true)} recusar={(mo) => decidirProp(p.id, false, mo)} />}</CartaoProposta>
            </li>
          ))}
        </ul>
      )}

      {decididas.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-bold">Decididas recentemente</h2>
          <ul className="flex flex-col gap-3 opacity-90">
            {decididas.map((d) => (
              <li key={d.mov?.id ?? d.prop!.id}>{d.mov ? <CartaoMov m={d.mov} /> : <CartaoProposta p={d.prop!} />}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
