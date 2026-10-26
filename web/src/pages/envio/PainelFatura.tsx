import type { Cliente, Envio, ItemLote } from '../../types';
import { chaveItem, useEstado } from '../../state';
import { STATUS_ITEM, statusDoItem } from '../../lib/pareamento';
import { dataHora, montarEmail, REMETENTE } from '../../lib/email';
import { Chip } from '../../components/ui';
import { IcClipe, IcExterno } from '../../components/Icones';
import { VincularCliente } from './VincularCliente';

export function abrirPdf(blob: Blob) {
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function PainelFatura({
  item,
  referencia,
  pediuLeitura,
  setPediuLeitura,
  envioAnterior,
  cadastrarNovo,
}: {
  item: ItemLote | null;
  referencia: string;
  pediuLeitura: boolean;
  setPediuLeitura: (v: boolean) => void;
  envioAnterior: Envio | undefined;
  cadastrarNovo: (item: ItemLote) => void;
}) {
  const { clientes, atualizarItem } = useEstado();

  if (!item) {
    return (
      <aside aria-label="Prévia do e-mail" className="card flex-[1_1_380px] p-5 text-ink-3">
        Selecione uma fatura na lista para ver o e-mail.
      </aside>
    );
  }

  const st = statusDoItem(item);
  const meta = STATUS_ITEM[st];
  const cliente: Cliente | undefined = clientes.find((c) => c.id === item.clienteId);
  const email = cliente && item.fatura ? montarEmail(item, cliente, referencia) : null;
  const anexos = [item.fatura, item.boleto].filter((a): a is NonNullable<typeof a> => !!a);

  return (
    <aside aria-label="Prévia do e-mail" className="card flex min-w-0 flex-[1_1_380px] flex-col gap-4 p-5 lg:sticky lg:top-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{item.fatura ? `Fatura ${item.numero}` : `Boleto ${item.numero}`}</h2>
        <Chip tom={meta.tom}>{meta.rotulo}</Chip>
      </div>

      {envioAnterior && (
        <div className="rounded-[10px] bg-info-soft px-3.5 py-3 text-[13px] text-info">
          Esta fatura já foi enviada em <b>{dataHora(envioAnterior.enviadoEm)}</b> para {envioAnterior.clienteNome}. Ela ficou desmarcada para não sair em dobro. Marque se quiser enviar de novo.
        </div>
      )}

      {st === 'sem_boleto' && (
        <div className="rounded-[10px] bg-warn-soft px-3.5 py-3 text-[13px] text-warn-strong">
          Não encontrei o arquivo <b className="font-mono">BOLETO {item.numero}.PDF</b> na pasta. Confira se o boleto foi gerado e salvo com esse nome. Esta fatura fica fora do envio até o boleto aparecer.
        </div>
      )}
      {st === 'boleto_sem_fatura' && (
        <div className="rounded-[10px] bg-bad-soft px-3.5 py-3 text-[13px] text-bad-strong">
          O arquivo <b className="font-mono">{item.boleto?.nome}</b> não tem uma fatura com o mesmo número na pasta. Pode ser erro de digitação no nome ou uma fatura que faltou salvar.
        </div>
      )}
      {st === 'numero_duplicado' && (
        <div className="rounded-[10px] bg-bad-soft px-3.5 py-3 text-[13px] text-bad-strong">
          Existe mais de um arquivo com o número <b>{item.numero}</b>. Corrija os nomes na pasta e carregue de novo, para não mandar o boleto errado.
        </div>
      )}
      {st === 'sem_cadastro' && <VincularCliente key={chaveItem(item)} item={item} cadastrarNovo={cadastrarNovo} />}

      {email && cliente && (
        <>
          <div className="overflow-hidden rounded-[10px] border border-line">
            <dl className="flex flex-col gap-2 border-b border-line bg-[#F8F9FB] px-3.5 py-3 text-[13px]">
              <div className="flex gap-2">
                <dt className="w-[52px] shrink-0 text-ink-3">De</dt>
                <dd>{REMETENTE}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-[52px] shrink-0 pt-0.5 text-ink-3">Para</dt>
                <dd className="flex flex-wrap gap-1">
                  {cliente.para.map((e) => (
                    <span key={e} className="rounded-md bg-brand-soft px-2 py-0.5 text-[12.5px] text-brand-text">
                      {e}
                    </span>
                  ))}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-[52px] shrink-0 pt-0.5 text-ink-3">Cópia</dt>
                <dd className="flex flex-wrap gap-1">
                  {cliente.cc.length ? (
                    cliente.cc.map((e) => (
                      <span key={e} className="rounded-md bg-line-soft px-2 py-0.5 text-[12.5px] text-ink-2">
                        {e}
                      </span>
                    ))
                  ) : (
                    <span className="text-[12.5px] text-ink-3">(ninguém em cópia)</span>
                  )}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-[52px] shrink-0 text-ink-3">Assunto</dt>
                <dd className="font-semibold">{email.assunto}</dd>
              </div>
            </dl>
            <div className="whitespace-pre-line px-3.5 py-3.5 text-[13.5px]">{email.corpo}</div>
            <div className="flex flex-wrap gap-2 border-t border-line px-3.5 py-2.5">
              {anexos.map((a) => (
                <button
                  key={a.caminho}
                  type="button"
                  onClick={() => abrirPdf(a.blob)}
                  title="Abrir o PDF"
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-line px-2.5 font-mono text-[11.5px] hover:bg-canvas"
                >
                  <IcClipe tamanho={13} /> {a.nome} <IcExterno tamanho={12} className="text-ink-3" />
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 text-[13px]">
            <label className="flex items-center gap-2 text-ink-2">
              <input type="checkbox" checked disabled className="h-[18px] w-[18px]" />
              Salvar cópia na pasta Enviados (sempre)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={pediuLeitura} onChange={(e) => setPediuLeitura(e.target.checked)} className="h-[18px] w-[18px] accent-brand" />
              Pedir confirmação de leitura (vale para todo o lote)
            </label>
          </div>
        </>
      )}

      {cliente?.observacoes && (
        <div className="rounded-[10px] border border-line bg-canvas px-3.5 py-3 text-[13px]">
          <div className="mb-1 text-xs font-semibold text-ink-3">Observação do cadastro do cliente</div>
          {cliente.observacoes}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="obs-fatura" className="text-xs font-semibold text-ink-3">
          Observação desta fatura (interna, não vai no e-mail)
        </label>
        <textarea
          id="obs-fatura"
          rows={3}
          value={item.observacao}
          onChange={(e) => atualizarItem(chaveItem(item), (i) => ({ ...i, observacao: e.target.value }))}
          placeholder="Ex.: cliente pediu para mandar só depois do dia 5"
          className="input resize-y py-2.5 text-[13px]"
        />
      </div>
    </aside>
  );
}
