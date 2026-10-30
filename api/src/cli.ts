/*
 * Administração de usuários, pelo terminal do servidor:
 *   bash /opt/faturas/deploy/usuario.sh criar  email@lucminas.com.br "Nome" [--chamar Apelido] [--senha]
 *   bash /opt/faturas/deploy/usuario.sh senha  email@lucminas.com.br [--senha]
 *   bash /opt/faturas/deploy/usuario.sh chamar email@lucminas.com.br Apelido
 *   bash /opt/faturas/deploy/usuario.sh desativar | reativar email@lucminas.com.br
 *   bash /opt/faturas/deploy/usuario.sh listar
 * Com --senha, a senha é digitada no terminal (não aparece na tela).
 * Sem --senha, o sistema gera uma senha aleatória e mostra uma única vez.
 */
import { createInterface, type Interface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { abrirBanco, repositorio } from './db.js';
import { gerarHash, problemaSenha, senhaAleatoria } from './senha.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const args = process.argv.slice(2);
const flag = (nome: string) => {
  const i = args.indexOf(nome);
  if (i < 0) return undefined;
  const valor = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '';
  args.splice(i, valor ? 2 : 1);
  return valor;
};
const chamarFlag = flag('--chamar');
const pedirSenha = flag('--senha') !== undefined;
const [cmd, email, ...resto] = args;

const db = abrirBanco(process.env.BANCO ?? '/dados/faturas.db');
const repo = repositorio(db);

const sair = (msg: string, codigo = 1): never => {
  console.log(msg);
  leitor.rl?.close();
  db.close();
  process.exit(codigo);
};

/** Lê linhas sem mostrar o que é digitado. Sem terminal (entrada redirecionada), lê as linhas da entrada em ordem. */
const leitor: { rl?: Interface; fila?: string[]; mudo: boolean } = { mudo: false };
async function lerEscondido(pergunta: string): Promise<string> {
  process.stdout.write(pergunta);
  if (!process.stdin.isTTY) {
    if (!leitor.fila) {
      let texto = '';
      for await (const parte of process.stdin) texto += parte;
      leitor.fila = texto.split(/\r?\n/);
    }
    process.stdout.write('\n');
    return leitor.fila.shift() ?? '';
  }
  leitor.mudo = true;
  if (!leitor.rl) {
    const saida = new Writable({
      write(chunk, _enc, cb) {
        if (!leitor.mudo) process.stdout.write(chunk);
        cb();
      },
    });
    leitor.rl = createInterface({ input: process.stdin, output: saida, terminal: true });
  }
  const r = await leitor.rl.question('');
  leitor.mudo = false;
  process.stdout.write('\n');
  return r;
}

async function obterSenha(): Promise<{ senha: string; gerada: boolean }> {
  if (!pedirSenha) return { senha: senhaAleatoria(), gerada: true };
  const s1 = await lerEscondido('Digite a senha (não aparece na tela): ');
  const problema = problemaSenha(s1);
  if (problema) sair(problema);
  const s2 = await lerEscondido('Digite de novo para confirmar: ');
  if (s1 !== s2) sair('As senhas não são iguais. Nada foi alterado.');
  return { senha: s1, gerada: false };
}

const mostrar = (e: string, s: { senha: string; gerada: boolean }) => {
  if (!s.gerada) return;
  console.log('');
  console.log('  E-mail: ' + e);
  console.log('  Senha:  ' + s.senha);
  console.log('');
  console.log('  Anote agora: esta senha não aparece de novo.');
};

if (cmd === 'criar') {
  const nome = resto.join(' ').trim();
  if (!email || !EMAIL.test(email) || !nome) sair('Uso: criar email@lucminas.com.br "Nome" [--chamar Apelido] [--senha]');
  if (repo.usuarioParaLogin(email)) sair(`Já existe usuário com o e-mail ${email}. Para trocar a senha use: senha ${email}`);
  const s = await obterSenha();
  const u = repo.criarUsuario(email, nome, await gerarHash(s.senha), (chamarFlag ?? '').trim());
  console.log(`Usuário criado: ${u.nome}${u.chamar ? ` (saudação: "Oi ${u.chamar}! :)")` : ''}`);
  mostrar(u.email, s);
} else if (cmd === 'senha') {
  if (!email) sair('Uso: senha email@lucminas.com.br [--senha]');
  if (!repo.listarUsuarios().some((u) => u.email === email.toLowerCase())) sair(`Usuário ${email} não encontrado.`);
  const s = await obterSenha();
  repo.trocarSenha(email, await gerarHash(s.senha));
  console.log('Senha trocada. Quem estava conectado com a senha antiga foi desconectado.');
  mostrar(email.toLowerCase(), s);
} else if (cmd === 'chamar') {
  const apelido = resto.join(' ').trim();
  if (!email || !apelido) sair('Uso: chamar email@lucminas.com.br Apelido');
  if (!repo.definirChamar(email, apelido)) sair(`Usuário ${email} não encontrado.`);
  console.log(`Pronto. A saudação agora é: "Oi ${apelido}! :)"`);
} else if (cmd === 'desativar' || cmd === 'reativar') {
  if (!email) sair(`Uso: ${cmd} email@lucminas.com.br`);
  if (!repo.definirUsuarioAtivo(email, cmd === 'reativar')) sair(`Usuário ${email} não encontrado.`);
  console.log(cmd === 'desativar' ? 'Usuário desativado.' : 'Usuário reativado.');
} else if (cmd === 'listar') {
  const us = repo.listarUsuarios();
  if (!us.length) console.log('Nenhum usuário ainda.');
  for (const u of us) console.log(`${u.ativo ? 'ativo     ' : 'desativado'}  ${u.email}  (${u.nome}${u.chamar ? `, "Oi ${u.chamar}!"` : ''})`);
} else {
  sair('Comandos: criar, senha, chamar, desativar, reativar, listar');
}
leitor.rl?.close();
  db.close();
