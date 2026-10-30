/*
 * Administração de usuários, pelo terminal do servidor:
 *   bash /opt/faturas/deploy/usuario.sh criar  email@lucminas.com.br "Nome"
 *   bash /opt/faturas/deploy/usuario.sh senha  email@lucminas.com.br      (gera senha nova)
 *   bash /opt/faturas/deploy/usuario.sh desativar email@lucminas.com.br
 *   bash /opt/faturas/deploy/usuario.sh listar
 * A senha é gerada aqui e mostrada uma única vez.
 */
import { abrirBanco, repositorio } from './db.js';
import { gerarHash, senhaAleatoria } from './senha.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const [cmd, email, ...resto] = process.argv.slice(2);
const db = abrirBanco(process.env.BANCO ?? '/dados/faturas.db');
const repo = repositorio(db);

const sair = (msg: string, codigo = 1) => {
  console.log(msg);
  db.close();
  process.exit(codigo);
};

const mostrarSenha = (e: string, senha: string) => {
  console.log('');
  console.log('  E-mail: ' + e);
  console.log('  Senha:  ' + senha);
  console.log('');
  console.log('  Anote agora: esta senha não aparece de novo.');
};

if (cmd === 'criar') {
  const nome = resto.join(' ').trim();
  if (!email || !EMAIL.test(email) || !nome) sair('Uso: criar email@lucminas.com.br "Nome da pessoa"');
  if (repo.usuarioParaLogin(email)) sair(`Já existe usuário com o e-mail ${email}. Para gerar senha nova use: senha ${email}`);
  const senha = senhaAleatoria();
  repo.criarUsuario(email, nome, await gerarHash(senha));
  console.log(`Usuário criado: ${nome}`);
  mostrarSenha(email.toLowerCase(), senha);
} else if (cmd === 'senha') {
  if (!email) sair('Uso: senha email@lucminas.com.br');
  const senha = senhaAleatoria();
  if (!repo.trocarSenha(email, await gerarHash(senha))) sair(`Usuário ${email} não encontrado.`);
  console.log('Senha trocada. Quem estava conectado com a senha antiga foi desconectado.');
  mostrarSenha(email.toLowerCase(), senha);
} else if (cmd === 'desativar' || cmd === 'reativar') {
  if (!email) sair(`Uso: ${cmd} email@lucminas.com.br`);
  if (!repo.definirUsuarioAtivo(email, cmd === 'reativar')) sair(`Usuário ${email} não encontrado.`);
  console.log(cmd === 'desativar' ? 'Usuário desativado.' : 'Usuário reativado.');
} else if (cmd === 'listar') {
  const us = repo.listarUsuarios();
  if (!us.length) console.log('Nenhum usuário ainda.');
  for (const u of us) console.log(`${u.ativo ? 'ativo    ' : 'desativado'}  ${u.email}  (${u.nome})`);
} else {
  sair('Comandos: criar, senha, desativar, reativar, listar');
}
db.close();
