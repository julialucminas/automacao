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
  /** frotas com o valor como texto do campo, para permitir digitar à vontade; extra = dados da locação (vêm das movimentações) */
  frotas: { numero: string; valor: string; descricao: string; extra?: Pick<Frota, 'inicio' | 'contrato' | 'gas' | 'frete'> }[];
};

export const rascunhoVazio = (nome = ''): Rascunho => ({ nome, apelidos: '', cnpj: '', para: [], cc: [], observacoes: '', regra: 'dia', dia: '', inicio: '', periodo: '', contato: '', telefone: '', prazoPagamento: '', frotas: [] });

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
  frotas: c.frotas.map((f) => ({
    numero: f.numero,
    valor: f.valor ? reaisParaCampo(f.valor) : '',
    descricao: f.descricao,
    extra: { inicio: f.inicio ?? null, contrato: f.contrato ?? '', gas: f.gas ?? 0, frete: f.frete ?? '' },
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
  const ehFin = useEstado().ehFinanceiro;
  return (
    <Gaveta aberto={!!inicial} fechar={fechar} titulo={inicial?.id ? 'Editar cliente' : 'Novo cliente'}>
      {inicial && !ehFin && (
        <p className="rounded-[10px] bg-brand-soft px-3 py-2.5 text-[13px]">
          As alterações vão para a <b>Angelise aprovar</b> antes de entrar no cadastro.
        </p>
      )}
      {inicial && <Formulario key={inicial.id ?? 'novo'} inicial={inicial} fechar={fechar} aoSalvar={aoSalvar} />}
    </Gaveta>
  );
}

function Formulario({ inicial, fechar, aoSalvar }: { inicial: Rascunho; fechar: () => void; aoSalvar?: (c: Cliente) => void }) {
  const { salvarCliente, proporCliente, ehFinanceiro, definirAtivo, clientes, avisar } = useEstado();
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
      frotas.push({ numero, valor, descricao: f.descricao.trim(), ...(f.extra ?? {}) });
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
        <div className="text-[13px] font-medium">Frotas de referência</div>
        {d.frotas.length > 0 && (
          <div className="hidden grid-cols-[110px_120px_1fr_44px] gap-2 text-xs text-ink-3 sm:grid">
            <span>Nº da frota</span>
            <span>Valor (R$)</span>
            <span>Descrição (opcional)</span>
            <span />
          </div>
        )}
        {d.frotas.map((f, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_44px] gap-2 sm:grid-cols-[110px_120px_1fr_44px]">
            <input aria-label={`Número da frota ${i + 1}`} value={f.numero} onChange={(e) => mudarFrota(i, 'numero', e.target.value)} placeholder="F-101" className="input bg-white uppercase" />
            <input
              aria-label={`Valor da frota ${i + 1}`}
              inputMode="decimal"
              value={f.valor}
              onChange={(e) => mudarFrota(i, 'valor', e.target.value)}
              onBlur={() => {
                const v = lerReais(f.valor);
                if (v !== null) mudarFrota(i, 'valor', reaisParaCampo(v));
              }}
              placeholder="1.500,00"
              className={`input bg-white text-right ${f.valor.trim() && lerReais(f.valor) === null ? 'border-bad' : ''}`}
            />
            <input
              aria-label={`Descrição da frota ${i + 1}`}
              value={f.descricao}
              onChange={(e) => mudarFrota(i, 'descricao', e.target.value)}
              placeholder="Ex.: Empilhadeira 2,5t"
              className="input col-span-2 bg-white sm:col-span-1"
            />
            <button
              type="button"
              aria-label={`Remover frota ${f.numero || i + 1}`}
              onClick={() => setD({ ...d, frotas: d.frotas.filter((_, k) => k !== i) })}
              className="col-start-3 row-start-1 flex h-11 w-11 items-center justify-center rounded-lg text-ink-3 hover:bg-white hover:text-bad sm:col-start-4"
            >
              <IcFechar tamanho={14} />
            </button>
            {resumoLocacao(f.extra) && <p className="col-span-3 -mt-1 text-xs text-ink-3 sm:col-span-4">{resumoLocacao(f.extra)}</p>}
          </div>
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
export function resumoLocacao(x?: Pick<Frota, 'inicio' | 'contrato' | 'gas' | 'frete'>): string {
  if (!x) return '';
  return [
    x.inicio ? `desde ${dataBr(x.inicio)}` : '',
    x.contrato ? `contrato ${x.contrato}` : '',
    x.gas ? `${x.gas} vasilhame${x.gas > 1 ? 's' : ''} de gás` : '',
    x.frete === 'lucminas' ? 'frete Lucminas' : x.frete === 'cliente' ? 'frete do cliente' : '',
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
