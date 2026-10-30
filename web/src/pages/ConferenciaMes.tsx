import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useEstado } from '../state';
import { api } from '../api';
import type { Cliente, Conferencia, Frota } from '../types';
import { formatarReais, lerReais, reaisParaCampo } from '../lib/dinheiro';
import { referenciaAtual, referenciaTitulo, dataHora } from '../lib/email';
import { chaveEmpresa } from '../lib/normalizar';
import { Chip } from '../components/ui';
import { IcBusca, IcCheck } from '../components/Icones';

type Linha = { cliente: Cliente; frota: Frota; marca: Conferencia | null; situacao: 'pendente' | 'ok' | 'alterado' | 'mudou' };
type Filtro = 'pendente' | 'ok' | 'alterado' | 'todas';

const comparaNumero = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });
const chave = (clienteId: string, frota: string) => `${clienteId}|${frota}`;

function mudarMes(ref: string, delta: number) {
  const [a, m] = ref.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function ConferenciaMes() {
  const { clientes, propostas, ehFinanceiro, proporCliente, salvarCliente, avisar } = useEstado();
  const aguardando = new Set(propostas.filter((p) => p.status === 'pendente' && p.clienteId).map((p) => p.clienteId));
  const [ref, setRef] = useState(referenciaAtual());
  const [marcas, setMarcas] = useState<Conferencia[] | null>(null);
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('pendente');
  const [busca, setBusca] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setMarcas(await api.listarConferencia(ref));
      setErro('');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar.');
    }
  }, [ref]);
  useEffect(() => {
    setMarcas(null);
    carregar();
  }, [carregar]);

  const linhas: Linha[] = useMemo(() => {
    const porChave = new Map((marcas ?? []).map((m) => [chave(m.clienteId, m.frota), m]));
    return clientes
      .filter((c) => c.ativo)
      .flatMap((c) =>
        c.frotas.map((f) => {
          const marca = porChave.get(chave(c.id, f.numero)) ?? null;
          // conferida como certa, mas o valor/descrição mudou depois: precisa olhar de novo
          const situacao: Linha['situacao'] = !marca ? 'pendente' : marca.status === 'alterado' ? 'alterado' : marca.valor !== f.valor ? 'mudou' : 'ok';
          return { cliente: c, frota: f, marca, situacao };
        }),
      )
      .sort((a, b) => comparaNumero(a.frota.numero, b.frota.numero) || a.cliente.nome.localeCompare(b.cliente.nome));
  }, [clientes, marcas]);

  const conta = (s: Linha['situacao'][]) => linhas.filter((l) => s.includes(l.situacao)).length;
  const conferidas = conta(['ok', 'alterado']);
  const total = linhas.length;
  const q = chaveEmpresa(busca);
  const visiveis = linhas.filter((l) => {
    if (q && !chaveEmpresa(`${l.frota.numero} ${l.cliente.nome} ${l.frota.descricao}`).includes(q)) return false;
    if (filtro === 'pendente') return l.situacao === 'pendente' || l.situacao === 'mudou';
    if (filtro === 'ok') return l.situacao === 'ok';
    if (filtro === 'alterado') return l.situacao === 'alterado';
    return true;
  });

  const marcarOk = async (l: Linha) => {
    const k = chave(l.cliente.id, l.frota.numero);
    setOcupado(k);
    try {
      await api.marcarConferencia(ref, { clienteId: l.cliente.id, frota: l.frota.numero, status: 'ok' });
      await carregar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível marcar.', 'bad');
    } finally {
      setOcupado(null);
    }
  };
  const desfazer = async (l: Linha) => {
    const k = chave(l.cliente.id, l.frota.numero);
    setOcupado(k);
    try {
      await api.desmarcarConferencia(ref, l.cliente.id, l.frota.numero);
      await carregar();
    } finally {
      setOcupado(null);
    }
  };

  const enviarCorrecao = async (l: Linha, novoValor: number, novaDescricao: string, observacao: string) => {
    const mudouValor = novoValor !== l.frota.valor;
    const mudouDesc = novaDescricao !== l.frota.descricao;
    const partes = [
      mudouValor ? `valor ${formatarReais(l.frota.valor)} → ${formatarReais(novoValor)}` : '',
      mudouDesc ? `descrição "${l.frota.descricao || '—'}" → "${novaDescricao || '—'}"` : '',
      observacao,
    ].filter(Boolean);
    if (!partes.length) throw new Error('Mude o valor ou a descrição, ou escreva o que está errado.');
    if (mudouValor || mudouDesc) {
      const input = { ...l.cliente, frotas: l.cliente.frotas.map((f) => (f.numero === l.frota.numero ? { ...f, valor: novoValor, descricao: novaDescricao } : f)) };
      if (ehFinanceiro) await salvarCliente(input);
      else await proporCliente(input);
    }
    await api.marcarConferencia(ref, { clienteId: l.cliente.id, frota: l.frota.numero, status: 'alterado', observacao: partes.join('; ') });
    await carregar();
    setEditando(null);
    avisar(
      mudouValor || mudouDesc
        ? ehFinanceiro
          ? `FT${l.frota.numero} corrigida no cadastro.`
          : `Correção da FT${l.frota.numero} enviada para o financeiro aprovar.`
        : `Problema na FT${l.frota.numero} anotado.`,
    );
  };

  const FILTROS: { id: Filtro; rotulo: string; n: number }[] = [
    { id: 'pendente', rotulo: 'A conferir', n: conta(['pendente', 'mudou']) },
    { id: 'ok', rotulo: 'Corretas', n: conta(['ok']) },
    { id: 'alterado', rotulo: 'Com correção', n: conta(['alterado']) },
    { id: 'todas', rotulo: 'Todas', n: total },
  ];
  const pct = total ? Math.round((conferidas / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Conferência de frotas e valores</h1>
          <p className="text-[13px] text-ink-3">Confira cada frota do mês: marque ✓ se está certa ou corrija o que estiver errado.</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-line bg-white p-1">
          <button type="button" className="btn btn-sm h-10 w-10 justify-center" aria-label="Mês anterior" onClick={() => setRef(mudarMes(ref, -1))}>
            ‹
          </button>
          <span className="min-w-[140px] text-center font-semibold">{referenciaTitulo(ref)}</span>
          <button type="button" className="btn btn-sm h-10 w-10 justify-center" aria-label="Próximo mês" onClick={() => setRef(mudarMes(ref, 1))}>
            ›
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-[14px]">
          <span>
            <b className="text-[20px]">{conferidas}</b> de {total} frotas conferidas
          </span>
          <span className="text-ink-3">{conferidas === total && total > 0 ? 'Conferência do mês completa :)' : `${total - conferidas} faltando`}</span>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-line-soft" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso da conferência">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFiltro(f.id)}
              aria-pressed={filtro === f.id}
              className={`min-h-[40px] rounded-full border px-3.5 text-[13px] font-semibold ${filtro === f.id ? 'border-ink bg-ink text-white' : 'border-line-strong bg-white text-ink-2'}`}
            >
              {f.rotulo} ({f.n})
            </button>
          ))}
        </div>
        <label className="relative">
          <span className="sr-only">Buscar</span>
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
            <IcBusca tamanho={15} />
          </span>
          <input className="input w-[220px] pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Frota ou cliente" />
        </label>
      </div>

      {erro && <p className="rounded-xl bg-bad-soft p-4 text-bad-strong">{erro}</p>}
      {marcas === null && !erro && <p className="text-ink-3">Carregando…</p>}
      {marcas !== null && visiveis.length === 0 && (
        <p className="rounded-xl border border-line bg-white p-6 text-center text-ink-3">
          {filtro === 'pendente' && total > 0 ? 'Nada a conferir neste mês. :)' : 'Nenhuma frota com esse filtro.'}
        </p>
      )}
      {marcas !== null && visiveis.length > 0 && (
        <ul className="overflow-hidden rounded-xl border border-line bg-white">
          {visiveis.map((l) => {
            const k = chave(l.cliente.id, l.frota.numero);
            return (
              <li key={k} className={`border-b border-line-soft last:border-b-0 ${l.situacao === 'ok' ? 'bg-ok-soft/40' : ''}`}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <span className="w-[64px] text-[17px] font-bold">FT{l.frota.numero}</span>
                  <span className="min-w-[180px] flex-1">
                    <span className="block font-semibold">{l.cliente.nome}</span>
                    <span className="block text-xs text-ink-3">{l.frota.descricao || 'sem descrição'}</span>
                  </span>
                  <span className={`w-[120px] text-right text-[15px] font-bold ${l.frota.valor ? '' : 'text-bad'}`}>{l.frota.valor ? formatarReais(l.frota.valor) : 'sem valor'}</span>
                  <span className="flex min-w-[250px] flex-wrap items-center justify-end gap-2">
                    {l.situacao === 'ok' && (
                      <>
                        <Chip tom="ok">
                          <IcCheck tamanho={12} className="mr-1" /> Correta
                        </Chip>
                        <button type="button" className="btn btn-sm text-ink-3 underline" disabled={ocupado === k} onClick={() => desfazer(l)}>
                          Desfazer
                        </button>
                      </>
                    )}
                    {l.situacao === 'alterado' && (
                      <>
                        <Chip tom="warn">{aguardando.has(l.cliente.id) ? 'Correção aguardando aprovação' : 'Correção apontada'}</Chip>
                        <button type="button" className="btn btn-sm text-ink-3 underline" disabled={ocupado === k} onClick={() => desfazer(l)}>
                          Desfazer
                        </button>
                      </>
                    )}
                    {(l.situacao === 'pendente' || l.situacao === 'mudou') && (
                      <>
                        {l.situacao === 'mudou' && <Chip tom="info">Valor mudou: confira de novo</Chip>}
                        <button type="button" className="btn-secondary btn-sm" onClick={() => setEditando(editando === k ? null : k)}>
                          Corrigir
                        </button>
                        <button type="button" className="btn btn-sm bg-ok text-white hover:opacity-90" disabled={ocupado === k} onClick={() => marcarOk(l)} aria-label={`FT${l.frota.numero} de ${l.cliente.nome} está correta`}>
                          <IcCheck tamanho={14} /> Correto
                        </button>
                      </>
                    )}
                  </span>
                </div>
                {l.marca && l.situacao !== 'pendente' && (
                  <p className="-mt-1 px-4 pb-2.5 text-xs text-ink-3">
                    {l.marca.usuario} em {dataHora(l.marca.quando)}
                    {l.marca.observacao && ` · ${l.marca.observacao}`}
                  </p>
                )}
                {editando === k && <Correcao linha={l} fechar={() => setEditando(null)} enviar={enviarCorrecao} ehFinanceiro={ehFinanceiro} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Correcao({
  linha,
  fechar,
  enviar,
  ehFinanceiro,
}: {
  linha: Linha;
  fechar: () => void;
  enviar: (l: Linha, valor: number, descricao: string, obs: string) => Promise<void>;
  ehFinanceiro: boolean;
}) {
  const [valor, setValor] = useState(linha.frota.valor ? reaisParaCampo(linha.frota.valor) : '');
  const [descricao, setDescricao] = useState(linha.frota.descricao);
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const id = `${linha.cliente.id}-${linha.frota.numero}`;

  const ok = async () => {
    const v = valor.trim() ? lerReais(valor) : 0;
    if (v === null) return setErro(`Não entendi o valor "${valor}". Use, por exemplo, 3.350,00`);
    setEnviando(true);
    try {
      await enviar(linha, v, descricao.trim(), obs.trim());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível enviar.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="mx-4 mb-3 flex flex-col gap-3 rounded-xl border border-brand bg-brand-soft/40 p-3.5">
      <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
        <div className="flex flex-col gap-1">
          <label htmlFor={`cv-${id}`} className="text-xs font-semibold">
            Valor correto (R$)
          </label>
          <input id={`cv-${id}`} inputMode="decimal" className="input bg-white text-right" value={valor} onChange={(e) => setValor(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`cd-${id}`} className="text-xs font-semibold">
            Descrição
          </label>
          <input id={`cd-${id}`} className="input bg-white" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Empilhadeira 2,5t a gás" />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`co-${id}`} className="text-xs font-semibold">
          O que está errado? <span className="font-normal text-ink-3">(opcional)</span>
        </label>
        <input id={`co-${id}`} className="input bg-white" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: reajuste de outubro" />
      </div>
      <p className="text-xs text-ink-3">
        A frota não está mais com esse cliente? Registre em{' '}
        <Link to="/movimentacoes" className="font-semibold underline">
          Movimentações
        </Link>{' '}
        (devolução ou troca).
      </p>
      {erro && (
        <p role="alert" className="rounded-[10px] bg-bad-soft px-3 py-2 text-[13px] text-bad-strong">
          {erro}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary btn-sm" onClick={fechar}>
          Cancelar
        </button>
        <button type="button" className="btn-primary btn-sm" disabled={enviando} onClick={ok}>
          {enviando ? 'Enviando…' : ehFinanceiro ? 'Salvar correção' : 'Enviar correção'}
        </button>
      </div>
    </div>
  );
}
