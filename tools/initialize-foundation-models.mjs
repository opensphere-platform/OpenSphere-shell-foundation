#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'deploy/foundationmodels.yaml');
const dryRun = process.argv.includes('--dry-run=server');
const documents = [];
yaml.loadAll(readFileSync(source, 'utf8'), (document) => {
  if (document?.kind === 'FoundationModel' && document?.metadata?.name) documents.push(document);
});

for (const document of documents) {
  const name = document.metadata.name;
  try {
    execFileSync('kubectl', ['get', 'foundationmodel.foundation.opensphere.io', name], { stdio: 'ignore' });
    process.stdout.write(`preserved FoundationModel/${name} (runtime fields remain user-owned)\n`);
    continue;
  } catch {
    // NotFound is the only expected path. kubectl create below remains the
    // authoritative failure boundary for connectivity or admission errors.
  }
  const args = ['create', '-f', '-'];
  if (dryRun) args.push('--dry-run=server');
  const output = execFileSync('kubectl', args, {
    input: yaml.dump(document, { noRefs: true, lineWidth: 140 }), encoding: 'utf8',
  });
  process.stdout.write(output);
}
