import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEstado } from '../state';
import { chaveEmpresa, semAcento } from '../lib/normalizar';
import { IcBusca } from './Icones';

export type Resultado = { tipo: 'Cliente' | 'Frota' | 'Solicitação' | 'Fatura'; titulo: string; detalhe: string; rota: string };

/** "ft 35", "FT-35", "frota 35" → "35" */
const numeroDeFrota = (q: string) =>
  semAcento(q)
    .toUpperCase()
    .replace(/^(FROTA|FT)[\s-]*/, '')
    .trim();

/**
 * Busca do topo: cliente, frota, solicitação ou fatura enviada, de qualquer tela.
 * Só procura no que o perfil da pessoa pode ver.
 */
export function useBusca(q: string): Resultado[] {
  const { clientes, oficina, solicitacoes, envios, pode } = useEstado();
  return useMemo(() => {
    const texto = q.trim();
    if (texto.length < 2) return [];
    const k = chaveEmpresa(texto);
    const num = numeroDeFrota(texto);
    const r: Resultado[] = [];
    const telaCliente = (nome: string) => (pode('clientes') ? `/clientes?busca=${encodeURIComponent(nome)}` : `/frotas?busca=${encodeURIComponent(nome)}`);

    if (pode('frotas') && /^[A-Z0-9-]{1,10}$/.test(num)) {
      const vistas = new Set<string>();
      for (const c of clientes)
        for (const f of c.frotas)
          if (f.numero === num || (num.length >= 2 && f.numero.startsWith(num))) {
            vistas.add(f.numero);
            r.push({
              tipo: 'Frota',
              titulo: `FT${f.numero}`,
              detalhe: `${c.nome}${c.ativo ? '' : ' (desativado)'}${f.descricao ? ` · ${f.descricao}` : ''}`,
              rota: `/frotas?busca=${encodeURIComponent(f.numero)}`,
            });
          }
      for (const o of oficina)
        if (!vistas.has(o.frota) && o.frota === num)
          r.push({ tipo: 'Frota', titulo: `FT${o.frota}`, detalhe: `na oficina${o.observacao ? ` · ${o.observacao}` : ''}`, rota: `/frotas?busca=${encodeURIComponent(o.frota)}` });
    }
    if (pode('clientes') || pode('frotas')) {
      for (const c of clientes) {
        const apelido = c.apelidos.find((a) => chaveEmpresa(a).includes(k));
        if (chaveEmpresa(c.nome).includes(k) || apelido || (texto.replace(/\D/g, '').length >= 4 && c.cnpj.replace(/\D/g, '').includes(texto.replace(/\D/g, ''))))
          r.push({
            tipo: 'Cliente',
            titulo: c.nome,
            detalhe: [apelido && `também "${apelido}"`, `${c.frotas.length} frota${c.frotas.length === 1 ? '' : 's'}`, !c.ativo && 'desativado'].filter(Boolean).join(' · '),
            rota: telaCliente(c.nome),
          });
      }
    }
    if (pode('solicitacoes'))
      for (const s of solicitacoes)
        if (chaveEmpresa(`${s.titulo} ${s.clienteNome ?? ''}`).includes(k))
          r.push({
            tipo: 'Solicitação',
            titulo: s.titulo,
            detalhe: `${s.clienteNome ?? ''}${s.status === 'concluida' ? ' · concluída' : ' · aberta'}`,
            rota: `/solicitacoes?id=${s.id}`,
          });
    if (pode('historico') && /^\d{3,}$/.test(texto))
      for (const e of envios)
        if (e.numero === texto)
          r.push({
            tipo: 'Fatura',
            titulo: `Fatura ${e.numero}`,
            detalhe: `${e.clienteNome} · ${e.referencia.slice(5)}/${e.referencia.slice(0, 4)}`,
            rota: `/historico?busca=${e.numero}`,
          });
    return r.slice(0, 8);
  }, [q, clientes, oficina, solicitacoes, envios, pode]);
}

export function BuscaGeral() {
  const [q, setQ] = useState('');
  const [aberta, setAberta] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const ir = useNavigate();
  const resultados = useBusca(q);
  const caixa = useRef<HTMLDivElement>(null);

  const escolher = (r: Resultado | undefined) => {
    if (!r) return;
    ir(r.rota);
    setQ('');
    setAberta(false);
  };

  return (
    <div
      ref={caixa}
      className="relative mx-auto w-full max-w-[520px]"
      onBlur={(e) => {
        if (!caixa.current?.contains(e.relatedTarget as Node)) setAberta(false);
      }}
    >
      <label className="relative block">
        <span className="sr-only">Buscar no sistema</span>
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/55">
          <IcBusca tamanho={16} />
        </span>
        <input
          type="search"
          role="combobox"
          aria-expanded={aberta && q.trim().length >= 2}
          aria-controls="busca-resultados"
          aria-activedescendant={resultados[ativo] ? `busca-${ativo}` : undefined}
          className="h-10 w-full rounded-lg border border-white/15 bg-white/10 pl-9 pr-3 text-[14px] text-white placeholder:text-white/50 focus:border-brand focus:bg-white/15 focus:outline-none"
          placeholder="Buscar cliente, frota, solicitação…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setAtivo(0);
            setAberta(true);
          }}
          onFocus={() => setAberta(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setAtivo((a) => Math.min(a + 1, resultados.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setAtivo((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              escolher(resultados[ativo]);
            } else if (e.key === 'Escape') {
              setAberta(false);
            }
          }}
        />
      </label>
      {aberta && q.trim().length >= 2 && (
        <ul
          id="busca-resultados"
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-xl border border-line bg-white text-ink shadow-xl"
        >
          {resultados.length === 0 && <li className="px-4 py-3 text-[13px] text-ink-3">Nada encontrado para “{q.trim()}”.</li>}
          {resultados.map((r, i) => (
            <li key={`${r.tipo}-${r.rota}-${i}`} id={`busca-${i}`} role="option" aria-selected={i === ativo}>
              <button
                type="button"
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${i === ativo ? 'bg-brand-tint' : 'hover:bg-canvas'}`}
                onMouseEnter={() => setAtivo(i)}
                onClick={() => escolher(r)}
              >
                <span className="w-[86px] shrink-0 text-[11px] font-bold uppercase tracking-wide text-ink-3">{r.tipo}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{r.titulo}</span>
                  {r.detalhe && <span className="block truncate text-xs text-ink-3">{r.detalhe}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
