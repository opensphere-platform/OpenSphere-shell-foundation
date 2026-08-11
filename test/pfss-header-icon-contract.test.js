import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('PFSS header management icons use one fixed 16px render box', () => {
  const css = readFileSync(new URL('../src/app/app.component.css', import.meta.url), 'utf8');
  assert.match(
    css,
    /\.pgp-management-actions--header \.pgp-management-action os-cicon\s*\{[^}]*width:\s*16px[^}]*min-width:\s*16px[^}]*height:\s*16px[^}]*min-height:\s*16px/,
  );
});
