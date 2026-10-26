import { useState } from 'react';
import type { Cliente, ClienteInput } from '../types';
import { emailValido } from '../lib/normalizar';
import { useEstado } from '../state';
import { IcFechar } from './Icones';
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
};

export const rascunhoVazio = (nome = ''): Rascunho => ({ nome, apelidos: '', cnpj: '', para: [], cc: [], observacoes: '' });

export const rascunhoDe = (c: Cliente): Rascunho => ({
  id: c.id,
  nome: c.nome,
  apelidos: c.apelidos.join(', '),
  cnpj: c.cnpj,
  para: [...c.para],
  cc: [...c.cc],
  observacoes: c.observacoes,
  ativo: c.ativo,
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
  return (
    <Gaveta aberto={!!inicial} fechar={fechar} titulo={inicial?.id ? 'Editar cliente' : 'Novo cliente'}>
      {inicial && <Formulario key={inicial.id ?? 'novo'} inicial={inicial} fechar={fechar} aoSalvar={aoSalvar} />}
    </Gaveta>
  );
}

function Formulario({ inicial, fechar, aoSalvar }: { inicial: Rascunho; fechar: () => void; aoSalvar?: (c: Cliente) => void }) {
  const { salvarCliente, definirAtivo, clientes, avisar } = useEstado();
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
    if (!para.length) return setErro('Adicione pelo menos um e-mail em Para.');
    const repetido = clientes.find((c) => c.id !== d.id && c.nome === nome);
    if (repetido) return setErro(`Já existe um cliente chamado ${nome}.`);

    const input: ClienteInput = {
      id: d.id,
      nome,
      apelidos: d.apelidos.split(',').map((a) => a.trim().toUpperCase()).filter(Boolean),
      cnpj: d.cnpj.trim(),
      para,
      cc: cc.filter((e) => !para.includes(e)),
      observacoes: d.observacoes.trim(),
    };
    setSalvando(true);
    try {
      const salvo = await salvarCliente(input);
      avisar(`Cliente ${salvo.nome} salvo.`);
      aoSalvar?.(salvo);
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
        {d.id ? (
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
            {salvando ? 'Salvando…' : 'Salvar cliente'}
          </button>
        </div>
      </div>
    </>
  );
}
