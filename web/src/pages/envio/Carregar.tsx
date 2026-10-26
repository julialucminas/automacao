import { useRef, useState, type DragEvent } from 'react';
import { useEstado } from '../../state';
import { lerArquivos, lerSoltura, origemDosArquivos, type ResultadoLeitura } from '../../lib/leitura';
import { parear } from '../../lib/pareamento';
import { referenciaAtual } from '../../lib/email';
import { arquivosDeExemplo } from '../../lib/exemplo';
import { IcPasta, IcUpload } from '../../components/Icones';

export function Carregar() {
  const { clientes, envios, definirLote, avisar } = useEstado();
  const [referencia, setReferencia] = useState(referenciaAtual());
  const [arrastando, setArrastando] = useState(false);
  const [lendo, setLendo] = useState(false);
  const [ignorados, setIgnorados] = useState<string[]>([]);
  const inputPasta = useRef<HTMLInputElement>(null);
  const inputArquivos = useRef<HTMLInputElement>(null);

  const montar = (r: ResultadoLeitura, origem: string) => {
    if (r.arquivos.length === 0) {
      setIgnorados(r.ignorados);
      avisar('Nenhum PDF encontrado nessa seleção.', 'bad');
      return;
    }
    const { itens, naoReconhecidos } = parear(r.arquivos, clientes);
    // proteção contra envio em dobro: o que já foi enviado nesta referência vem desmarcado
    const jaEnviados = new Set(envios.filter((e) => e.referencia === referencia && e.status !== 'falhou').map((e) => e.numero));
    for (const i of itens) if (jaEnviados.has(i.numero)) i.marcado = false;
    definirLote({ id: String(Date.now()), referencia, origem, criadoEm: new Date().toISOString(), itens, naoReconhecidos });
  };

  const processar = async (ler: () => Promise<ResultadoLeitura>) => {
    setLendo(true);
    setIgnorados([]);
    try {
      const r = await ler();
      montar(r, origemDosArquivos(r));
    } catch {
      avisar('Não foi possível ler os arquivos.', 'bad');
    } finally {
      setLendo(false);
    }
  };

  const soltar = (e: DragEvent) => {
    e.preventDefault();
    setArrastando(false);
    const dt = e.dataTransfer;
    processar(() => lerSoltura(dt));
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Envio do mês</div>
          <h1 className="mt-1 text-[26px] font-bold">Novo lote de faturas</h1>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="referencia" className="label">
            Mês de referência
          </label>
          <input id="referencia" type="month" className="input w-auto" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
        </div>
      </div>

      <section
        aria-label="Carregar arquivos"
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={soltar}
        className={`flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
          arrastando ? 'border-brand bg-brand-tint' : 'border-line-strong bg-white'
        }`}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-[14px] bg-noite text-brand">
          <IcUpload tamanho={26} />
        </div>
        <h2 className="text-[22px] font-bold">{lendo ? 'Lendo arquivos…' : 'Arraste aqui a pasta do mês ou o arquivo .zip'}</h2>
        <p className="max-w-[520px] text-ink-3">
          O sistema lê todos os PDFs, junta cada fatura com o seu boleto e encontra os e-mails do cliente no cadastro. Nada é enviado antes de você conferir.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" className="btn-primary" disabled={lendo} onClick={() => inputPasta.current?.click()}>
            <IcPasta /> Selecionar pasta
          </button>
          <button type="button" className="btn-secondary" disabled={lendo} onClick={() => inputArquivos.current?.click()}>
            Selecionar .zip ou PDFs
          </button>
        </div>
        <input
          ref={inputPasta}
          type="file"
          className="hidden"
          // @ts-expect-error atributo não padronizado, suportado por Chrome, Edge e Firefox
          webkitdirectory=""
          multiple
          onChange={(e) => e.target.files && processar(() => lerArquivos(e.target.files!))}
        />
        <input
          ref={inputArquivos}
          type="file"
          className="hidden"
          accept=".zip,.pdf,application/zip,application/pdf"
          multiple
          onChange={(e) => e.target.files && processar(() => lerArquivos(e.target.files!))}
        />
        <div className="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-ink-3">
          <span>
            Fatura: <code className="font-mono text-ink">1234 NOME DA EMPRESA.PDF</code>
          </span>
          <span>
            Boleto: <code className="font-mono text-ink">BOLETO 1234.PDF</code>
          </span>
        </div>
      </section>

      {ignorados.length > 0 && (
        <div className="card p-4 text-[13px]">
          <div className="font-semibold">Arquivos ignorados (não são PDF):</div>
          <ul className="mt-1 list-inside list-disc font-mono text-xs text-ink-2">
            {ignorados.slice(0, 20).map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn-line bg-warn-soft px-4 py-3 text-[13px] text-warn-strong">
        <span>Demonstração: carregue um lote fictício que mostra todos os casos da conferência.</span>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => {
            const arquivos = arquivosDeExemplo();
            montar({ arquivos, ignorados: [] }, 'FATURAS EXEMPLO');
          }}
        >
          Usar arquivos de exemplo
        </button>
      </div>
    </div>
  );
}
