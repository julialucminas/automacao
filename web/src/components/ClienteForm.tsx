import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import type { Cliente, ClienteInput, Frota } from '../types';
import { formatarReais, lerReais, reaisParaCampo } from '../lib/dinheiro';
import { dataBr, dataCurta, dataValida, descreverRegra, proximasDatas, regraDoCliente } from '../lib/calendario';
import { emailValido } from '../lib/normalizar';
import { useEstado } from '../state';
import { IcFechar, IcMais } from './Icones';
import { Gaveta } from './ui';

export type Rascunho = {
  id?: string;
  nome: string;
  apelidos: string;
  cnpj: string;
  para: string[];
  cc: string[];
  observacoes: string;
  ativo?: boolean;
  regra: 'dia' | 'periodo';
  /** dia de emissão como texto do campo ('' = não informado) */
  dia: string;
  inicio: string; // AAAA-MM-DD do campo de data
  periodo: string;
  contato: string;
  telefone: string;
  prazoPagamento: string;
  semBoleto: boolean;
  /** frotas com o valor como texto do campo, para permitir digitar à vontade; extra = dados da locação (vêm das movimentações) */
  frotas: { numero: string; valor: string; descricao: string; extra?: Pick<Frota, 'inicio' | 'fim' | 'contrato' | 'gas' | 'frete' | 'freteValor' | 'modalidade'>; freteTxt?: string }[];
};

export const rascunhoVazio = (nome = ''): Rascunho => ({ nome, apelidos: '', cnpj: '', para: [], cc: [], observacoes: '', regra: 'dia', dia: '', inicio: '', periodo: '', contato: '', telefone: '', prazoPagamento: '', semBoleto: false, frotas: [] });

export const rascunhoDe = (c: Cliente): Rascunho => ({
  id: c.id,
  nome: c.nome,
  apelidos: c.apelidos.join(', '),
  cnpj: c.cnpj,
  para: [...c.para],
  cc: [...c.cc],
  observacoes: c.observacoes,
  ativo: c.ativo,
  regra: c.regra,
  dia: c.diaEmissao ? String(c.diaEmissao) : '',
  inicio: c.inicioLocacao ?? '',
  periodo: c.periodoDias ? String(c.periodoDias) : '',
  contato: c.contato ?? '',
  telefone: c.telefone ?? '',
  prazoPagamento: c.prazoPagamento ?? '',
  semBoleto: !!c.semBoleto,
  frotas: c.frotas.map((f) => ({
    numero: f.numero,
    valor: f.valor ? reaisParaCampo(f.valor) : '',
    descricao: f.descricao,
    extra: { inicio: f.inicio ?? null, fim: f.fim ?? null, contrato: f.contrato ?? '', gas: f.gas ?? 0, frete: f.frete ?? '', freteValor: f.freteValor ?? null, modalidade: f.modalidade ?? '' },
    freteTxt: f.freteValor ? reaisParaCampo(f.freteValor) : '',
  })),
});

function ListaEmails({
  id,
  rotulo,
  dica,
  emails,
  mudar,
  pendente,
  setPendente,
  tom,
  erro,
}: {
  id: string;
  rotulo: string;
  dica: string;
  emails: string[];
  mudar: (e: string[]) => void;
  pendente: string;
  setPendente: (s: string) => void;
  tom: 'para' | 'cc';
  erro: (m: string) => void;
}) {
  const adicionar = () => {
    // aceita colar vários de uma vez, separados por vírgula, ponto e vírgula ou espaço
    const novos = pendente
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (!novos.length) return;
    const invalido = novos.find((e) => !emailValido(e));
    if (invalido) {
      erro(`O e-mail "${invalido}" não parece válido.`);
      return;
    }
    mudar([...emails, ...novos.filter((e) => !emails.includes(e))]);
    setPendente('');
    erro('');
  };
  const cor = tom === 'para' ? 'bg-brand-soft text-brand-text' : 'bg-line-soft text-ink-2';
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-[#F8F9FB] p-3.5">
      <label htmlFor={id} className="label">
        {rotulo} <span className="font-normal text-ink-3">({dica})</span>
      </label>
      {emails.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {emails.map((e) => (
            <li key={e} className={`inline-flex items-center gap-0.5 rounded-lg py-0.5 pl-2.5 pr-0.5 text-[13px] ${cor}`}>
              {e}
              <button type="button" aria-label={`Remover ${e}`} onClick={() => mudar(emails.filter((x) => x !== e))} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-black/5">
                <IcFechar tamanho={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          inputMode="email"
          value={pendente}
          onChange={(e) => setPendente(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              adicionar();
            }
          }}
          placeholder="email@cliente.com.br"
          className="input min-w-0 flex-1"
        />
        <button type="button" onClick={adicionar} className="btn-secondary">
          Adicionar
        </button>
      </div>
    </div>
  );
}

export function ClienteForm({
  inicial,
  fechar,
  aoSalvar,
}: {
  inicial: Rascunho | null;
  fechar: () => void;
  aoSalvar?: (c: Cliente) => void;
}) {
  const ehFin = useEstado().pode('clientes', 2);
  return (
    <Gaveta aberto={!!inicial} fechar={fechar} titulo={inicial?.id ? 'Editar cliente' : 'Novo cliente'}>
      {inicial && !ehFin && (
        <p className="rounded-[10px] bg-brand-soft px-3 py-2.5 text-[13px]">
          As alterações vão para o <b>financeiro aprovar</b> antes de entrar no cadastro.
        </p>
      )}
      {inicial && <Formulario key={inicial.id ?? 'novo'} inicial={inicial} fechar={fechar} aoSalvar={aoSalvar} />}
    </Gaveta>
  );
}

function Formulario({ inicial, fechar, aoSalvar }: { inicial: Rascunho; fechar: () => void; aoSalvar?: (c: Cliente) => void }) {
  const { salvarCliente, proporCliente, pode, definirAtivo, clientes, avisar } = useEstado();
  const ehFinanceiro = pode('clientes', 2);
  const [d, setD] = useState<Rascunho>(inicial);
  const [paraIn, setParaIn] = useState('');
  const [ccIn, setCcIn] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    // e-mail digitado e não "adicionado" também entra
    const pend = (s: string) => s.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    const extrasPara = pend(paraIn);
    const extrasCc = pend(ccIn);
    const invalido = [...extrasPara, ...extrasCc].find((e) => !emailValido(e));
    if (invalido) return setErro(`O e-mail "${invalido}" não parece válido.`);
    const para = [...d.para, ...extrasPara.filter((e) => !d.para.includes(e))];
    const cc = [...d.cc, ...extrasCc.filter((e) => !d.cc.includes(e))];

    const nome = d.nome.trim().toUpperCase().replace(/\s+/g, ' ');
    if (!nome) return setErro('Informe o nome como aparece no arquivo da fatura.');
    const repetido = clientes.find((c) => c.id !== d.id && c.nome === nome);
    if (repetido) return setErro(`Já existe um cliente chamado ${nome}.`);

    let diaEmissao: number | null = null;
    if (d.dia.trim()) {
      const n = Number(d.dia);
      if (!Number.isInteger(n) || n < 1 || n > 31) return setErro('O dia de emissão precisa ser um número de 1 a 31.');
      diaEmissao = n;
    }
    let periodoDias: number | null = null;
    if (d.periodo.trim()) {
      const n = Number(d.periodo);
      if (!Number.isInteger(n) || n < 1 || n > 366) return setErro('O período precisa ser um número de dias entre 1 e 366.');
      periodoDias = n;
    }
    if (d.inicio && !dataValida(d.inicio)) return setErro('A data de início da locação não é válida.');
    if (d.regra === 'periodo' && (!d.inicio) !== (!periodoDias)) return setErro('Para faturar por período, preencha a data de início e a quantidade de dias (ou deixe os dois vazios).');
    const frotas: Frota[] = [];
    for (const f of d.frotas) {
      const numero = f.numero.trim().toUpperCase();
      if (!numero && !f.valor.trim() && !f.descricao.trim()) continue; // linha vazia
      if (!numero) return setErro('Preencha o número de todas as frotas (ou remova a linha vazia).');
      if (frotas.some((x) => x.numero === numero)) return setErro(`A frota ${numero} está repetida.`);
      const valor = f.valor.trim() ? lerReais(f.valor) : 0;
      if (valor === null) return setErro(`Não entendi o valor "${f.valor}" da frota ${numero}. Use, por exemplo, 1.500,00`);
      const freteValor = f.extra?.frete === 'cliente' && f.freteTxt?.trim() ? lerReais(f.freteTxt) : null;
      if (f.extra?.frete === 'cliente' && f.freteTxt?.trim() && freteValor === null) return setErro(`Não entendi o valor do frete "${f.freteTxt}" da frota ${numero}.`);
      frotas.push({ numero, valor, descricao: f.descricao.trim(), ...(f.extra ?? {}), freteValor });
    }

    const input: ClienteInput = {
      id: d.id,
      regra: d.regra,
      diaEmissao,
      inicioLocacao: d.inicio || null,
      periodoDias,
      frotas,
      nome,
      apelidos: d.apelidos.split(',').map((a) => a.trim().toUpperCase()).filter(Boolean),
      cnpj: d.cnpj.trim(),
      para,
      cc: cc.filter((e) => !para.includes(e)),
      observacoes: d.observacoes.trim(),
      contato: d.contato.trim(),
      telefone: d.telefone.trim(),
      prazoPagamento: d.prazoPagamento.trim(),
      semBoleto: d.semBoleto,
    };
    setSalvando(true);
    try {
      if (!ehFinanceiro) {
        await proporCliente(input);
        avisar(`Alteração de ${nome} enviada para aprovação do financeiro.`);
      } else {
        const salvo = await salvarCliente(input);
        avisar(`Cliente ${salvo.nome} salvo.`);
        aoSalvar?.(salvo);
      }
      fechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="cad-nome" className="label">
          Nome como aparece no arquivo da fatura
        </label>
        <input id="cad-nome" className="input uppercase" value={d.nome} onChange={(e) => setD({ ...d, nome: e.target.value })} placeholder="METALURGICA SERRA AZUL" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="cad-apelidos" className="label">
          Outros nomes que podem aparecer nos arquivos
        </label>
        <input id="cad-apelidos" className="input" value={d.apelidos} onChange={(e) => setD({ ...d, apelidos: e.target.value })} placeholder="Separe por vírgula. Ex.: SERRA AZUL" />
        <p className="text-xs text-ink-3">Acentos, pontuação e LTDA/ME são ignorados na comparação.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="cad-cnpj" className="label">
          CNPJ <span className="font-normal text-ink-3">(opcional)</span>
        </label>
        <input id="cad-cnpj" className="input" value={d.cnpj} onChange={(e) => setD({ ...d, cnpj: e.target.value })} placeholder="00.000.000/0000-00" />
      </div>

      <ListaEmails id="cad-para" rotulo="Para" dica="quem recebe a fatura" emails={d.para} mudar={(para) => setD({ ...d, para })} pendente={paraIn} setPendente={setParaIn} tom="para" erro={setErro} />
      <ListaEmails id="cad-cc" rotulo="Cópia (Cc)" dica="contador, compras, diretoria…" emails={d.cc} mudar={(cc) => setD({ ...d, cc })} pendente={ccIn} setPendente={setCcIn} tom="cc" erro={setErro} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cad-contato" className="label">
            Contato
          </label>
          <input id="cad-contato" className="input" value={d.contato} onChange={(e) => setD({ ...d, contato: e.target.value })} placeholder="Ex.: João Pedro" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cad-telefone" className="label">
            Telefone
          </label>
          <input id="cad-telefone" className="input" inputMode="tel" value={d.telefone} onChange={(e) => setD({ ...d, telefone: e.target.value })} placeholder="(31) 98888-0000" />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="cad-prazo" className="label">
            Prazo de pagamento
          </label>
          <input id="cad-prazo" className="input" value={d.prazoPagamento} onChange={(e) => setD({ ...d, prazoPagamento: e.target.value })} placeholder="Ex.: 30 dias após emissão da fatura" />
        </div>
        <label className="flex items-start gap-2.5 text-[13px] sm:col-span-2">
          <input type="checkbox" checked={d.semBoleto} onChange={(e) => setD({ ...d, semBoleto: e.target.checked })} className="mt-0.5 h-[18px] w-[18px] accent-ink" />
          <span>
            <b>Paga sem boleto</b> (PIX, depósito, transferência…)
            <span className="block text-xs text-ink-3">No envio do mês, as faturas deste cliente vão só com a fatura, sem cobrar o boleto.</span>
          </span>
        </label>
      </div>

      <Faturamento d={d} setD={setD} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="cad-obs" className="label">
          Observações
        </label>
        <textarea
          id="cad-obs"
          rows={4}
          value={d.observacoes}
          onChange={(e) => setD({ ...d, observacoes: e.target.value })}
          placeholder="Ex.: falar com a Rita; sempre mandar com cópia para o contador"
          className="input resize-y py-2.5 text-[13px]"
        />
        <p className="text-xs text-ink-3">Aparece para o financeiro na conferência. Não vai no e-mail.</p>
      </div>

      {erro && (
        <div role="alert" className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">
          {erro}
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2.5 pt-2">
        {d.id && ehFinanceiro ? (
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={async () => {
              await definirAtivo(d.id!, !(d.ativo ?? true));
              avisar(d.ativo === false ? 'Cliente reativado.' : 'Cliente desativado. Ele some da busca automática, mas o histórico continua.');
              fechar();
            }}
          >
            {d.ativo === false ? 'Reativar cliente' : 'Desativar cliente'}
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2.5">
          <button type="button" className="btn-secondary" onClick={fechar}>
            Cancelar
          </button>
          <button type="button" className="btn-primary" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando…' : ehFinanceiro ? 'Salvar cliente' : 'Enviar para aprovação'}
          </button>
        </div>
      </div>
    </>
  );
}

function Faturamento({ d, setD }: { d: Rascunho; setD: (r: Rascunho) => void }) {
  const mudarFrota = (i: number, campo: 'numero' | 'valor' | 'descricao', v: string) =>
    setD({ ...d, frotas: d.frotas.map((f, k) => (k === i ? { ...f, [campo]: v } : f)) });
  const total = d.frotas.reduce((s, f) => s + (lerReais(f.valor) ?? 0), 0);

  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-line bg-[#F8F7F3] p-3.5">
      <legend className="sr-only">Faturamento</legend>
      <div className="label">Faturamento</div>

      <RegraCampos d={d} setD={setD} />

      <div className="flex flex-col gap-2">
        <div className="text-[13px] font-medium">Máquinas locadas</div>
        {d.frotas.map((_, i) => (
          <FrotaCartao key={i} i={i} d={d} setD={setD} mudarFrota={mudarFrota} />
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="btn-secondary btn-sm" onClick={() => setD({ ...d, frotas: [...d.frotas, { numero: '', valor: '', descricao: '' }] })}>
            <IcMais tamanho={14} /> Adicionar frota
          </button>
          {d.frotas.length > 0 && (
            <span className="text-[13px]">
              {d.frotas.length} frota{d.frotas.length > 1 ? 's' : ''} · total <b>{formatarReais(total)}</b>
            </span>
          )}
        </div>
      </div>
    </fieldset>
  );
}

/** "desde 20/10/2026 · contrato 12 meses · 1 vasilhame de gás · frete Lucminas" */
export function resumoLocacao(x?: Pick<Frota, 'inicio' | 'fim' | 'contrato' | 'gas' | 'frete' | 'freteValor'>): string {
  if (!x) return '';
  return [
    x.inicio ? `desde ${dataBr(x.inicio)}` : '',
    x.fim ? `até ${dataBr(x.fim)}` : '',
    x.contrato ? `contrato ${x.contrato}` : '',
    x.gas ? `${x.gas} vasilhame${x.gas > 1 ? 's' : ''} de gás` : '',
    x.frete === 'lucminas' ? 'frete Lucminas' : x.frete === 'cliente' ? `frete do cliente${x.freteValor ? ` (${formatarReais(x.freteValor)})` : ''}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function RegraCampos({ d, setD }: { d: Rascunho; setD: (r: Rascunho) => void }) {
  const regra = regraDoCliente({
    regra: d.regra,
    diaEmissao: Number(d.dia) || null,
    inicioLocacao: dataValida(d.inicio) ? d.inicio : null,
    periodoDias: Number(d.periodo) || null,
  });
  const proximas = regra ? proximasDatas(regra, 3) : [];
  const opcao = (valor: 'dia' | 'periodo', rotulo: string) => (
    <label className={`flex min-h-[44px] flex-1 cursor-pointer items-center gap-2 rounded-[10px] border px-3 text-[13px] ${d.regra === valor ? 'border-ink bg-white font-semibold' : 'border-line-strong bg-white/60'}`}>
      <input type="radio" name="regra" checked={d.regra === valor} onChange={() => setD({ ...d, regra: valor })} className="h-[18px] w-[18px] accent-ink" />
      {rotulo}
    </label>
  );
  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[13px] font-medium">Quando a fatura é emitida</div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Regra de faturamento">
        {opcao('dia', 'Dia fixo do mês')}
        {opcao('periodo', 'Por período da locação')}
      </div>

      {d.regra === 'dia' ? (
        <div className="flex items-center gap-2">
          <label htmlFor="cad-dia" className="text-ink-3">
            Todo dia
          </label>
          <input id="cad-dia" type="number" inputMode="numeric" min={1} max={31} value={d.dia} onChange={(e) => setD({ ...d, dia: e.target.value })} placeholder="—" className="input w-[84px] bg-white text-center" />
          <span className="text-ink-3">do mês</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cad-inicio" className="text-xs text-ink-3">
              Início da locação
            </label>
            <input id="cad-inicio" type="date" value={d.inicio} onChange={(e) => setD({ ...d, inicio: e.target.value })} className="input w-auto bg-white" />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="cad-periodo" className="text-ink-3">
              Fatura a cada
            </label>
            <input id="cad-periodo" type="number" inputMode="numeric" min={1} max={366} value={d.periodo} onChange={(e) => setD({ ...d, periodo: e.target.value })} placeholder="30" className="input w-[84px] bg-white text-center" />
            <span className="text-ink-3">dias</span>
          </div>
        </div>
      )}
      <p className="text-xs text-ink-3">
        {regra ? (
          <>
            {descreverRegra(regra)} · próximas: <b className="text-ink-2">{proximas.map(dataCurta).join(', ')}</b>
          </>
        ) : (
          'Preencha para o cliente aparecer no Calendário.'
        )}
      </p>
    </div>
  );
}

/** Uma máquina do cliente: mostra os dados da locação; "Editar" abre os campos; "Realizar movimentação" leva para Movimentações. */
function FrotaCartao({
  i,
  d,
  setD,
  mudarFrota,
}: {
  i: number;
  d: Rascunho;
  setD: (r: Rascunho) => void;
  mudarFrota: (i: number, campo: 'numero' | 'valor' | 'descricao', v: string) => void;
}) {
  const { pode } = useEstado();
  const navegar = useNavigate();
  const f = d.frotas[i];
  const ex = f.extra ?? {};
  // máquina nova (sem número ainda) já abre editando
  const [editando, setEditando] = useState(!f.numero);
  const mudarExtra = (x: Partial<NonNullable<Rascunho['frotas'][number]['extra']>>) =>
    setD({ ...d, frotas: d.frotas.map((y, k) => (k === i ? { ...y, extra: { ...y.extra, ...x } } : y)) });
  const nome = f.numero || String(i + 1);
  const rot = 'flex flex-col gap-1 text-xs font-semibold text-ink-2';
  const valor = lerReais(f.valor);
  const frete = ex.frete === 'lucminas' ? 'Lucminas' : ex.frete === 'cliente' ? `Cliente${f.freteTxt?.trim() ? ` · R$ ${f.freteTxt}` : ''}` : '';
  const item = (rotulo: string, v: string) => (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-ink-3">{rotulo}</dt>
      <dd className="truncate text-[13.5px]">{v || <span className="text-ink-3">—</span>}</dd>
    </div>
  );

  if (!editando)
    return (
      <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-white px-3.5 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <b className="font-mono text-[15px]">FT{f.numero}</b>
              {ex.modalidade && (
                <span className={`rounded-full px-1.5 py-px text-[10.5px] font-bold uppercase tracking-wide ${ex.modalidade === 'contrato' ? 'bg-info-soft text-info' : 'bg-[#EDE9FE] text-[#6D28D9]'}`}>
                  {ex.modalidade === 'contrato' ? 'Contrato' : 'Esporádico'}
                </span>
              )}
            </div>
            <div className="truncate text-[13px] text-ink-2">{f.descricao || 'Máquina sem descrição'}</div>
          </div>
          <div className="shrink-0 text-right">
            <b className="text-[15px]">{valor ? formatarReais(valor) : <span className="text-warn">sem valor</span>}</b>
            <div className="text-[11.5px] text-ink-3">por mês</div>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line-soft pt-2.5">
          {item('Período', ex.inicio || ex.fim ? `${ex.inicio ? dataBr(ex.inicio) : '—'} → ${ex.fim ? dataBr(ex.fim) : 'sem término'}` : '')}
          {item('Tempo de contrato', ex.contrato ?? '')}
          {item('Frete', frete)}
          {item('Gás', ex.gas ? `${ex.gas} vasilhame${ex.gas > 1 ? 's' : ''}` : '')}
        </dl>
        <div className="flex flex-wrap items-center gap-2">
          {d.id && pode('movimentacoes', 2) && (
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => navegar(`/movimentacoes?nova=troca&frota=${encodeURIComponent(f.numero)}&cliente=${d.id}`)}
            >
              Realizar movimentação
            </button>
          )}
          <button type="button" className="btn-secondary btn-sm" onClick={() => setEditando(true)}>
            Editar dados
          </button>
          <button
            type="button"
            aria-label={`Remover frota ${nome}`}
            onClick={() => setD({ ...d, frotas: d.frotas.filter((_, k) => k !== i) })}
            className="btn btn-sm ml-auto text-ink-3 hover:text-bad"
          >
            Tirar do cliente
          </button>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-ink/30 bg-white p-3">
              {/* identificação */}
              <div className="flex items-end gap-2">
                <label className={`${rot} w-[100px]`}>
                  Frota
                  <input aria-label={`Número da frota ${i + 1}`} value={f.numero} onChange={(e) => mudarFrota(i, 'numero', e.target.value)} placeholder="FT35" className="input font-mono text-[14px] font-semibold uppercase" />
                </label>
                <label className={`${rot} min-w-0 flex-1`}>
                  Máquina
                  <input aria-label={`Descrição da frota ${i + 1}`} value={f.descricao} onChange={(e) => mudarFrota(i, 'descricao', e.target.value)} placeholder="Ex.: YALE GLP050VX 2,5 t" className="input text-[14px] font-normal" />
                </label>
                <button
                  type="button"
                  aria-label={`Remover frota ${nome}`}
                  onClick={() => setD({ ...d, frotas: d.frotas.filter((_, k) => k !== i) })}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-bad-soft hover:text-bad"
                >
                  <IcFechar tamanho={14} />
                </button>
              </div>
              {/* locação */}
              <div className="grid grid-cols-2 gap-x-2 gap-y-3">
                <label className={rot}>
                  Valor por mês (R$)
                  <input
                    aria-label={`Valor da frota ${i + 1}`}
                    inputMode="decimal"
                    value={f.valor}
                    onChange={(e) => mudarFrota(i, 'valor', e.target.value)}
                    onBlur={() => {
                      const v = lerReais(f.valor);
                      if (v !== null) mudarFrota(i, 'valor', reaisParaCampo(v));
                    }}
                    placeholder="3.350,00"
                    className={`input text-right text-[14px] font-normal ${f.valor.trim() && lerReais(f.valor) === null ? 'border-bad' : ''}`}
                  />
                </label>
                <label className={rot}>
                  Gás (vasilhames)
                  <input
                    aria-label={`Vasilhames de gás da frota ${nome}`}
                    inputMode="numeric"
                    value={ex.gas ? String(ex.gas) : ''}
                    onChange={(e) => mudarExtra({ gas: Number(e.target.value.replace(/\D/g, '').slice(0, 2)) || 0 })}
                    placeholder="0"
                    className="input text-[14px] font-normal"
                  />
                </label>
                <fieldset className={`${rot} col-span-2 row-start-2`}>
                  <legend className="mb-1">Locação por</legend>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(
                      [
                        ['contrato', 'Contrato'],
                        ['esporadico', 'Esporádica'],
                      ] as const
                    ).map(([v, t]) => (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={ex.modalidade === v}
                        aria-label={`${t}, frota ${nome}`}
                        onClick={() => mudarExtra({ modalidade: ex.modalidade === v ? '' : v })}
                        className={`h-11 rounded-[10px] border text-[13.5px] ${ex.modalidade === v ? 'border-ink bg-ink font-semibold text-white' : 'border-line-strong bg-white text-[14px] font-normal text-ink-2'}`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <label className={rot}>
                  Início
                  <input type="date" aria-label={`Início da locação da frota ${nome}`} value={ex.inicio ?? ''} onChange={(e) => mudarExtra({ inicio: e.target.value || null })} className="input text-[14px] font-normal" />
                </label>
                <label className={rot}>
                  Término
                  <input type="date" aria-label={`Término da locação da frota ${nome}`} value={ex.fim ?? ''} onChange={(e) => mudarExtra({ fim: e.target.value || null })} className="input text-[14px] font-normal" />
                </label>
                <label className={`${rot} col-span-2`}>
                  Tempo de contrato
                  <input aria-label={`Tempo de contrato da frota ${nome}`} value={ex.contrato ?? ''} onChange={(e) => mudarExtra({ contrato: e.target.value })} placeholder="12 meses" className="input text-[14px] font-normal" />
                </label>
                <label className={`${rot} col-span-2`}>
                  Frete
                  <span className="flex gap-1.5">
                    <select aria-label={`Frete da frota ${nome}`} value={ex.frete ?? ''} onChange={(e) => mudarExtra({ frete: e.target.value as Frota['frete'] })} className="input min-w-0 flex-1 text-[14px] font-normal">
                      <option value="">—</option>
                      <option value="lucminas">Por conta da Lucminas</option>
                      <option value="cliente">Por conta do cliente</option>
                    </select>
                    {ex.frete === 'cliente' && (
                      <input
                        aria-label={`Valor do frete da frota ${nome}`}
                        inputMode="decimal"
                        value={f.freteTxt ?? ''}
                        onChange={(e) => setD({ ...d, frotas: d.frotas.map((y, k) => (k === i ? { ...y, freteTxt: e.target.value } : y)) })}
                        onBlur={() => {
                          const v = lerReais(f.freteTxt ?? '');
                          if (v !== null) setD({ ...d, frotas: d.frotas.map((y, k) => (k === i ? { ...y, freteTxt: reaisParaCampo(v) } : y)) });
                        }}
                        placeholder="R$"
                        className="input w-[110px] text-right text-[14px] font-normal"
                      />
                    )}
                  </span>
                </label>
              </div>
      <button type="button" className="btn-secondary btn-sm self-end" onClick={() => setEditando(false)} disabled={!f.numero}>
        Pronto
      </button>
    </div>
  );
}
