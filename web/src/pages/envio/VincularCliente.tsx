import { useMemo, useState } from 'react';
import type { Cliente, ItemLote } from '../../types';
import { chaveItem, useEstado } from '../../state';
import { sugerirClientes } from '../../lib/pareamento';
import { chaveEmpresa, semAcento } from '../../lib/normalizar';
import { IcBusca, IcMais } from '../../components/Icones';

/** Quando o nome do arquivo não está no cadastro: sugere o cliente provável, permite buscar ou cadastrar. */
export function VincularCliente({ item, cadastrarNovo }: { item: ItemLote; cadastrarNovo: (i: ItemLote) => void }) {
  const { clientes, vincularCliente, avisar } = useEstado();
  const [busca, setBusca] = useState('');

  const sugestoes = useMemo(() => sugerirClientes(item.empresaNoArquivo, clientes), [item.empresaNoArquivo, clientes]);
  const resultados = useMemo(() => {
    const q = chaveEmpresa(busca);
    const qe = semAcento(busca).toLowerCase().trim();
    if (!q && !qe) return [];
    return clientes
      .filter((c) => c.ativo)
      .filter((c) => chaveEmpresa(c.nome).includes(q) || c.apelidos.some((a) => chaveEmpresa(a).includes(q)) || [...c.para, ...c.cc].some((e) => e.includes(qe)))
      .slice(0, 8);
  }, [busca, clientes]);

  const vincular = async (c: Cliente) => {
    await vincularCliente(chaveItem(item), c.id);
    avisar(`Fatura ${item.numero} vinculada a ${c.nome}. O nome "${item.empresaNoArquivo}" será reconhecido automaticamente.`);
  };

  const botao = (c: Cliente, destaque: boolean) => (
    <button
      key={c.id}
      type="button"
      onClick={() => vincular(c)}
      className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border px-3 text-left text-[13px] ${
        destaque ? 'border-ink bg-white font-semibold text-ink hover:bg-brand-tint' : 'border-warn-line bg-white text-ink hover:bg-canvas'
      }`}
    >
      <span>
        {c.nome}
        <span className="block text-xs font-normal text-ink-3">{c.para[0]}</span>
      </span>
      <span className="shrink-0 text-xs font-semibold">É este</span>
    </button>
  );

  return (
    <div className="flex flex-col gap-3 rounded-[10px] bg-warn-soft p-3.5 text-[13px] text-warn-strong">
      <div>
        <b>{item.empresaNoArquivo}</b> não está no cadastro com esse nome. Se for um cliente que já existe, escolha qual: o sistema passa a reconhecer esse nome nas próximas vezes.
      </div>

      {sugestoes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-xs font-semibold text-ink-2">{sugestoes.length > 1 ? 'Clientes prováveis' : 'Cliente provável'}</div>
          {sugestoes.map((c) => botao(c, true))}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`busca-${item.numero}`} className="text-xs font-semibold text-ink-2">
          {sugestoes.length ? 'Não é nenhum desses? Procure' : 'Procure o cliente'}
        </label>
        <div className="flex min-h-[44px] items-center gap-2 rounded-[10px] border border-line-strong bg-white px-3 text-ink-3">
          <IcBusca />
          <input
            id={`busca-${item.numero}`}
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome ou e-mail"
            className="w-full bg-transparent text-ink outline-none"
          />
        </div>
        {resultados.map((c) => botao(c, false))}
        {busca && !resultados.length && <div className="text-xs text-ink-3">Nenhum cliente encontrado.</div>}
      </div>

      <button type="button" className="btn-secondary self-start" onClick={() => cadastrarNovo(item)}>
        <IcMais /> É um cliente novo: cadastrar
      </button>
    </div>
  );
}
