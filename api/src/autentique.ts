/*
 * Autentique (assinatura eletrônica): o sistema manda o PDF do contrato, a Autentique avisa os assinantes por
 * e-mail, e de tempos em tempos o sistema pergunta como está; quando todos assinaram, baixa o PDF assinado.
 * API GraphQL: https://docs.autentique.com.br/api
 */
export const URL_AUTENTIQUE = 'https://api.autentique.com.br/v2/graphql';

export type AcaoAssinante = 'SIGN' | 'SIGN_AS_A_WITNESS';
export type Assinante = { nome: string; email: string; acao: AcaoAssinante; papel: string };
export type SituacaoAssinante = {
  publicId: string;
  nome: string;
  email: string;
  acao: string;
  vistoEm: string | null;
  assinadoEm: string | null;
  recusadoEm: string | null;
};
export type DocumentoAutentique = { id: string; assinaturas: SituacaoAssinante[]; arquivoAssinado: string | null };

export class ErroAutentique extends Error {}

type Fetch = typeof fetch;

const CAMPOS_ASSINATURA = 'public_id name email action { name } viewed { created_at } signed { created_at } rejected { created_at }';

const deAssinatura = (s: Record<string, unknown>): SituacaoAssinante => {
  const quando = (k: string) => ((s[k] as { created_at?: string } | null)?.created_at ?? null) || null;
  return {
    publicId: String(s.public_id ?? ''),
    nome: String(s.name ?? ''),
    email: String(s.email ?? ''),
    acao: String((s.action as { name?: string } | null)?.name ?? ''),
    vistoEm: quando('viewed'),
    assinadoEm: quando('signed'),
    recusadoEm: quando('rejected'),
  };
};

/** AUTENTIQUE_URL só serve para testar contra um servidor falso; em produção fica o endereço oficial. */
export function clienteAutentique(token: string, f: Fetch = fetch, url = process.env.AUTENTIQUE_URL || URL_AUTENTIQUE) {
  const chamar = async (corpo: BodyInit, json: boolean) => {
    let r: Response;
    try {
      r = await f(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...(json ? { 'Content-Type': 'application/json' } : {}) }, body: corpo });
    } catch {
      throw new ErroAutentique('Não foi possível falar com a Autentique agora. Tente de novo em alguns minutos.');
    }
    if (r.status === 401 || r.status === 403) throw new ErroAutentique('A Autentique recusou o token. Confira o token em Configurações → Integrações.');
    const dados = (await r.json().catch(() => null)) as { data?: Record<string, unknown>; errors?: { message?: string }[] } | null;
    if (!dados) throw new ErroAutentique(`A Autentique respondeu com erro (${r.status}).`);
    if (dados.errors?.length) {
      const m = dados.errors.map((e) => e.message ?? '').join('; ');
      if (/unauthenticated|unauthorized|token/i.test(m)) throw new ErroAutentique('A Autentique recusou o token. Confira o token em Configurações → Integrações.');
      throw new ErroAutentique(`A Autentique recusou: ${m}`);
    }
    return dados.data ?? {};
  };
  const gql = (query: string, variables: Record<string, unknown> = {}) => chamar(JSON.stringify({ query, variables }), true);

  return {
    /** Confere o token: devolve o nome e e-mail da conta. */
    async quemSou(): Promise<{ nome: string; email: string }> {
      const d = await gql('query { me { name email } }');
      const me = d.me as { name?: string; email?: string } | null;
      if (!me) throw new ErroAutentique('A Autentique não reconheceu a conta.');
      return { nome: me.name ?? '', email: me.email ?? '' };
    },

    /** Cria o documento para assinatura (a Autentique manda o e-mail para cada assinante). */
    async criarDocumento(d: { nome: string; mensagem: string; pdf: Buffer; nomeArquivo: string; assinantes: Assinante[]; teste: boolean }): Promise<DocumentoAutentique> {
      const query = `mutation Criar($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
        createDocument(sandbox: ${d.teste ? 'true' : 'false'}, document: $document, signers: $signers, file: $file) {
          id signatures { ${CAMPOS_ASSINATURA} }
        }
      }`;
      const variables = {
        document: { name: d.nome, ...(d.mensagem ? { message: d.mensagem } : {}), refusable: true, sortable: false },
        signers: d.assinantes.map((a) => ({ email: a.email, action: a.acao })),
        file: null,
      };
      const form = new FormData();
      form.append('operations', JSON.stringify({ query, variables }));
      form.append('map', JSON.stringify({ file: ['variables.file'] }));
      form.append('file', new Blob([new Uint8Array(d.pdf)], { type: 'application/pdf' }), d.nomeArquivo);
      const r = (await chamar(form, false)).createDocument as { id: string; signatures: Record<string, unknown>[] } | null;
      if (!r?.id) throw new ErroAutentique('A Autentique não criou o documento.');
      return { id: r.id, assinaturas: (r.signatures ?? []).map(deAssinatura), arquivoAssinado: null };
    },

    async buscarDocumento(id: string): Promise<DocumentoAutentique | null> {
      // ids entram como texto na consulta (JSON.stringify já escapa como string GraphQL)
      const d = await gql(`query { document(id: ${JSON.stringify(id)}) { id files { signed } signatures { ${CAMPOS_ASSINATURA} } } }`);
      const doc = d.document as { id: string; files?: { signed?: string | null }; signatures?: Record<string, unknown>[] } | null;
      if (!doc) return null;
      return { id: doc.id, assinaturas: (doc.signatures ?? []).map(deAssinatura), arquivoAssinado: doc.files?.signed ?? null };
    },

    /** Link de assinatura de um assinante (para mandar pelo WhatsApp). */
    async linkDeAssinatura(publicId: string): Promise<string> {
      const d = await gql(`mutation { createLinkToSignature(public_id: ${JSON.stringify(publicId)}) { short_link } }`);
      const l = (d.createLinkToSignature as { short_link?: string } | null)?.short_link;
      if (!l) throw new ErroAutentique('A Autentique não gerou o link.');
      return l;
    },

    async reenviar(publicIds: string[]) {
      await gql(`mutation { resendSignatures(public_ids: ${JSON.stringify(publicIds)}) }`);
    },

    /** Baixa o PDF assinado (o endereço vem em files.signed). */
    async baixar(url: string): Promise<Buffer> {
      let r: Response;
      try {
        r = await f(url, { headers: { Authorization: `Bearer ${token}` } });
      } catch {
        throw new ErroAutentique('Não foi possível baixar o contrato assinado agora.');
      }
      if (!r.ok) throw new ErroAutentique(`Não foi possível baixar o contrato assinado (${r.status}).`);
      return Buffer.from(await r.arrayBuffer());
    },
  };
}
export type ClienteAutentique = ReturnType<typeof clienteAutentique>;
