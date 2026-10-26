import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import type { Cliente, ItemLote } from '../../types';
import { chaveItem, useEstado } from '../../state';
import { STATUS_ITEM, statusDoItem, temAviso } from '../../lib/pareamento';
import { montarEmail, referenciaTitulo } from '../../lib/email';
import { chaveEmpresa } from '../../lib/normalizar';
import { Cartao, Chip, Modal } from '../../components/ui';
import { ClienteForm, rascunhoVazio, type Rascunho } from '../../components/ClienteForm';
import { IcAlerta, IcCheck, IcEnviar, IcNota, IcPasta } from '../../components/Icones';
import { PainelFatura, abrirPdf } from './PainelFatura';

type Filtro = 'todos' | 'prontos' | 'avisos' | 'enviados';

type Progresso = {
  total: number;
  feitos: { numero: string; cliente: string; ok: boolean; detalhe: string }[];
  terminou: boolean;
};

const COLUNAS = 'grid grid-cols-[48px_60px_minmax(200px,1.4fr)_minmax(170px,1.1fr)_minmax(150px,1fr)_156px] items-center gap-3';

export function Conferencia() {
  const { lote, definirLote, atualizarItem, clientes, envios, recarregarEnvios, vincularCliente } = useEstado();
  const navegar = useNavigate();
  const [sel, setSel] = useState<string | null>(lote?.itens[0] ? chaveItem(lote.itens[0]) : null);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [pediuLeitura, setPediuLeitura] = useState(true);
  const [confirmar, setConfirmar] = useState(false);
  const [progresso, setProgresso] = useState<Progresso | null>(null);
  const [cadastro, setCadastro] = useState<{ rascunho: Rascunho; chave: string; empresa: string } | null>(null);
  const [trocar, setTrocar] = useState(false);
  const [verNaoReconhecidos, setVerNaoReconhecidos] = useState(false);

  const porId = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes]);
  const anteriores = useMemo(() => {
    const m = new Map<string, (typeof envios)[number]>();
    if (!lote) return m;
    for (const e of envios) if (e.referencia === lote.referencia && e.status !== 'falhou' && !m.has(e.numero)) m.set(e.numero, e);
    return m;
  }, [envios, lote]);

  if (!lote) return null;

  const itens = lote.itens;
  const prontos = itens.filter((i) => statusDoItem(i) === 'pronto');
  const aEnviar = prontos.filter((i) => i.marcado);
  const visiveis = itens.filter((i) => {
    if (filtro === 'prontos') return statusDoItem(i) === 'pronto';
    if (filtro === 'avisos') return temAviso(i);
    if (filtro === 'enviados') return i.enviado;
    return true;
  });
  const selecionado = itens.find((i) => chaveItem(i) === sel) ?? null;

  const enderecos = aEnviar.reduce((s, i) => {
    const c = porId.get(i.clienteId!);
    return s + (c ? c.para.length + c.cc.length : 0);
  }, 0);
  const clientesUnicos = new Set(aEnviar.map((i) => i.clienteId)).size;
  const todosProntosMarcados = prontos.length > 0 && prontos.every((i) => i.marcado);

  const enviar = async () => {
    setConfirmar(false);
    const fila = [...aEnviar];
    setProgresso({ total: fila.length, feitos: [], terminou: false });
    for (const item of fila) {
      const cliente = porId.get(item.clienteId!) as Cliente;
      const { assunto, corpo } = montarEmail(item, cliente, lote.referencia);
      try {
        const envio = await api.enviar({
          referencia: lote.referencia,
          numero: item.numero,
          clienteId: cliente.id,
          assunto,
          corpo,
          anexos: [item.fatura!, item.boleto!].map((a) => ({ nome: a.nome, blob: a.blob })),
          pediuLeitura,
          observacao: item.observacao,
        });
        atualizarItem(chaveItem(item), (i) => ({ ...i, enviado: true, marcado: false }));
        setProgresso((p) => p && { ...p, feitos: [...p.feitos, { numero: item.numero, cliente: cliente.nome, ok: envio.status !== 'falhou', detalhe: envio.detalhe }] });
      } catch (e) {
        setProgresso((p) => p && { ...p, feitos: [...p.feitos, { numero: item.numero, cliente: cliente.nome, ok: false, detalhe: e instanceof Error ? e.message : 'Erro no envio' }] });
      }
    }
    await recarregarEnvios();
    setProgresso((p) => p && { ...p, terminou: true });
  };

  const filtros: { id: Filtro; rotulo: string; n: number }[] = [
    { id: 'todos', rotulo: 'Todos', n: itens.length },
    { id: 'prontos', rotulo: 'Prontos', n: prontos.length },
    { id: 'avisos', rotulo: 'Com aviso', n: itens.filter(temAviso).length },
    { id: 'enviados', rotulo: 'Enviados', n: itens.filter((i) => i.enviado).length },
  ];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Conferência do lote</div>
          <h1 className="mt-1 text-[26px] font-bold">Faturas de {referenciaTitulo(lote.referencia)}</h1>
          <div className="flex items-center gap-1.5 text-[13px] text-ink-3">
            <IcPasta tamanho={14} />
            <span className="font-mono">{lote.origem}</span>
            <span>· {itens.filter((i) => i.fatura).length + itens.filter((i) => i.boleto).length + lote.naoReconhecidos.length} PDFs lidos</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => (itens.some((i) => i.enviado) ? definirLote(null) : setTrocar(true))}
          >
            Trocar pasta / .zip
          </button>
          <button type="button" className="btn-primary" disabled={aEnviar.length === 0} onClick={() => setConfirmar(true)}>
            <IcEnviar /> {aEnviar.length ? `Enviar ${aEnviar.length} e-mail${aEnviar.length > 1 ? 's' : ''}` : 'Nada selecionado'}
          </button>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <Cartao rotulo="Faturas encontradas" valor={itens.filter((i) => i.fatura).length} />
        <Cartao rotulo="Prontas para envio" valor={prontos.length} cor="text-ok" />
        <Cartao rotulo="Precisam de atenção" valor={itens.filter(temAviso).length} cor="text-warn" />
        <Cartao rotulo="Enviadas neste lote" valor={itens.filter((i) => i.enviado).length} cor="text-info" />
      </div>

      {lote.naoReconhecidos.length > 0 && (
        <div className="mb-5 rounded-xl border border-warn-line bg-warn-soft px-4 py-3 text-[13px] text-warn-strong">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <IcAlerta /> {lote.naoReconhecidos.length} PDF{lote.naoReconhecidos.length > 1 ? 's' : ''} com nome fora do padrão (não entram no envio).
            </span>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setVerNaoReconhecidos((v) => !v)} aria-expanded={verNaoReconhecidos}>
              {verNaoReconhecidos ? 'Esconder' : 'Ver quais'}
            </button>
          </div>
          {verNaoReconhecidos && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {lote.naoReconhecidos.map((a) => (
                <li key={a.caminho}>
                  <button type="button" onClick={() => abrirPdf(a.blob)} className="rounded-md bg-white px-2 py-1 font-mono text-xs text-ink hover:bg-canvas">
                    {a.nome}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar faturas">
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
            {f.rotulo} ({f.n})
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <section aria-label="Faturas do lote" className="card min-w-0 flex-[999_1_640px] overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[880px]">
              <div className={`${COLUNAS} border-b border-line bg-[#F8F9FB] px-4 py-2.5 text-xs font-semibold text-ink-3`}>
                <label className="flex items-center justify-center">
                  <span className="sr-only">Marcar todas as prontas</span>
                  <input
                    type="checkbox"
                    className="h-[18px] w-[18px] accent-brand"
                    checked={todosProntosMarcados}
                    disabled={prontos.length === 0}
                    onChange={(e) => prontos.forEach((i) => atualizarItem(chaveItem(i), (x) => ({ ...x, marcado: e.target.checked })))}
                  />
                </label>
                <span>Nº</span>
                <span>Empresa / cliente</span>
                <span>Arquivos</span>
                <span>Para</span>
                <span>Situação</span>
              </div>
              {visiveis.length === 0 && <div className="px-4 py-6 text-ink-3">Nenhuma fatura neste filtro.</div>}
              {visiveis.map((i) => (
                <Linha
                  key={chaveItem(i)}
                  item={i}
                  cliente={i.clienteId ? porId.get(i.clienteId) : undefined}
                  selecionada={sel === chaveItem(i)}
                  jaEnviada={!i.enviado && anteriores.has(i.numero)}
                  selecionar={() => setSel(chaveItem(i))}
                  alternar={() => atualizarItem(chaveItem(i), (x) => ({ ...x, marcado: !x.marcado }))}
                />
              ))}
            </div>
          </div>
        </section>

        <PainelFatura
          item={selecionado}
          referencia={lote.referencia}
          pediuLeitura={pediuLeitura}
          setPediuLeitura={setPediuLeitura}
          envioAnterior={selecionado && !selecionado.enviado ? anteriores.get(selecionado.numero) : undefined}
          cadastrarNovo={(item) => setCadastro({ rascunho: rascunhoVazio(item.empresaNoArquivo), chave: chaveItem(item), empresa: item.empresaNoArquivo })}
        />
      </div>

      <Modal aberto={confirmar} fechar={() => setConfirmar(false)} titulo="Confirmar envio">
        <p className="text-ink-2">
          Serão enviados <b>{aEnviar.length} e-mails</b> para <b>{clientesUnicos} clientes</b> ({enderecos} endereços, contando cópias), referentes a{' '}
          <b>{referenciaTitulo(lote.referencia)}</b>.
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-[18px] text-ink-2">
          <li>Cada e-mail sai de financeiro@lucminas.com.br, com a fatura e o boleto anexados.</li>
          <li>Uma cópia de cada um fica na pasta Enviados.</li>
          <li>{pediuLeitura ? 'Com pedido de confirmação de leitura.' : 'Sem pedido de confirmação de leitura.'}</li>
          <li>Faturas com aviso não são enviadas.</li>
        </ul>
        <div className="mt-1.5 flex flex-wrap justify-end gap-2.5">
          <button type="button" className="btn-secondary" onClick={() => setConfirmar(false)}>
            Voltar
          </button>
          <button type="button" className="btn-primary" onClick={enviar}>
            Enviar agora
          </button>
        </div>
      </Modal>

      <Modal aberto={!!progresso} fechar={() => progresso?.terminou && setProgresso(null)} titulo={progresso?.terminou ? 'Envio concluído' : 'Enviando…'}>
        {progresso && (
          <>
            <div>
              <div className="mb-1.5 flex justify-between text-[13px] text-ink-2">
                <span>
                  {progresso.feitos.length} de {progresso.total}
                </span>
                {progresso.terminou && (
                  <span>
                    {progresso.feitos.filter((f) => f.ok).length} ok · {progresso.feitos.filter((f) => !f.ok).length} com problema
                  </span>
                )}
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-line-soft" role="progressbar" aria-valuemin={0} aria-valuemax={progresso.total} aria-valuenow={progresso.feitos.length}>
                <div className="h-full bg-brand transition-all" style={{ width: `${(progresso.feitos.length / progresso.total) * 100}%` }} />
              </div>
            </div>
            <ul className="flex max-h-[280px] flex-col gap-1.5 overflow-y-auto text-[13px]">
              {progresso.feitos.map((f) => (
                <li key={f.numero} className="flex items-start gap-2">
                  <span className={`mt-0.5 ${f.ok ? 'text-ok' : 'text-bad'}`}>{f.ok ? <IcCheck /> : <IcAlerta />}</span>
                  <span>
                    <b className="font-mono">{f.numero}</b> {f.cliente}
                    {!f.ok || f.detalhe.includes('não existe') ? <span className="block text-xs text-bad">{f.detalhe}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            {progresso.terminou && (
              <div className="flex flex-wrap justify-end gap-2.5">
                <button type="button" className="btn-secondary" onClick={() => setProgresso(null)}>
                  Continuar na conferência
                </button>
                <button type="button" className="btn-primary" onClick={() => navegar('/historico')}>
                  Ver no histórico
                </button>
              </div>
            )}
          </>
        )}
      </Modal>

      <ClienteForm
        inicial={cadastro?.rascunho ?? null}
        fechar={() => setCadastro(null)}
        aoSalvar={(c) => {
          // se o nome cadastrado não bate com o do arquivo, vincula e o sistema aprende o apelido
          if (!cadastro) return;
          const k = chaveEmpresa(cadastro.empresa);
          const bate = chaveEmpresa(c.nome) === k || c.apelidos.some((a) => chaveEmpresa(a) === k);
          if (!bate) vincularCliente(cadastro.chave, c.id);
        }}
      />

      <Modal aberto={trocar} fechar={() => setTrocar(false)} titulo="Trocar pasta?">
        <p className="text-ink-2">A conferência atual será descartada (incluindo as observações digitadas nas faturas). Nada foi enviado ainda.</p>
        <div className="flex flex-wrap justify-end gap-2.5">
          <button type="button" className="btn-secondary" onClick={() => setTrocar(false)}>
            Voltar
          </button>
          <button type="button" className="btn-primary" onClick={() => definirLote(null)}>
            Descartar e trocar
          </button>
        </div>
      </Modal>
    </div>
  );
}

function Linha({
  item,
  cliente,
  selecionada,
  jaEnviada,
  selecionar,
  alternar,
}: {
  item: ItemLote;
  cliente: Cliente | undefined;
  selecionada: boolean;
  jaEnviada: boolean;
  selecionar: () => void;
  alternar: () => void;
}) {
  const st = statusDoItem(item);
  const meta = STATUS_ITEM[st];
  let info = '';
  if (st === 'boleto_sem_fatura') info = 'Não há fatura com esse número';
  else if (!cliente) info = 'Não encontrado no cadastro';
  else if (item.vinculo === 'nome') info = 'Cliente encontrado no cadastro';
  else info = `Vinculado a ${cliente.nome}`;

  return (
    <div className={`${COLUNAS} border-b border-line-soft px-4 py-1.5 ${selecionada ? 'bg-brand-tint shadow-[inset_4px_0_0_#FFC400]' : 'hover:bg-[#FAFBFC]'}`}>
      <div className="flex min-h-[44px] items-center justify-center">
        <input
          type="checkbox"
          className="h-[18px] w-[18px] accent-brand"
          checked={st === 'pronto' && item.marcado}
          disabled={st !== 'pronto'}
          onChange={alternar}
          aria-label={`Incluir fatura ${item.numero} no envio`}
        />
      </div>
      <span className="font-mono font-medium">{item.numero}</span>
      <button type="button" onClick={selecionar} className="min-h-[44px] py-1.5 text-left">
        <span className="block font-semibold">{item.empresaNoArquivo || '(sem fatura)'}</span>
        <span className="block text-xs text-ink-3">{info}</span>
      </button>
      <div className="flex flex-col gap-0.5 font-mono text-[11.5px] text-ink-2">
        <span>{item.fatura?.nome ?? '— sem fatura —'}</span>
        <span className={item.boleto ? '' : 'font-medium text-warn'}>{item.boleto?.nome ?? '— boleto não encontrado —'}</span>
      </div>
      <div className="min-w-0 text-[12.5px] text-ink-2">
        {cliente ? (
          <>
            <span className="block truncate">
              {cliente.para[0]}
              {cliente.para.length > 1 ? `  +${cliente.para.length - 1}` : ''}
            </span>
            <span className="block text-xs text-ink-3">{cliente.cc.length ? `Cópia: ${cliente.cc.length} endereço${cliente.cc.length > 1 ? 's' : ''}` : 'Sem cópia'}</span>
          </>
        ) : (
          '—'
        )}
      </div>
      <div className="flex flex-col items-start gap-1">
        <Chip tom={meta.tom}>{meta.rotulo}</Chip>
        {jaEnviada && <span className="text-[11.5px] font-medium text-info">Já enviada antes</span>}
        {item.observacao.trim() && (
          <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-3">
            <IcNota tamanho={12} /> com observação
          </span>
        )}
      </div>
    </div>
  );
}
