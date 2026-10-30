import { useMemo, useState } from 'react';
import { useEstado } from '../state';
import type { Movimentacao, NovaMovimentacao, TipoMov } from '../types';
import { api } from '../api';
import { dataBr, hojeIso } from '../lib/calendario';
import { formatarReais, lerReais, reaisParaCampo } from '../lib/dinheiro';
import { emailValido } from '../lib/normalizar';
import { lerTextoMovimentacao, movVazia, NOMES_TIPO } from '../lib/movimentacao';
import { dataHora } from '../lib/email';
import { Chip, type Tom } from '../components/ui';
import { IcBusca } from '../components/Icones';

export const STATUS_MOV: Record<Movimentacao['status'], { rotulo: string; tom: Tom }> = {
  pendente: { rotulo: 'Aguardando aprovação', tom: 'warn' },
  aprovada: { rotulo: 'Aprovada', tom: 'ok' },
  rejeitada: { rotulo: 'Recusada', tom: 'bad' },
};

/** Linhas de detalhe de uma movimentação (usadas aqui e em Aprovações). */
export function detalhesMov(m: { tipo: TipoMov; frota: string; frotaNova?: string | null; dados: Movimentacao['dados'] }): [string, string][] {
  const d = m.dados;
  const l: [string, string][] = [];
  if (m.tipo === 'troca') l.push(['Troca', `FT${m.frota} → FT${m.frotaNova ?? ''}`]);
  if (d.valor !== null) l.push(['Valor da locação', formatarReais(d.valor)]);
  if (d.frete) l.push(['Frete', d.frete === 'lucminas' ? 'Por conta da Lucminas' : 'Por conta do cliente']);
  if (d.gas) l.push(['Gás', `${d.gas} vasilhame${d.gas > 1 ? 's' : ''}`]);
  if (d.contrato) l.push(['Tempo de contrato', d.contrato]);
  if (d.prazoPagamento) l.push(['Prazo de pagamento', d.prazoPagamento]);
  if (d.emails.length) l.push(['E-mails', d.emails.join(', ')]);
  if (d.contatoNome || d.contatoTelefone) l.push(['Contato', [d.contatoNome, d.contatoTelefone].filter(Boolean).join(' · ')]);
  if (d.descricao) l.push(['Equipamento', d.descricao]);
  if (d.observacoes) l.push(['Observações', d.observacoes]);
  return l;
}

export function Movimentacoes() {
  const { clientes, movimentacoes, recarregarOperacoes, ehFinanceiro, avisar } = useEstado();
  const [m, setM] = useState<NovaMovimentacao>(() => movVazia(hojeIso()));
  const [valorTxt, setValorTxt] = useState('');
  const [emailsTxt, setEmailsTxt] = useState('');
  const [colado, setColado] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<'todas' | Movimentacao['status']>('todas');

  const ativos = useMemo(() => clientes.filter((c) => c.ativo).sort((a, b) => a.nome.localeCompare(b.nome)), [clientes]);
  const clienteAtual = m.clienteId ? clientes.find((c) => c.id === m.clienteId) : null;
  const ondeEsta = m.frota.trim() ? clientes.filter((c) => c.ativo && c.frotas.some((f) => f.numero === m.frota.trim().toUpperCase().replace(/^FT[\s-]*/, ''))) : [];

  const mudar = (p: Partial<NovaMovimentacao>) => setM((x) => ({ ...x, ...p }));

  const escolherCliente = (nome: string) => {
    const c = ativos.find((x) => x.nome === nome.trim().toUpperCase());
    mudar({ clienteNome: nome, clienteId: c?.id ?? null });
  };

  const preencherDoTexto = () => {
    const r = lerTextoMovimentacao(colado, clientes);
    if (!Object.keys(r).length) return setErro('Não reconheci nada nesse texto. Preencha os campos abaixo.');
    setErro('');
    setM((x) => ({ ...x, ...r }));
    if (r.valor !== undefined) setValorTxt(r.valor === null ? '' : reaisParaCampo(r.valor));
    if (r.emails) setEmailsTxt(r.emails.join(', '));
    avisar('Campos preenchidos a partir do texto. Confira antes de registrar.');
  };

  const registrar = async () => {
    setErro('');
    if (!m.frota.trim()) return setErro('Informe o número da frota.');
    if (m.tipo === 'troca' && !m.frotaNova?.trim()) return setErro('Informe a frota nova.');
    if (!m.data) return setErro('Informe a data.');
    if (m.tipo !== 'devolucao' && !m.clienteId && !m.clienteNome?.trim()) return setErro('Informe o cliente.');
    const valor = valorTxt.trim() ? lerReais(valorTxt) : null;
    if (valorTxt.trim() && valor === null) return setErro(`Não entendi o valor "${valorTxt}". Use, por exemplo, 3.350,00`);
    const emails = [...new Set(emailsTxt.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
    const inval = emails.find((e) => !emailValido(e));
    if (inval) return setErro(`O e-mail "${inval}" não parece válido.`);
    setSalvando(true);
    try {
      const salva = await api.registrarMovimentacao({ ...m, valor, emails, clienteNome: m.clienteNome?.trim().toUpperCase() });
      await recarregarOperacoes();
      avisar(salva.status === 'aprovada' ? 'Movimentação registrada e aplicada no cadastro.' : 'Movimentação registrada. Ela entra no cadastro quando o financeiro aprovar.');
      setM(movVazia(hojeIso()));
      setValorTxt('');
      setEmailsTxt('');
      setColado('');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível registrar.');
    } finally {
      setSalvando(false);
    }
  };

  const q = busca.trim().toUpperCase();
  const lista = movimentacoes.filter(
    (x) => (filtro === 'todas' || x.status === filtro) && (!q || x.frota.includes(q.replace(/^FT\s*/, '')) || x.clienteNome.includes(q) || x.criadaPorNome.toUpperCase().includes(q)),
  );

  const opcaoTipo = (t: TipoMov) => (
    <label key={t} className={`flex min-h-[44px] flex-1 cursor-pointer items-center gap-2 rounded-[10px] border px-3 text-[13px] ${m.tipo === t ? 'border-ink bg-white font-semibold' : 'border-line-strong bg-white/60'}`}>
      <input type="radio" name="tipo" checked={m.tipo === t} onChange={() => mudar({ tipo: t })} className="h-[18px] w-[18px] accent-ink" />
      {NOMES_TIPO[t]}
    </label>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
      <section className="flex flex-col gap-4 self-start rounded-xl border border-line bg-white p-5">
        <div>
          <h1 className="text-lg font-bold">Registrar movimentação</h1>
          <p className="text-[13px] text-ink-3">
            {ehFinanceiro ? 'Entra no cadastro na hora.' : 'Vai para o financeiro aprovar antes de entrar no cadastro.'}
          </p>
        </div>

        <details className="rounded-xl border border-dashed border-line-strong bg-[#F8F7F3] p-3" open={!m.frota}>
          <summary className="cursor-pointer text-[13px] font-semibold">Colar a mensagem (preenche sozinho)</summary>
          <textarea
            aria-label="Mensagem da movimentação"
            rows={6}
            value={colado}
            onChange={(e) => setColado(e.target.value)}
            placeholder={'NOVA LOCAÇÃO FT35\n20/10/2026\nFENIX NOVUS\n- Valor da Locação: R$3.350,00\n- Frete: Por conta da Lucminas\n…'}
            className="input mt-2 resize-y bg-white py-2 font-mono text-[12.5px]"
          />
          <button type="button" className="btn-secondary btn-sm mt-2" onClick={preencherDoTexto} disabled={!colado.trim()}>
            Preencher campos
          </button>
        </details>

        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Tipo de movimentação">
          {(['locacao', 'troca', 'devolucao'] as TipoMov[]).map(opcaoTipo)}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mov-frota" className="label">
              {m.tipo === 'troca' ? 'Frota que sai' : 'Frota'}
            </label>
            <input id="mov-frota" className="input uppercase" value={m.frota} onChange={(e) => mudar({ frota: e.target.value })} placeholder="FT35" />
          </div>
          {m.tipo === 'troca' ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="mov-frota-nova" className="label">
                Frota que entra
              </label>
              <input id="mov-frota-nova" className="input uppercase" value={m.frotaNova ?? ''} onChange={(e) => mudar({ frotaNova: e.target.value })} placeholder="FT40" />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="mov-data" className="label">
                Data
              </label>
              <input id="mov-data" type="date" className="input" value={m.data} onChange={(e) => mudar({ data: e.target.value })} />
            </div>
          )}
          {m.tipo === 'troca' && (
            <div className="col-span-2 flex flex-col gap-1.5">
              <label htmlFor="mov-data" className="label">
                Data
              </label>
              <input id="mov-data" type="date" className="input" value={m.data} onChange={(e) => mudar({ data: e.target.value })} />
            </div>
          )}
        </div>
        {ondeEsta.length > 0 && (
          <p className="-mt-2 text-xs text-ink-3">
            FT{m.frota.trim().toUpperCase().replace(/^FT[\s-]*/, '')} hoje está em: <b className="text-ink-2">{ondeEsta.map((c) => c.nome).join(', ')}</b>
            {m.tipo === 'locacao' && ' (sai de lá quando a locação for aprovada)'}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="mov-cliente" className="label">
            Cliente {m.tipo === 'devolucao' && <span className="font-normal text-ink-3">(opcional: o sistema acha pela frota)</span>}
          </label>
          <input id="mov-cliente" list="mov-clientes" className="input uppercase" value={m.clienteNome ?? ''} onChange={(e) => escolherCliente(e.target.value)} placeholder="Comece a digitar o nome" />
          <datalist id="mov-clientes">
            {ativos.map((c) => (
              <option key={c.id} value={c.nome} />
            ))}
          </datalist>
          {m.clienteNome?.trim() && (
            <p className="text-xs">{clienteAtual ? <Chip tom="ok">Cliente cadastrado</Chip> : <Chip tom="info">Cliente novo: será cadastrado</Chip>}</p>
          )}
        </div>

        {m.tipo !== 'devolucao' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="mov-valor" className="label">
                  Valor da locação (R$)
                </label>
                <input
                  id="mov-valor"
                  inputMode="decimal"
                  className="input text-right"
                  value={valorTxt}
                  onChange={(e) => setValorTxt(e.target.value)}
                  onBlur={() => {
                    const v = lerReais(valorTxt);
                    if (v !== null) setValorTxt(reaisParaCampo(v));
                  }}
                  placeholder="3.350,00"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="mov-gas" className="label">
                  Vasilhames de gás
                </label>
                <input id="mov-gas" type="number" min={0} max={50} className="input text-center" value={m.gas} onChange={(e) => mudar({ gas: Math.max(0, Number(e.target.value) || 0) })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="mov-frete" className="label">
                  Frete
                </label>
                <select id="mov-frete" className="input" value={m.frete} onChange={(e) => mudar({ frete: e.target.value as NovaMovimentacao['frete'] })}>
                  <option value="">—</option>
                  <option value="lucminas">Por conta da Lucminas</option>
                  <option value="cliente">Por conta do cliente</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="mov-contrato" className="label">
                  Tempo de contrato
                </label>
                <input id="mov-contrato" className="input" value={m.contrato} onChange={(e) => mudar({ contrato: e.target.value })} placeholder="12 meses" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="mov-prazo" className="label">
                Prazo de pagamento
              </label>
              <input id="mov-prazo" className="input" value={m.prazoPagamento} onChange={(e) => mudar({ prazoPagamento: e.target.value })} placeholder="30 dias após emissão da fatura" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="mov-emails" className="label">
                E-mails para a fatura <span className="font-normal text-ink-3">(separe por vírgula)</span>
              </label>
              <input id="mov-emails" className="input" inputMode="email" value={emailsTxt} onChange={(e) => setEmailsTxt(e.target.value)} placeholder="compras@cliente.com.br, comercial@cliente.com.br" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="mov-contato" className="label">
                  Contato
                </label>
                <input id="mov-contato" className="input" value={m.contatoNome} onChange={(e) => mudar({ contatoNome: e.target.value })} placeholder="João Pedro" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="mov-tel" className="label">
                  Telefone
                </label>
                <input id="mov-tel" className="input" inputMode="tel" value={m.contatoTelefone} onChange={(e) => mudar({ contatoTelefone: e.target.value })} placeholder="(31) 98808-9842" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="mov-desc" className="label">
                Equipamento <span className="font-normal text-ink-3">(opcional)</span>
              </label>
              <input id="mov-desc" className="input" value={m.descricao} onChange={(e) => mudar({ descricao: e.target.value })} placeholder="Empilhadeira 2,5t a gás" />
            </div>
          </>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mov-obs" className="label">
            Observações
          </label>
          <textarea id="mov-obs" rows={2} className="input resize-y py-2 text-[13px]" value={m.observacoes} onChange={(e) => mudar({ observacoes: e.target.value })} />
        </div>
        <p className="text-xs text-ink-3">A data de faturamento do cliente não é alterada: ela continua sendo definida no cadastro.</p>

        {erro && (
          <div role="alert" className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">
            {erro}
          </div>
        )}
        <button type="button" className="btn-primary" onClick={registrar} disabled={salvando}>
          {salvando ? 'Registrando…' : ehFinanceiro ? 'Registrar movimentação' : 'Enviar para aprovação'}
        </button>
      </section>

      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Movimentações registradas</h2>
          <div className="flex flex-wrap gap-2">
            <label className="relative">
              <span className="sr-only">Buscar</span>
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
                <IcBusca tamanho={15} />
              </span>
              <input className="input w-[200px] pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Frota ou cliente" />
            </label>
            <select aria-label="Filtrar por situação" className="input w-auto" value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)}>
              <option value="todas">Todas</option>
              <option value="pendente">Aguardando aprovação</option>
              <option value="aprovada">Aprovadas</option>
              <option value="rejeitada">Recusadas</option>
            </select>
          </div>
        </div>
        {lista.length === 0 && <p className="rounded-xl border border-line bg-white p-6 text-center text-ink-3">Nenhuma movimentação {movimentacoes.length ? 'com esse filtro' : 'registrada ainda'}.</p>}
        <ul className="flex flex-col gap-3">
          {lista.map((x) => (
            <li key={x.id}>
              <CartaoMov m={x} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function CartaoMov({ m, children }: { m: Movimentacao; children?: React.ReactNode }) {
  const st = STATUS_MOV[m.status];
  return (
    <article className="rounded-xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-bold">
            {NOMES_TIPO[m.tipo].toUpperCase()} FT{m.frota}
            {m.tipo === 'troca' && m.frotaNova ? ` → FT${m.frotaNova}` : ''}
          </div>
          <div className="text-[13px] text-ink-2">
            {dataBr(m.dados.data)}
            {m.clienteNome && ` · ${m.clienteNome}`}
          </div>
        </div>
        <Chip tom={st.tom}>{st.rotulo}</Chip>
      </div>
      {detalhesMov(m).length > 0 && (
        <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
          {detalhesMov(m).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-3">{k}</dt>
              <dd className="break-words">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-2.5 text-xs text-ink-3">
        Registrada por {m.criadaPorNome || '—'} em {dataHora(m.criadaEm)}
        {m.decididaEm && ` · ${m.status === 'aprovada' ? 'aprovada' : 'recusada'} por ${m.decididaPorNome ?? '—'} em ${dataHora(m.decididaEm)}`}
        {m.motivo && ` · motivo: ${m.motivo}`}
      </p>
      {children}
    </article>
  );
}
