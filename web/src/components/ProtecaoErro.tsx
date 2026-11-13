import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Se uma parte da tela quebrar, mostra o erro (para mandar print) em vez de deixar a tela em branco.
 * `chave` muda quando troca de página: aí tenta de novo sozinho.
 */
export class ProtecaoErro extends Component<{ children: ReactNode; chave?: string; compacto?: boolean }, { erro: Error | null; chave?: string }> {
  state: { erro: Error | null; chave?: string } = { erro: null, chave: this.props.chave };
  static getDerivedStateFromError(erro: Error) {
    return { erro };
  }
  static getDerivedStateFromProps(p: { chave?: string }, s: { erro: Error | null; chave?: string }) {
    return p.chave !== s.chave ? { erro: null, chave: p.chave } : null;
  }
  componentDidCatch(erro: Error, info: ErrorInfo) {
    console.error('Tela quebrou:', erro, info.componentStack);
  }
  render() {
    const { erro } = this.state;
    if (!erro) return this.props.children;
    if (this.props.compacto)
      return (
        <div className="fixed bottom-4 right-4 z-40 max-w-[320px] rounded-xl border border-bad/30 bg-white p-3 text-[13px] shadow-lg">
          <b className="text-bad">Os avisos deram erro.</b> <span className="text-ink-3">{erro.message}</span>{' '}
          <button type="button" className="font-semibold text-info underline" onClick={() => this.setState({ erro: null })}>
            Tentar de novo
          </button>
        </div>
      );
    return (
      <div role="alert" className="flex flex-col gap-3 rounded-xl border border-bad/30 bg-bad-soft p-5 text-[14px]">
        <b className="text-bad-strong">Esta tela deu um erro.</b>
        <code className="whitespace-pre-wrap break-words rounded bg-white p-2 text-[12px] text-ink-2">{erro.message}</code>
        <p className="text-ink-2">Mande um print desta mensagem para a Júlia. Enquanto isso, dá para usar o menu normalmente.</p>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary btn-sm" onClick={() => this.setState({ erro: null })}>
            Tentar de novo
          </button>
          <button type="button" className="btn-primary btn-sm" onClick={() => window.location.reload()}>
            Recarregar a página
          </button>
        </div>
      </div>
    );
  }
}
