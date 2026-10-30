import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (s: string, salt: Buffer, n: number) => Promise<Buffer>;

/** Hash de senha com scrypt (salt aleatório). Formato: scrypt$<salt hex>$<hash hex> */
export async function gerarHash(senha: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(senha, salt, 64);
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}

export async function conferirSenha(senha: string, guardado: string): Promise<boolean> {
  const [alg, saltHex, hashHex] = guardado.split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const h = await scrypt(senha, Buffer.from(saltHex, 'hex'), esperado.length);
  return timingSafeEqual(h, esperado);
}

/** Senha aleatória legível (sem caracteres ambíguos), ex.: "kq7m-xp4t-9vhc-2wnr" */
export function senhaAleatoria(): string {
  const alfabeto = 'abcdefghjkmnpqrstuvwxyz23456789';
  const b = randomBytes(16);
  const s = Array.from(b, (x) => alfabeto[x % alfabeto.length]).join('');
  return s.match(/.{4}/g)!.join('-');
}

/** Regra mínima de senha. Devolve o problema, ou null se estiver ok. */
export function problemaSenha(s: string): string | null {
  if (s.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (s.length > 200) return 'Senha muito longa.';
  return null;
}

export const novoToken = () => randomBytes(32).toString('base64url');
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
