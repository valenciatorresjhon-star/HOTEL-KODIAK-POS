import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = 'kodiak-staging-20261114';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const prepareOnly = args.length === 1 && args[0] === '--prepare-only';
if (args.length && !prepareOnly) throw new Error('Uso: npm run firebase:preview [-- --prepare-only]');

function firebase(...args) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('Ejecute este comando con npm run firebase:preview.');
  execFileSync(process.execPath, [npmCli, 'exec', '--yes', '--package', 'firebase-tools@15.37.0', '--', 'firebase', ...args], {
    stdio: 'inherit',
  });
}
if (!prepareOnly) {
  firebase('hosting:sites:get', project, '--project', project, '--non-interactive');
}

const response = await fetch(`https://${project}.web.app/__/firebase/init.json`, {
  signal: AbortSignal.timeout(15000),
});
if (!response.ok) throw new Error(`Firebase respondió con HTTP ${response.status}.`);
const config = await response.json();
if (config.projectId !== project || !config.apiKey || !config.authDomain || !config.appId) {
  throw new Error('La configuración de Firebase no corresponde al proyecto de pruebas.');
}

const temp = await mkdtemp(join(tmpdir(), 'kodiak-lite-preview-'));
let prepared = false;
try {
  const { hosting } = JSON.parse(await readFile(join(root, 'firebase.json'), 'utf8'));
  await writeFile(join(temp, 'firebase.json'), JSON.stringify({ hosting: { ...hosting, site: project, public: 'dist' } }));
  execFileSync(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', join(temp, 'dist')], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_FIREBASE_PROJECT_ID: project,
      VITE_FIREBASE_API_KEY: config.apiKey,
      VITE_FIREBASE_AUTH_DOMAIN: config.authDomain,
      VITE_FIREBASE_APP_ID: config.appId,
      VITE_FIREBASE_STORAGE_BUCKET: config.storageBucket ?? '',
      VITE_FIREBASE_MESSAGING_SENDER_ID: config.messagingSenderId ?? '',
      VITE_USE_FIREBASE_EMULATORS: 'false',
    },
  });
  if (prepareOnly) {
    console.log(`Compilación para ${project}: ${temp}`);
    prepared = true;
  } else {
    firebase('hosting:channel:deploy', 'lite', '--expires', '7d', '--project', project,
      '--config', join(temp, 'firebase.json'), '--non-interactive');
  }
} finally {
  if (!prepared) await rm(temp, { recursive: true, force: true });
}
