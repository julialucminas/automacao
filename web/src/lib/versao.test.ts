import { expect, it } from 'vitest';
import { scriptPrincipal } from './versao';

it('acha o arquivo principal no HTML publicado', () => {
  expect(scriptPrincipal('<script type="module" crossorigin src="./assets/index-CT2nnO8h.js"></script>')).toBe('assets/index-CT2nnO8h.js');
  expect(scriptPrincipal('<script type="module" src="/src/main.tsx"></script>')).toBeNull();
});
