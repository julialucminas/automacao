import { useState } from 'react';
import { api } from '../api';
import { useEstado } from '../state';
import type { Cliente, EnvioContrato, IntegracaoAutentique } from '../types';
import { dataHora } from '../lib/email';
import { copiarTexto } from '../lib/movimentacao';
import { lerBase64 } from './NfeAnexo';
import { Modal } from './ui';

const ehDaLucminas = (papel: string) => papel === 'Lucminas' || papel === 'Testemunha da Lucminas';

/** Mandar o PDF do contrato para assinar na Autentique: cliente, Lucminas e uma testemunha de cada lado. */
export function EnviarParaAssinar({ cliente, frotas, cfg, fechar, enviado }: { cliente: Cliente; frotas: string[]; cfg: IntegracaoAutentique; fechar: () => void; enviado: () => void }) {
  const { avisar } = useEstado();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [rep, setRep] = useState({ nome: cliente.contato ?? '', email: cliente.para[0] ?? '' });
  const [tCli, setTCli] = useState({ nome: '', email: '' });
  const [tLuc, setTLuc] = useState({ nome: cfg.testemunhaNome, email: cfg.testemunhaEmail });
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    setErro('');
    if (!arquivo) return setErro('Escolha o PDF do contrato.');
    if (!/\.pdf$/i.test(arquivo.name)) return setErro('O contrato precisa ser PDF.');
    if (arquivo.size > 5 * 1024 * 1024) return setErro('O PDF passa de 5 MB (limite do plano grátis da Autentique).');
    setEnviando(true);
    try {
      await api.mandarParaAssinar({ clienteId: cliente.id, frotas, arquivo: await lerBase64(arquivo), nome: arquivo.name, cliente: rep, testemunhaCliente: tCli, testemunhaLucminas: tLuc, mensagem: mensagem.trim() });
      avisar(cfg.teste ? 'Contrato mandado para assinar (modo de teste).' : 'Contrato mandado para assinar. A Autentique já mandou o e-mail para cada um.');
      enviado();
      fechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível mandar.');
    } finally {
      setEnviando(false);
    }
  };
  const pessoa = (rot: string, v: { nome: string; email: string }, mudar: (v: { nome: string; email: string }) => void) => (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="label mb-1">{rot}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="input" aria-label={`${rot}: nome`} placeholder="Nome" value={v.nome} onChange={(e) => mudar({ ...v, nome: e.target.value })} />
        <input className="input" type="email" aria-label={`${rot}: e-mail`} placeholder="E-mail" value={v.email} onChange={(e) => mudar({ ...v, email: e.target.value })} />
      </div>
    </fieldset>
  );

  return (
    <Modal aberto fechar={fechar} titulo="Enviar para assinatura">
      <p className="text-[14px]">
        <b>{cliente.nome}</b> · FT{frotas.join(', FT')}
      </p>
      {cfg.teste && <p className="rounded-[10px] bg-warn-soft px-3 py-2 text-[12.5px] text-warn-strong">Modo de teste ligado: o contrato vai como teste da Autentique (não vale como assinatura de verdade).</p>}
      <label className="flex flex-col gap-1.5">
        <span className="label">PDF do contrato</span>
        <input type="file" accept=".pdf,application/pdf" className="text-[13px]" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
      </label>
      {pessoa('Quem assina pelo cliente', rep, setRep)}
      <div className="rounded-[10px] bg-[#F8F7F3] px-3 py-2 text-[13px]">
        <span className="text-ink-3">Pela Lucminas assina </span>
        <b>{cfg.lucminasNome || '—'}</b>
        <span className="text-ink-3"> · {cfg.lucminasEmail || 'sem e-mail (configure em Integrações)'}</span>
      </div>
      {pessoa('Testemunha do cliente', tCli, setTCli)}
      {pessoa('Testemunha da Lucminas', tLuc, setTLuc)}
      <label className="flex flex-col gap-1.5">
        <span className="label">
          Mensagem no e-mail <span className="font-normal text-ink-3">(opcional)</span>
        </span>
        <input className="input" value={mensagem} onChange={(e) => setMensagem(e.target.value)} placeholder="Ex.: Segue o contrato de locação para assinatura." />
      </label>
      <p className="text-[12.5px] text-ink-3">A Autentique manda um e-mail com o link para cada um. Quando todos assinarem, o contrato assinado volta sozinho para o sistema.</p>
      {erro && (
        <div role="alert" className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">
          {erro}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={fechar}>
          Cancelar
        </button>
        <button type="button" className="btn-primary" disabled={enviando} onClick={() => void enviar()}>
          {enviando ? 'Enviando…' : 'Enviar para assinatura'}
        </button>
      </div>
    </Modal>
  );
}

/** Acompanhamento: quem já assinou, quem falta; copiar mensagem para o WhatsApp, reenviar, atualizar. */
export function AcompanharAssinatura({ e, edita, mudou }: { e: EnvioContrato; edita: boolean; mudou: () => void }) {
  const { avisar } = useEstado();
  const [ocupado, setOcupado] = useState('');
  const faltam = e.assinantes.filter((a) => !a.assinadoEm);
  const rodar = async (qual: string, f: () => Promise<unknown>, ok?: string) => {
    setOcupado(qual);
    try {
      await f();
      if (ok) avisar(ok);
      mudou();
    } catch (x) {
      avisar(x instanceof Error ? x.message : 'Não foi possível.', 'bad');
    } finally {
      setOcupado('');
    }
  };
  const copiarWhats = () =>
    rodar('whats', async () => {
      const externos = faltam.filter((a) => !ehDaLucminas(a.papel) && a.publicId);
      if (!externos.length) throw new Error('Do lado do cliente, todos já assinaram.');
      const linhas: string[] = [];
      for (const a of externos) {
        const { link } = await api.linkAssinatura(e.id, a.publicId);
        linhas.push(`*${a.nome}* (${a.papel.replace(/ \(.*\)$/, '').toLowerCase()}): ${link}`);
      }
      const texto = [
        `Olá! Segue o contrato de locação da Lucminas Empilhadeiras${e.numero ? ` (nº ${e.numero})` : ''} para assinatura eletrônica, referente à${e.frotas.length > 1 ? 's máquinas' : ' máquina'} FT${e.frotas.join(', FT')}.`,
        '',
        ...linhas,
        '',
        'O link é pessoal: cada um assina pelo seu. Qualquer dúvida, é só chamar.',
      ].join('\n');
      await copiarTexto(texto);
    }, 'Mensagem com os links copiada. É só colar no WhatsApp.');

  const cor = e.status === 'recusado' ? 'border-bad/30 bg-bad-soft' : 'border-info/30 bg-[#EEF4FF]';
  return (
    <div className={`mt-2.5 flex flex-col gap-2 rounded-[10px] border px-3 py-2.5 text-[13px] ${cor}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b className={e.status === 'recusado' ? 'text-bad' : 'text-info'}>
          {e.status === 'recusado' ? 'Alguém recusou assinar na Autentique' : `Aguardando assinatura · ${e.assinantes.length - faltam.length} de ${e.assinantes.length}`}
          {e.teste && <span className="ml-2 rounded bg-warn-soft px-1.5 py-0.5 text-[11px] font-semibold text-warn-strong">teste</span>}
        </b>
        <span className="text-xs text-ink-3">
          enviado em {dataHora(e.enviadoEm)}
          {e.por ? ` por ${e.por}` : ''}
        </span>
      </div>
      <ul className="grid gap-1 sm:grid-cols-2">
        {e.assinantes.map((a) => (
          <li key={a.email} className="flex items-start gap-1.5">
            <span aria-hidden className={a.assinadoEm ? 'text-ok' : a.recusadoEm ? 'text-bad' : 'text-ink-3'}>
              {a.assinadoEm ? '✓' : a.recusadoEm ? '✗' : '○'}
            </span>
            <span className="min-w-0">
              <b>{a.nome || a.email}</b> <span className="text-ink-3">· {a.papel}</span>
              <span className="block text-xs text-ink-3">
                {a.assinadoEm ? `assinou em ${dataHora(a.assinadoEm)}` : a.recusadoEm ? `recusou em ${dataHora(a.recusadoEm)}` : a.vistoEm ? 'abriu, ainda não assinou' : 'ainda não abriu'}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {e.erro && <p className="text-xs text-bad-strong">Última consulta: {e.erro}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary h-8 px-3 text-[12.5px]" disabled={!!ocupado} onClick={() => void rodar('atualizar', () => api.atualizarEnviosContrato())}>
          {ocupado === 'atualizar' ? 'Consultando…' : 'Atualizar agora'}
        </button>
        {edita && e.status === 'aguardando' && (
          <>
            <button type="button" className="btn-secondary h-8 px-3 text-[12.5px]" disabled={!!ocupado} onClick={() => void copiarWhats()}>
              {ocupado === 'whats' ? 'Gerando links…' : 'Copiar mensagem para WhatsApp'}
            </button>
            <button type="button" className="btn-secondary h-8 px-3 text-[12.5px]" disabled={!!ocupado} onClick={() => void rodar('reenviar', () => api.reenviarAssinatura(e.id), 'E-mail de lembrete reenviado para quem falta.')}>
              Reenviar e-mail
            </button>
            <button type="button" className="h-8 px-2 text-[12.5px] text-ink-3 underline" disabled={!!ocupado} onClick={() => void rodar('cancelar', () => api.cancelarAssinatura(e.id), 'O sistema parou de acompanhar esse envio.')}>
              Parar de acompanhar
            </button>
          </>
        )}
      </div>
      <p className="text-xs text-ink-3">O sistema confere sozinho a cada 10 minutos. Quando todos assinarem, o PDF assinado entra no contrato.</p>
    </div>
  );
}
