import { expect, it } from 'vitest';
import { ImapFlow } from 'imapflow';
import { semQuedas } from './email.js';

it("queda da conexão de e-mail ('Socket timeout') não derruba o servidor", () => {
  const sem = new ImapFlow({ host: '127.0.0.1', port: 1, secure: true, auth: { user: 'x', pass: 'y' }, logger: false });
  expect(() => sem.emit('error', new Error('Socket timeout'))).toThrow('Socket timeout'); // era isso que derrubava
  const com = semQuedas(new ImapFlow({ host: '127.0.0.1', port: 1, secure: true, auth: { user: 'x', pass: 'y' }, logger: false }));
  expect(() => com.emit('error', new Error('Socket timeout'))).not.toThrow();
});
