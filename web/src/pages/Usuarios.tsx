import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useEstado } from '../state';
import { ABAS, GRUPOS, NIVEIS, SO_VER } from '../lib/acesso';
import type { Nivel, PerfilAcesso, UsuarioAdmin } from '../types';
import { Chip, Modal } from '../components/ui';
import { IcMais } from '../components/Icones';

/** Senha fácil de ditar por telefone: 3 palavras curtas + 2 números. */
function gerarSenha(): string {
  const p = ['rio', 'sol', 'mar', 'pao', 'cafe', 'lua', 'boi', 'ipe', 'flor', 'mata', 'onda', 'vila', 'giro', 'pena', 'trem', 'roda', 'lago', 'ceu'];
  const a = new Uint32Array(5);
  crypto.getRandomValues(a);
  return `${p[a[0] % p.length]}-${p[a[1] % p.length]}-${p[a[2] % p.length]}-${(a[3] % 90) + 10}`;
}

type Aba = 'pessoas' | 'perfis' | 'copias';

export function Usuarios() {
  const { pode, usuario, avisar } = useEstado();
  const edita = pode('usuarios', 2);
  const [aba, setAba] = useState<Aba>('pessoas');
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[] | null>(null);
  const [perfis, setPerfis] = useState<PerfilAcesso[]>([]);
  const [erro, setErro] = useState('');

  const recarregar = useCallback(async () => {
    try {
      const [u, p] = await Promise.all([api.listarUsuariosAdmin(), api.listarPerfis()]);
      setUsuarios(u);
      setPerfis(p);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar.');
    }
  }, []);
  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">Usuários e permissões</h1>
        <p className="text-[13px] text-ink-3">Quem entra no sistema e o que cada perfil vê. Toda mudança fica no Registro.</p>
      </div>
      <div className="flex w-fit rounded-[10px] border border-line-strong bg-white p-0.5" role="tablist">
        {([['pessoas', 'Pessoas'], ['perfis', 'Perfis e permissões'], ...(edita ? ([['copias', 'Cópias de segurança']] as const) : [])] as const).map(([k, r]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={aba === k}
            onClick={() => setAba(k)}
            className={`min-h-[40px] rounded-lg px-4 text-[14px] font-semibold ${aba === k ? 'bg-noite text-white' : 'text-ink-2 hover:bg-line-soft'}`}
          >
            {r}
          </button>
        ))}
      </div>
      {erro && <p className="rounded-xl bg-bad-soft p-4 text-bad-strong">{erro}</p>}
      {!usuarios ? (
        !erro && <p className="text-ink-3">Carregando…</p>
      ) : aba === 'copias' ? (
        <Copias />
      ) : aba === 'pessoas' ? (
        <Pessoas usuarios={usuarios} perfis={perfis} edita={edita} euId={usuario?.id} recarregar={recarregar} avisar={avisar} />
      ) : (
        <Perfis perfis={perfis} usuarios={usuarios} edita={edita} recarregar={recarregar} avisar={avisar} />
      )}
    </div>
  );
}

type Avisar = (t: string, tom?: 'ok' | 'bad') => void;

function Pessoas({
  usuarios,
  perfis,
  edita,
  euId,
  recarregar,
  avisar,
}: {
  usuarios: UsuarioAdmin[];
  perfis: PerfilAcesso[];
  edita: boolean;
  euId?: number;
  recarregar: () => Promise<void>;
  avisar: Avisar;
}) {
  const [editando, setEditando] = useState<UsuarioAdmin | 'novo' | null>(null);
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const nomePerfil = (id: string) => perfis.find((p) => p.id === id)?.nome ?? id;
  const lista = usuarios.filter((u) => mostrarInativos || u.ativo).sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome));
  const inativos = usuarios.filter((u) => !u.ativo).length;

  const alternarAtivo = async (u: UsuarioAdmin) => {
    try {
      await api.alterarUsuario(u.id, { ativo: !u.ativo });
      avisar(u.ativo ? `${u.nome} não consegue mais entrar. O histórico dele continua.` : `${u.nome} pode entrar de novo.`);
      await recarregar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível salvar.', 'bad');
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] text-ink-3">
          {usuarios.filter((u) => u.ativo).length} pessoas com acesso
          {inativos > 0 && (
            <>
              {' · '}
              <button type="button" className="font-semibold text-info hover:underline" onClick={() => setMostrarInativos(!mostrarInativos)}>
                {mostrarInativos ? 'esconder' : 'mostrar'} {inativos} desativado{inativos > 1 ? 's' : ''}
              </button>
            </>
          )}
        </span>
        {edita && (
          <button type="button" className="btn-primary" onClick={() => setEditando('novo')}>
            <IcMais tamanho={16} /> Novo usuário
          </button>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full min-w-[640px] text-[14px]">
          <thead>
            <tr className="border-b border-line bg-[#F8F7F3] text-left text-xs text-ink-3">
              <th className="px-4 py-2 font-semibold">Pessoa</th>
              <th className="px-4 py-2 font-semibold">E-mail (login)</th>
              <th className="px-4 py-2 font-semibold">Perfil</th>
              <th className="px-4 py-2 font-semibold">Situação</th>
              <th className="px-4 py-2">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lista.map((u) => (
              <tr key={u.id} className={`border-b border-line-soft last:border-0 ${u.ativo ? '' : 'text-ink-3'}`}>
                <td className="px-4 py-2.5">
                  <span className="font-semibold">{u.nome}</span>
                  {u.chamar && <span className="ml-1.5 text-xs text-ink-3">“{u.chamar}”</span>}
                  {u.id === euId && <span className="ml-1.5 text-xs text-ink-3">(você)</span>}
                </td>
                <td className="px-4 py-2.5">{u.email}</td>
                <td className="px-4 py-2.5">{nomePerfil(u.perfil)}</td>
                <td className="px-4 py-2.5">{u.ativo ? <Chip tom="ok">Ativo</Chip> : <Chip tom="neutro">Desativado</Chip>}</td>
                <td className="px-4 py-2.5 text-right">
                  {edita && (
                    <span className="inline-flex gap-2">
                      <button type="button" className="btn-secondary btn-sm" onClick={() => setEditando(u)}>
                        Editar
                      </button>
                      {u.id !== euId && (
                        <button type="button" className="btn-secondary btn-sm" onClick={() => void alternarAtivo(u)}>
                          {u.ativo ? 'Desativar' : 'Reativar'}
                        </button>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <FormUsuario
        key={editando === 'novo' ? 'novo' : (editando?.id ?? 'nada')}
        alvo={editando}
        perfis={perfis}
        fechar={() => setEditando(null)}
        salvo={async (msg) => {
          avisar(msg);
          setEditando(null);
          await recarregar();
        }}
      />
    </section>
  );
}

function FormUsuario({ alvo, perfis, fechar, salvo }: { alvo: UsuarioAdmin | 'novo' | null; perfis: PerfilAcesso[]; fechar: () => void; salvo: (msg: string) => Promise<void> }) {
  const novo = alvo === 'novo';
  const u = alvo && alvo !== 'novo' ? alvo : null;
  const [email, setEmail] = useState(u?.email ?? '');
  const [nome, setNome] = useState(u?.nome ?? '');
  const [chamar, setChamar] = useState(u?.chamar ?? '');
  const [perfil, setPerfil] = useState(u?.perfil ?? 'tecnico');
  const [trocarSenha, setTrocarSenha] = useState(novo);
  const [senha, setSenha] = useState(novo ? gerarSenha() : '');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const descricao = perfis.find((p) => p.id === perfil)?.descricao;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro('');
    if (trocarSenha && senha.length < 8) return setErro('A senha precisa ter pelo menos 8 caracteres.');
    setSalvando(true);
    try {
      if (novo) {
        await api.criarUsuario({ email: email.trim(), nome: nome.trim(), chamar: chamar.trim(), perfil, senha });
        await salvo(`${nome.trim()} já pode entrar com ${email.trim().toLowerCase()} e a senha que você anotou.`);
      } else if (u) {
        await api.alterarUsuario(u.id, { nome: nome.trim(), chamar: chamar.trim(), perfil, ...(trocarSenha ? { senha } : {}) });
        await salvo(trocarSenha ? `Dados de ${nome.trim()} salvos. A senha nova já vale, e ele foi desconectado dos outros aparelhos.` : `Dados de ${nome.trim()} salvos.`);
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal aberto={!!alvo} fechar={fechar} titulo={novo ? 'Novo usuário' : `Editar ${u?.nome ?? ''}`}>
      <form onSubmit={enviar} className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="u-email" className="label">
            E-mail (é o login)
          </label>
          <input
            id="u-email"
            type="email"
            className="input"
            required
            disabled={!novo}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nome@lucminas.com.br"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="u-nome" className="label">
              Nome
            </label>
            <input id="u-nome" className="input" required value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="u-chamar" className="label">
              Como chamar <span className="font-normal text-ink-3">(opcional)</span>
            </label>
            <input id="u-chamar" className="input" value={chamar} onChange={(e) => setChamar(e.target.value)} placeholder="Ex.: Dudu" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="u-perfil" className="label">
            Perfil
          </label>
          <select id="u-perfil" className="input" value={perfil} onChange={(e) => setPerfil(e.target.value)}>
            {perfis.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
          {descricao && <p className="text-xs text-ink-3">{descricao}</p>}
        </div>
        {!novo && (
          <label className="flex items-center gap-2 text-[14px]">
            <input
              type="checkbox"
              checked={trocarSenha}
              onChange={(e) => {
                setTrocarSenha(e.target.checked);
                if (e.target.checked && !senha) setSenha(gerarSenha());
              }}
            />
            Definir uma senha nova (esqueceu a senha)
          </label>
        )}
        {trocarSenha && (
          <div className="flex flex-col gap-1.5 rounded-[10px] bg-brand-tint p-3">
            <label htmlFor="u-senha" className="label">
              Senha {novo ? 'inicial' : 'nova'}
            </label>
            <div className="flex gap-2">
              <input id="u-senha" className="input font-mono" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="off" />
              <button type="button" className="btn-secondary shrink-0" onClick={() => setSenha(gerarSenha())}>
                Gerar outra
              </button>
            </div>
            <p className="text-xs text-ink-2">Anote e passe para a pessoa pessoalmente ou por telefone. Depois ela pode trocar em “Trocar senha”.</p>
          </div>
        )}
        {erro && (
          <div role="alert" className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">
            {erro}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2.5">
          <button type="button" className="btn-secondary" onClick={fechar}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={salvando}>
            {salvando ? 'Salvando…' : novo ? 'Criar usuário' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Perfis({
  perfis,
  usuarios,
  edita,
  recarregar,
  avisar,
}: {
  perfis: PerfilAcesso[];
  usuarios: UsuarioAdmin[];
  edita: boolean;
  recarregar: () => Promise<void>;
  avisar: Avisar;
}) {
  const [selId, setSelId] = useState(perfis[0]?.id ?? '');
  const sel = perfis.find((p) => p.id === selId) ?? perfis[0];
  const [rascunho, setRascunho] = useState<PerfilAcesso | null>(sel ?? null);
  const [salvando, setSalvando] = useState(false);
  const [criando, setCriando] = useState(false);
  useEffect(() => setRascunho(sel ?? null), [sel]);
  const quantos = useMemo(() => Object.fromEntries(perfis.map((p) => [p.id, usuarios.filter((u) => u.ativo && u.perfil === p.id).length])), [perfis, usuarios]);
  if (!sel || !rascunho) return null;
  const mudou = JSON.stringify(rascunho) !== JSON.stringify(sel);
  const pode = edita;

  const definir = (aba: string, n: Nivel) => setRascunho({ ...rascunho, permissoes: { ...rascunho.permissoes, [aba]: n } });

  const salvar = async () => {
    setSalvando(true);
    try {
      await api.salvarPerfil(rascunho);
      avisar(`Permissões do perfil ${rascunho.nome} salvas. Já valem para quem usa esse perfil (na próxima vez que a tela recarregar).`);
      await recarregar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível salvar.', 'bad');
    } finally {
      setSalvando(false);
    }
  };

  const apagar = async () => {
    try {
      await api.apagarPerfil(sel.id);
      avisar(`Perfil ${sel.nome} apagado.`);
      setSelId(perfis[0].id);
      await recarregar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não foi possível apagar.', 'bad');
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      <div className="flex flex-col gap-2">
        {perfis.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setSelId(p.id)}
            className={`rounded-xl border px-4 py-3 text-left ${p.id === sel.id ? 'border-brand bg-brand-tint shadow-[inset_3px_0_0_#FFC400]' : 'border-line bg-white hover:bg-canvas'}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{p.nome}</span>
              <span className="text-xs text-ink-3">
                {quantos[p.id]} pessoa{quantos[p.id] === 1 ? '' : 's'}
              </span>
            </div>
            {p.descricao && <div className="mt-0.5 text-xs text-ink-3">{p.descricao}</div>}
          </button>
        ))}
        {pode && (
          <button type="button" className="btn-secondary" onClick={() => setCriando(true)}>
            <IcMais tamanho={16} /> Novo perfil
          </button>
        )}
      </div>

      <section className="flex flex-col gap-4 rounded-xl border border-line bg-white p-5">
        <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="p-nome" className="label">
              Nome do perfil
            </label>
            <input id="p-nome" className="input" disabled={!pode} value={rascunho.nome} onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="p-desc" className="label">
              Para quem é
            </label>
            <input id="p-desc" className="input" disabled={!pode} value={rascunho.descricao} onChange={(e) => setRascunho({ ...rascunho, descricao: e.target.value })} />
          </div>
        </div>

        <div className="flex flex-col">
          {GRUPOS.map((g) => (
            <div key={g.id} className="border-t border-line-soft py-2 first:border-0">
              <div className="py-1 text-[12px] font-bold uppercase tracking-wide text-ink-3">{g.rotulo}</div>
              {ABAS.filter((a) => a.grupo === g.id).map((a) => {
                const n = (rascunho.permissoes[a.id] ?? 0) as Nivel;
                const opcoes = SO_VER.includes(a.id) ? NIVEIS.filter((x) => x.n < 2) : NIVEIS;
                const nMostrado = SO_VER.includes(a.id) && n === 2 ? 1 : n;
                return (
                  <div key={a.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1.5">
                    <div className="min-w-[200px] flex-1">
                      <div className="text-[14px] font-medium">{a.rotulo}</div>
                      <div className="text-xs text-ink-3">{n === 0 ? 'não aparece no menu' : n === 2 ? a.edita : a.ve}</div>
                    </div>
                    <div className="flex rounded-[10px] border border-line-strong p-0.5" role="radiogroup" aria-label={a.rotulo}>
                      {opcoes.map((o) => (
                        <button
                          key={o.n}
                          type="button"
                          role="radio"
                          aria-checked={nMostrado === o.n}
                          disabled={!pode}
                          onClick={() => definir(a.id, SO_VER.includes(a.id) && o.n === 1 ? 2 : o.n)}
                          className={`min-h-[34px] min-w-[68px] rounded-lg px-2.5 text-[13px] font-semibold disabled:cursor-default ${
                            nMostrado === o.n ? (o.n === 0 ? 'bg-line text-ink-2' : o.n === 1 ? 'bg-info-soft text-info' : 'bg-ok-soft text-ok') : 'text-ink-3 hover:bg-line-soft'
                          }`}
                        >
                          {o.rotulo}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <label className="flex items-start gap-2.5 rounded-[10px] bg-[#F8F7F3] p-3 text-[14px]">
          <input type="checkbox" className="mt-1" disabled={!pode} checked={rascunho.veValores} onChange={(e) => setRascunho({ ...rascunho, veValores: e.target.checked })} />
          <span>
            <b>Vê valores</b>
            <span className="block text-xs text-ink-3">
              Somas, totais e valores nos relatórios em PDF. Sem isso, a pessoa vê o valor de cada frota só se fizer a Conferência do mês; senão, não vê valor nenhum.
            </span>
          </span>
        </label>

        {pode && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {!sel.padrao ? (
              <button type="button" className="btn-secondary text-bad" onClick={() => void apagar()}>
                Apagar perfil
              </button>
            ) : (
              <span className="text-xs text-ink-3">Perfil que vem com o sistema: dá para ajustar, não para apagar.</span>
            )}
            <span className="flex gap-2">
              {mudou && (
                <button type="button" className="btn-secondary" onClick={() => setRascunho(sel)}>
                  Desfazer
                </button>
              )}
              <button type="button" className="btn-primary" disabled={!mudou || salvando} onClick={() => void salvar()}>
                {salvando ? 'Salvando…' : 'Salvar permissões'}
              </button>
            </span>
          </div>
        )}
      </section>

      <NovoPerfil
        aberto={criando}
        base={sel}
        fechar={() => setCriando(false)}
        criado={async (p) => {
          setCriando(false);
          avisar(`Perfil ${p.nome} criado com as permissões de ${sel.nome}. Ajuste o que precisar e salve.`);
          await recarregar();
          setSelId(p.id);
        }}
      />
    </div>
  );
}

function NovoPerfil({ aberto, base, fechar, criado }: { aberto: boolean; base: PerfilAcesso; fechar: () => void; criado: (p: PerfilAcesso) => Promise<void> }) {
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState('');
  return (
    <Modal aberto={aberto} fechar={fechar} titulo="Novo perfil">
      <form
        className="flex flex-col gap-3.5"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const p = await api.criarPerfil({ nome: nome.trim(), descricao: '', permissoes: base.permissoes, veValores: base.veValores });
            setNome('');
            await criado(p);
          } catch (err) {
            setErro(err instanceof Error ? err.message : 'Não foi possível criar.');
          }
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="np-nome" className="label">
            Nome do perfil
          </label>
          <input id="np-nome" className="input" required value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Oficina" />
          <p className="text-xs text-ink-3">Começa com as mesmas permissões de “{base.nome}”.</p>
        </div>
        {erro && <p className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">{erro}</p>}
        <div className="flex justify-end gap-2.5">
          <button type="button" className="btn-secondary" onClick={fechar}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={!nome.trim()}>
            Criar perfil
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Copias() {
  const [lista, setLista] = useState<{ arquivo: string; bytes: number }[] | null>(null);
  useEffect(() => {
    api.listarCopias().then(setLista, () => setLista([]));
  }, []);
  return (
    <section className="flex max-w-[720px] flex-col gap-4">
      <div className="rounded-xl border border-line bg-white p-5 text-[14px]">
        <p>
          O banco de dados fica no servidor da Hostinger, na pasta <code>/opt/faturas-dados</code>. O sistema grava sozinho <b>uma cópia por dia</b> e guarda as dos últimos 30
          dias.
        </p>
        <p className="mt-2 text-ink-2">
          Essas cópias ficam no mesmo servidor: protegem contra erro e coisa apagada sem querer, mas não contra perder o servidor. Por isso, baixe uma cópia de vez em quando (uma
          vez por semana é um bom ritmo) e guarde no computador ou no Google Drive da empresa.
        </p>
        <a href="/api/admin/copia-agora" className="btn-primary mt-4 inline-flex" download>
          Baixar cópia do banco agora
        </a>
      </div>
      <div>
        <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ink-3">Cópias automáticas no servidor</h2>
        {lista === null ? (
          <p className="text-ink-3">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="text-ink-3">A primeira cópia é feita logo depois da próxima atualização do sistema.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft rounded-xl border border-line bg-white">
            {lista.map((c) => (
              <li key={c.arquivo} className="flex justify-between px-4 py-2 text-[13.5px]">
                <span>{c.arquivo.slice(8, 18).split('-').reverse().join('/')}</span>
                <span className="text-ink-3">{(c.bytes / 1_048_576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
