import { useMemo, useState } from 'react';
import { useEstado } from '../state';
import { chaveEmpresa, semAcento } from '../lib/normalizar';
import { data } from '../lib/email';
import { ClienteForm, rascunhoDe, rascunhoVazio, type Rascunho } from '../components/ClienteForm';
import { Chip } from '../components/ui';
import { IcBusca, IcMais } from '../components/Icones';
import { baixarModelo, exportarClientes, useImportacao } from '../components/ImportarClientes';
import { apagarExemplos, temExemplos } from '../api/mock';
import { MODO_DEMO } from '../api';

const COLUNAS = 'grid grid-cols-[minmax(220px,1.3fr)_minmax(200px,1.2fr)_minmax(200px,1.2fr)_minmax(200px,1.3fr)_96px_88px] gap-3';

export function Clientes() {
  const { clientes } = useEstado();
  const [busca, setBusca] = useState('');
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [editando, setEditando] = useState<Rascunho | null>(null);
  const importacao = useImportacao();

  const lista = useMemo(() => {
    const q = semAcento(busca).toUpperCase().trim();
    const qk = chaveEmpresa(busca);
    return clientes.filter((c) => {
      if (!mostrarInativos && !c.ativo) return false;
      if (!q) return true;
      return (
        chaveEmpresa(c.nome).includes(qk) ||
        c.apelidos.some((a) => chaveEmpresa(a).includes(qk)) ||
        [...c.para, ...c.cc].some((e) => e.toUpperCase().includes(q)) ||
        c.cnpj.replace(/\D/g, '').includes(q.replace(/\D/g, '') || '§')
      );
    });
  }, [clientes, busca, mostrarInativos]);

  const inativos = clientes.filter((c) => !c.ativo).length;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Cadastro</div>
          <h1 className="mt-1 text-[26px] font-bold">Clientes e e-mails</h1>
          <p className="text-[13px] text-ink-3">O nome cadastrado é o que aparece no arquivo da fatura. Cada cliente pode ter vários e-mails em Para e em Cópia.</p>
          <button type="button" onClick={baixarModelo} className="mt-1 min-h-[32px] text-xs font-semibold text-ink-2 underline underline-offset-2 hover:text-ink">
            Baixar planilha modelo
          </button>
          {clientes.length > 0 && (
            <button type="button" onClick={() => exportarClientes(clientes)} className="ml-4 mt-1 min-h-[32px] text-xs font-semibold text-ink-2 underline underline-offset-2 hover:text-ink">
              Exportar cadastro (backup)
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="flex min-h-[44px] items-center gap-2 rounded-[10px] border border-line-strong bg-white px-3 text-ink-3">
            <IcBusca />
            <span className="sr-only">Buscar cliente</span>
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, e-mail ou CNPJ" className="w-[240px] bg-transparent text-ink outline-none" />
          </label>
          {importacao.botao}
          <button type="button" className="btn-primary" onClick={() => setEditando(rascunhoVazio())}>
            <IcMais /> Novo cliente
          </button>
        </div>
      </div>

      {importacao.aberta ? (
        importacao.previa
      ) : (
        <>
      {MODO_DEMO && temExemplos() && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn-line bg-warn-soft px-4 py-3 text-[13px] text-warn-strong">
          <span>Versão de demonstração: há clientes e envios fictícios (e-mails terminados em .exemplo.br). Os dados ficam só neste navegador.</span>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => {
              apagarExemplos();
              window.location.reload();
            }}
          >
            Apagar exemplos
          </button>
        </div>
      )}
      {clientes.length === 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3 text-[13px]">
          <span>Tem a lista de clientes numa planilha? Importe de uma vez (formato Cliente | Email, ou o modelo completo).</span>
          <button type="button" className="btn-secondary btn-sm" onClick={baixarModelo}>
            Baixar modelo
          </button>
        </div>
      )}
      {inativos > 0 && (
        <label className="mb-3 flex items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" checked={mostrarInativos} onChange={(e) => setMostrarInativos(e.target.checked)} className="h-[18px] w-[18px] accent-ink" />
          Mostrar clientes desativados ({inativos})
        </label>
      )}

      <section aria-label="Lista de clientes" className="card overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[920px]">
            <div className={`${COLUNAS} border-b border-line bg-[#F8F9FB] px-4 py-2.5 text-xs font-semibold text-ink-3`}>
              <span>Cliente</span>
              <span>Para</span>
              <span>Cópia</span>
              <span>Observações</span>
              <span>Atualizado</span>
              <span className="sr-only">Ações</span>
            </div>
            {lista.map((c) => (
              <div key={c.id} className={`${COLUNAS} items-start border-b border-line-soft px-4 py-3 text-[13px] ${c.ativo ? '' : 'opacity-60'}`}>
                <div>
                  <div className="flex flex-wrap items-center gap-2 font-semibold">
                    {c.nome}
                    {!c.ativo && <Chip tom="neutro">Desativado</Chip>}
                  </div>
                  {c.apelidos.length > 0 && <div className="text-xs text-ink-3">Também aparece como: {c.apelidos.join(', ')}</div>}
                  {c.cnpj && <div className="font-mono text-xs text-ink-3">{c.cnpj}</div>}
                </div>
                <div className="flex min-w-0 flex-col gap-0.5 [overflow-wrap:anywhere] text-ink-2">
                  {c.para.map((e) => (
                    <span key={e}>{e}</span>
                  ))}
                </div>
                <div className="flex min-w-0 flex-col gap-0.5 [overflow-wrap:anywhere] text-ink-2">
                  {c.cc.length ? c.cc.map((e) => <span key={e}>{e}</span>) : <span className="text-ink-3">—</span>}
                </div>
                <div className="text-ink-2">{c.observacoes || '—'}</div>
                <div className="text-xs text-ink-3">{data(c.atualizadoEm)}</div>
                <div>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setEditando(rascunhoDe(c))} aria-label={`Editar ${c.nome}`}>
                    Editar
                  </button>
                </div>
              </div>
            ))}
            {lista.length === 0 && (
              <div className="px-4 py-6 text-ink-3">{clientes.length ? 'Nenhum cliente encontrado para essa busca.' : 'Nenhum cliente cadastrado ainda.'}</div>
            )}
          </div>
        </div>
      </section>

        </>
      )}

      <ClienteForm inicial={editando} fechar={() => setEditando(null)} />
    </div>
  );
}
