import { useEffect, useState } from 'react';
import { useEstado } from '../state';
import type { ConfigEmail } from '../types';
import { MODELO_PADRAO, preencher, REMETENTE, referenciaAtual, referenciaPorExtenso, VARIAVEIS } from '../lib/email';

export function Configuracoes() {
  const { config, salvarConfig, avisar, ehFinanceiro, clientes } = useEstado();
  const [c, setC] = useState<ConfigEmail>(config ?? MODELO_PADRAO);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    if (config) setC(config);
  }, [config]);

  const exemplo = clientes.find((x) => x.ativo && x.frotas.length) ?? clientes[0];
  const v = {
    numero: '1234',
    cliente: exemplo?.nome ?? 'EMPRESA EXEMPLO',
    mes: referenciaPorExtenso(referenciaAtual()),
    frotas: exemplo?.frotas.map((f) => f.numero).join(', ') || '35',
  };
  const mudou = !config || (Object.keys(c) as (keyof ConfigEmail)[]).some((k) => c[k] !== config[k]);

  const salvar = async () => {
    setSalvando(true);
    try {
      await salvarConfig(c);
      avisar('Modelo do e-mail salvo. Os próximos envios já usam esse texto.');
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível salvar.', 'bad');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">Configurações</h1>
        <p className="text-[13px] text-ink-3">Texto do e-mail que vai junto com a fatura e o boleto.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-4 rounded-xl border border-line bg-white p-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cfg-rem" className="label">
              Nome de quem envia
            </label>
            <input id="cfg-rem" className="input" disabled={!ehFinanceiro} value={c['email.remetente']} onChange={(e) => setC({ ...c, 'email.remetente': e.target.value })} />
            <p className="text-xs text-ink-3">
              O endereço é sempre <b>{REMETENTE}</b>; aqui muda só o nome que o cliente vê.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cfg-assunto" className="label">
              Assunto
            </label>
            <input id="cfg-assunto" className="input" disabled={!ehFinanceiro} value={c['email.assunto']} onChange={(e) => setC({ ...c, 'email.assunto': e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cfg-corpo" className="label">
              Texto do e-mail
            </label>
            <textarea id="cfg-corpo" rows={11} disabled={!ehFinanceiro} className="input resize-y py-2.5 text-[13.5px] leading-relaxed" value={c['email.corpo']} onChange={(e) => setC({ ...c, 'email.corpo': e.target.value })} />
          </div>
          <div className="rounded-[10px] bg-[#F8F7F3] p-3 text-[13px]">
            <div className="mb-1 font-semibold">Campos que o sistema preenche sozinho</div>
            <ul className="flex flex-col gap-0.5">
              {VARIAVEIS.map((x) => (
                <li key={x.nome}>
                  <code className="rounded bg-white px-1.5 py-0.5 font-semibold">{x.nome}</code> <span className="text-ink-3">{x.descricao}</span>
                </li>
              ))}
            </ul>
          </div>
          {ehFinanceiro ? (
            <div className="flex flex-wrap justify-between gap-2">
              <button type="button" className="btn-secondary" onClick={() => setC(MODELO_PADRAO)}>
                Voltar ao texto padrão
              </button>
              <button type="button" className="btn-primary" disabled={!mudou || salvando} onClick={salvar}>
                {salvando ? 'Salvando…' : 'Salvar modelo'}
              </button>
            </div>
          ) : (
            <p className="text-xs text-ink-3">Só o financeiro altera o modelo do e-mail.</p>
          )}
        </section>

        <section className="flex flex-col gap-2 self-start">
          <div className="text-[13px] font-semibold text-ink-2">Como o cliente vai receber (exemplo)</div>
          <div className="overflow-hidden rounded-xl border border-line bg-white">
            <dl className="flex flex-col gap-1.5 border-b border-line bg-[#F8F9FB] px-4 py-3 text-[13px]">
              <div className="flex gap-2">
                <dt className="w-[60px] shrink-0 text-ink-3">De</dt>
                <dd>
                  {c['email.remetente']} &lt;{REMETENTE}&gt;
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-[60px] shrink-0 text-ink-3">Para</dt>
                <dd>{exemplo?.para[0] ?? 'financeiro@cliente.com.br'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-[60px] shrink-0 text-ink-3">Assunto</dt>
                <dd className="font-semibold">{preencher(c['email.assunto'], v)}</dd>
              </div>
            </dl>
            <div className="whitespace-pre-wrap px-4 py-4 text-[14px] leading-relaxed">{preencher(c['email.corpo'], v)}</div>
            <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3 text-xs text-ink-2">
              <span className="rounded-md bg-line-soft px-2 py-1">📎 1234 {v.cliente}.PDF</span>
              <span className="rounded-md bg-line-soft px-2 py-1">📎 BOLETO 1234.PDF</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
