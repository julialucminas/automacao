import { useRef, useState } from 'react';
import { api } from '../api';
import { useEstado } from '../state';
import { lerQuadroGeral, type LeituraQuadro } from '../lib/quadroGeral';
import { dataBr } from '../lib/calendario';
import { Gaveta } from './ui';
import { IcUpload } from './Icones';

type Etapa =
  { tipo: 'escolher' } | { tipo: 'lendo' } | { tipo: 'previa'; r: LeituraQuadro; nome: string } | { tipo: 'enviando'; texto: string } | { tipo: 'pronto'; resumo: string[] };

/** Importa a planilha "Quadro Geral Manutenção": fichas dos equipamentos e histórico do Auvo. */
export function ImportarQuadro({ aberto, fechar, terminou }: { aberto: boolean; fechar: () => void; terminou: () => void }) {
  const { clientes, oficina, veValores, avisar } = useEstado();
  const [etapa, setEtapa] = useState<Etapa>({ tipo: 'escolher' });
  const [fichasSim, setFichasSim] = useState(true);
  const [histSim, setHistSim] = useState(true);
  const [erro, setErro] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const sair = () => {
    if (etapa.tipo === 'lendo' || etapa.tipo === 'enviando') return;
    setEtapa({ tipo: 'escolher' });
    setErro('');
    fechar();
  };

  const ler = async (f: File) => {
    setErro('');
    setEtapa({ tipo: 'lendo' });
    try {
      // deixa a tela mostrar "Lendo…" antes do trabalho pesado
      await new Promise((r) => setTimeout(r, 30));
      const r = await lerQuadroGeral(f, clientes, oficina);
      if (!r.fichas.length && !r.historico.length) throw new Error('Não achei as abas do Quadro Geral nesta planilha (Relação de frota, Programação, Histórico Auvo…).');
      setFichasSim(r.fichas.length > 0);
      setHistSim(r.historico.length > 0);
      setEtapa({ tipo: 'previa', r, nome: f.name });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível ler a planilha.');
      setEtapa({ tipo: 'escolher' });
    }
  };

  const importar = async (r: LeituraQuadro) => {
    const resumo: string[] = [];
    try {
      if (fichasSim && r.fichas.length) {
        setEtapa({ tipo: 'enviando', texto: `Gravando ${r.fichas.length} fichas…` });
        const x = await api.importarEquipamentos(r.fichas.map((f) => ({ frota: f.frota, dados: f.dados })));
        resumo.push(`Fichas: ${x.novos} novas, ${x.atualizados} atualizadas${x.iguais ? `, ${x.iguais} já estavam iguais` : ''}.`);
      }
      if (histSim && r.historico.length) {
        setEtapa({ tipo: 'enviando', texto: `Gravando ${r.historico.length.toLocaleString('pt-BR')} linhas do histórico do Auvo…` });
        const x = await api.importarHistorico(r.historico);
        resumo.push(`Histórico do Auvo: ${x.linhas.toLocaleString('pt-BR')} lançamentos (o que havia antes foi substituído, sem duplicar).`);
      }
      setEtapa({ tipo: 'pronto', resumo });
      avisar('Planilha importada. Tudo ficou no Registro.');
      terminou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível gravar.');
      setEtapa({ tipo: 'previa', r, nome: '' });
    }
  };

  return (
    <Gaveta aberto={aberto} fechar={sair} titulo="Importar o Quadro Geral Manutenção" largo>
      {etapa.tipo === 'escolher' && (
        <div className="flex flex-col gap-4">
          <p className="text-[14px] text-ink-2">
            Escolha a planilha de controle do Júnior (<b>.xlsx</b>). O sistema lê as abas <b>Relação de frota</b>, <b>Valor frota</b>, <b>Programação</b>, <b>Quadro preventiva</b>,{' '}
            <b>Contratos</b> e <b>Histórico Auvo</b>, mostra o que encontrou e só grava depois que você confirmar.
          </p>
          <ul className="list-disc pl-5 text-[13px] text-ink-2">
            <li>A planilha não é guardada: só os dados vão para o sistema.</li>
            <li>Campo vazio na planilha não apaga o que já está na ficha.</li>
            <li>Importar de novo atualiza as fichas e troca o histórico do Auvo, sem duplicar.</li>
            {!veValores && <li>Seu perfil não vê valores: valor de compra e de contrato ficam de fora. Peça para quem vê valores importar se quiser trazê-los.</li>}
          </ul>
          <input
            ref={input}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void ler(f);
            }}
          />
          <button type="button" className="btn-primary self-start" onClick={() => input.current?.click()}>
            <IcUpload tamanho={16} /> Escolher a planilha
          </button>
          {erro && <p className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">{erro}</p>}
        </div>
      )}

      {etapa.tipo === 'lendo' && (
        <p role="status" className="rounded-xl bg-brand-tint p-4 text-[14px]">
          Lendo a planilha… A aba do histórico do Auvo é grande; pode levar alguns segundos.
        </p>
      )}

      {etapa.tipo === 'previa' && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-start gap-2.5 rounded-xl border border-line p-3.5">
              <input type="checkbox" className="mt-1" checked={fichasSim} disabled={!etapa.r.fichas.length} onChange={(e) => setFichasSim(e.target.checked)} />
              <span>
                <b className="text-[22px] leading-none">{etapa.r.fichas.length}</b> fichas de equipamento
                <span className="block text-xs text-ink-3">marca, modelo, série, horímetro, técnico, contrato{veValores ? ', compra' : ''}</span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 rounded-xl border border-line p-3.5">
              <input type="checkbox" className="mt-1" checked={histSim} disabled={!etapa.r.historico.length} onChange={(e) => setHistSim(e.target.checked)} />
              <span>
                <b className="text-[22px] leading-none">{etapa.r.historico.length.toLocaleString('pt-BR')}</b> lançamentos do Auvo
                {etapa.r.historico.length > 0 && (
                  <span className="block text-xs text-ink-3">
                    de {dataBr(etapa.r.historico.reduce((m, h) => (h.data < m ? h.data : m), '9999'))} a {dataBr(etapa.r.historico.reduce((m, h) => (h.data > m ? h.data : m), ''))}{' '}
                    · {new Set(etapa.r.historico.map((h) => h.frota).filter(Boolean)).size} frotas
                  </span>
                )}
              </span>
            </label>
          </div>
          <div className="text-[13px] text-ink-2">
            <b>Abas lidas:</b> {etapa.r.abasLidas.join(' · ')}
            {etapa.r.avisos.map((a) => (
              <p key={a} className="text-warn">
                {a}
              </p>
            ))}
          </div>

          {etapa.r.divergencias.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-[15px] font-bold">Onde a planilha e o sistema não batem ({etapa.r.divergencias.length})</h3>
              <p className="text-[13px] text-ink-3">
                Só para conferir: a importação <b>não muda</b> o cliente de nenhuma frota. Se o sistema estiver errado, registre a movimentação; se a planilha estiver errada,
                corrija lá.
              </p>
              <div className="max-h-[280px] overflow-y-auto rounded-xl border border-line">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-[#F8F7F3] text-left text-xs text-ink-3">
                    <tr>
                      <th className="px-3 py-1.5">Frota</th>
                      <th className="px-3 py-1.5">Na planilha</th>
                      <th className="px-3 py-1.5">No sistema</th>
                    </tr>
                  </thead>
                  <tbody>
                    {etapa.r.divergencias.map((d) => (
                      <tr key={d.frota} className="border-t border-line-soft">
                        <td className="px-3 py-1.5 font-mono font-bold">FT{d.frota}</td>
                        <td className="px-3 py-1.5">{d.naPlanilha}</td>
                        <td className="px-3 py-1.5">{d.noSistema}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {erro && <p className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">{erro}</p>}
          <div className="flex flex-wrap justify-end gap-2.5">
            <button type="button" className="btn-secondary" onClick={() => setEtapa({ tipo: 'escolher' })}>
              Escolher outra
            </button>
            <button type="button" className="btn-primary" disabled={!fichasSim && !histSim} onClick={() => void importar(etapa.r)}>
              Importar
            </button>
          </div>
        </div>
      )}

      {etapa.tipo === 'enviando' && (
        <p role="status" className="rounded-xl bg-brand-tint p-4 text-[14px]">
          {etapa.texto}
        </p>
      )}

      {etapa.tipo === 'pronto' && (
        <div className="flex flex-col gap-3">
          <div role="status" className="rounded-xl bg-ok-soft p-4 text-[14px] text-ok">
            <b>Importação concluída.</b>
            {etapa.resumo.map((t) => (
              <p key={t}>{t}</p>
            ))}
          </div>
          <button type="button" className="btn-primary self-end" onClick={sair}>
            Fechar
          </button>
        </div>
      )}
    </Gaveta>
  );
}
