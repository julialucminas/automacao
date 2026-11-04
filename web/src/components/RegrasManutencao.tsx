import { useEffect, useState } from 'react';
import { useEstado } from '../state';
import type { RegraPeriferico, TipoVisita } from '../types';
import { PERIFERICOS_PADRAO, TIPOS_PADRAO, regrasDe } from '../lib/manutencao';
import { IcMais } from './Icones';

type Unidade = 'dias' | 'horas' | '';
const unidadeDe = (x: { dias?: number; horas?: number }): Unidade => (x.horas ? 'horas' : x.dias ? 'dias' : '');
const comIntervalo = <T extends { dias?: number; horas?: number }>(x: T, n: string, u: Unidade): T => {
  const { dias: _d, horas: _h, ...resto } = x;
  void _d;
  void _h;
  const v = Number(n);
  return (u && v > 0 ? { ...resto, [u]: Math.round(v) } : resto) as T;
};

/** Configurações → Manutenção: tipos de visita (CF, CR, B, C, D) e de quanto em quanto troca cada periférico. */
export function RegrasManutencao() {
  const { config, salvarConfig, avisar, pode } = useEstado();
  const edita = pode('configuracoes', 2);
  const atual = regrasDe(config);
  const [tipos, setTipos] = useState<TipoVisita[]>(atual.tipos);
  const [perifericos, setPerifericos] = useState<RegraPeriferico[]>(atual.perifericos);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    const r = regrasDe(config);
    setTipos(r.tipos);
    setPerifericos(r.perifericos);
  }, [config]);
  const mudou = JSON.stringify(tipos) !== JSON.stringify(atual.tipos) || JSON.stringify(perifericos) !== JSON.stringify(atual.perifericos);

  const salvar = async () => {
    setSalvando(true);
    try {
      await salvarConfig({ 'manutencao.tipos': JSON.stringify(tipos), 'manutencao.perifericos': JSON.stringify(perifericos) });
      avisar('Regras da manutenção salvas. O painel já usa os novos intervalos.');
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível salvar.', 'bad');
    } finally {
      setSalvando(false);
    }
  };

  // função (não componente) para o campo não perder o foco a cada tecla
  const intervalo = ({ x, mudar, rotulo }: { x: { dias?: number; horas?: number }; mudar: (n: string, u: Unidade) => void; rotulo: string }) => {
    const u = unidadeDe(x);
    return (
      <span className="flex items-center gap-1.5">
        <span className="text-[13px] text-ink-3">a cada</span>
        <input
          aria-label={`${rotulo}: intervalo`}
          className="input h-9 w-[84px] text-right"
          inputMode="numeric"
          disabled={!edita || !u}
          value={u ? String(x[u] ?? '') : ''}
          onChange={(e) => mudar(e.target.value.replace(/\D/g, ''), u)}
        />
        <select
          aria-label={`${rotulo}: unidade`}
          className="input h-9 w-auto"
          disabled={!edita}
          value={u}
          onChange={(e) => mudar(String(x.dias ?? x.horas ?? (e.target.value === 'horas' ? 500 : 30)), e.target.value as Unidade)}
        >
          <option value="dias">dias</option>
          <option value="horas">horas</option>
          <option value="">sem prazo</option>
        </select>
      </span>
    );
  };

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-line bg-white p-5">
      <div>
        <h2 className="text-lg font-bold">Manutenção</h2>
        <p className="text-[13px] text-ink-3">Usado pelo Painel de manutenção para dizer o que está em dia, o que vence esta semana e o que está atrasado.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-3">Tipos de visita</h3>
          <ul className="flex flex-col gap-2">
            {tipos.map((t, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <input
                  aria-label="Sigla"
                  className="input h-9 w-[64px] text-center font-bold uppercase"
                  disabled={!edita}
                  value={t.sigla}
                  onChange={(e) => setTipos(tipos.map((x, j) => (j === i ? { ...x, sigla: e.target.value.toUpperCase() } : x)))}
                />
                <input
                  aria-label="Nome"
                  className="input h-9 min-w-[150px] flex-1"
                  disabled={!edita}
                  value={t.nome}
                  onChange={(e) => setTipos(tipos.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))}
                />
                {intervalo({ x: t, rotulo: t.sigla, mudar: (n, u) => setTipos(tipos.map((x, j) => (j === i ? comIntervalo(x, n, u) : x))) })}
                {edita && tipos.length > 1 && (
                  <button type="button" className="btn btn-sm text-ink-3 underline" onClick={() => setTipos(tipos.filter((_, j) => j !== i))}>
                    tirar
                  </button>
                )}
              </li>
            ))}
          </ul>
          {edita && (
            <button type="button" className="btn-secondary btn-sm self-start" onClick={() => setTipos([...tipos, { sigla: '', nome: '', horas: 500 }])}>
              <IcMais tamanho={14} /> Tipo de visita
            </button>
          )}
          <p className="text-xs text-ink-3">
            Visita por dias (ex.: CF) diz quando a máquina precisa ser vista de novo. Por horas (B, C, D) calcula a próxima preventiva quando a visita é registrada.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-3">Periféricos</h3>
          <ul className="flex flex-col gap-2">
            {perifericos.map((p, i) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <input
                  aria-label="Periférico"
                  className="input h-9 min-w-[150px] flex-1"
                  disabled={!edita}
                  value={p.nome}
                  onChange={(e) => setPerifericos(perifericos.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))}
                />
                {intervalo({ x: p, rotulo: p.nome, mudar: (n, u) => setPerifericos(perifericos.map((x, j) => (j === i ? comIntervalo(x, n, u || 'dias') : x))) })}
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-3">Vale para as próximas trocas registradas. O que veio da planilha mantém a data que já estava lá.</p>
        </div>
      </div>
      <label className="flex items-start gap-2.5 rounded-[10px] bg-[#F8F7F3] p-3 text-[14px]">
        <input
          type="checkbox"
          className="mt-1"
          disabled={!edita}
          checked={config?.['os.relatorioCliente'] === 'sim'}
          onChange={async (e) => {
            try {
              await salvarConfig({ 'os.relatorioCliente': e.target.checked ? 'sim' : 'nao' });
              avisar(e.target.checked ? 'O relatório da OS passa a poder ir ao cliente ao encerrar.' : 'O relatório da OS não vai mais para o cliente.');
            } catch (err) {
              avisar(err instanceof Error ? err.message : 'Não foi possível salvar.', 'bad');
            }
          }}
        />
        <span>
          <b>Mandar o relatório da OS para o cliente</b>
          <span className="block text-xs text-ink-3">
            Desligado: o relatório em PDF fica só para baixar no sistema. Ligado: ao encerrar a OS, dá para mandar por e-mail ao cliente.
          </span>
        </span>
      </label>
      {edita ? (
        <div className="flex flex-wrap justify-between gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setTipos(TIPOS_PADRAO);
              setPerifericos(PERIFERICOS_PADRAO);
            }}
          >
            Voltar ao padrão
          </button>
          <button type="button" className="btn-primary" disabled={!mudou || salvando} onClick={() => void salvar()}>
            {salvando ? 'Salvando…' : 'Salvar regras'}
          </button>
        </div>
      ) : (
        <p className="text-xs text-ink-3">Seu perfil só vê as regras.</p>
      )}
    </section>
  );
}
