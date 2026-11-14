import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { build } from 'esbuild';
import assert from 'node:assert/strict';

const projectId = 'demo-hotel-kodiak';
assert.equal(process.env.GCLOUD_PROJECT, projectId, 'Solo se permite cargar datos ficticios en demo-hotel-kodiak.');
assert.ok(process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:') || process.env.FIRESTORE_EMULATOR_HOST?.startsWith('localhost:'));
await build({entryPoints:['src/kodiakRules.ts'],bundle:true,platform:'node',format:'esm',outfile:'tests/catalog.generated.mjs'});
const { buildOfficialRoomsFromExisting, KODIAK_OFFICIAL_ROOMS } = await import('./catalog.generated.mjs');
assert.equal(KODIAK_OFFICIAL_ROOMS.length,17);
const env = await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8080}});
const password = 'SoloPruebas2026!';
try {
  for (const [rol,nombre,email] of [
    ['admin','Administrador ficticio','admin@example.test'],
    ['recepcionista','ALICIA','alicia@example.test'],
    ['visor','Propietario ficticio','propietario@example.test']
  ]) {
    const app = initializeApp({apiKey:'demo-key',projectId},'seed-'+rol);
    try {
      const auth = getAuth(app);
      connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
      let credential;
      try { credential = await createUserWithEmailAndPassword(auth,email,password); }
      catch (error) {
        if (error.code !== 'auth/email-already-in-use') throw error;
        credential = await signInWithEmailAndPassword(auth,email,password);
      }
      await env.withSecurityRulesDisabled(async ctx=>{
        const ref = doc(ctx.firestore(),'hotel_users',credential.user.uid);
        if (!(await getDoc(ref)).exists()) await setDoc(ref,{
          uid:credential.user.uid,nombre,email,rol,activo:true,createdAt:new Date().toISOString()
        });
      });
      console.log('Cuenta ficticia:',email,'rol:',rol);
    } finally { await deleteApp(app); }
  }
  await env.withSecurityRulesDisabled(async ctx=>{
    for (const room of buildOfficialRoomsFromExisting([])) {
      const ref = doc(ctx.firestore(),'hotel_rooms',room.id);
      if (!(await getDoc(ref)).exists()) await setDoc(ref,JSON.parse(JSON.stringify({...room,prueba:true})));
    }
  });
  console.log('17 habitaciones de demostración; no se copiaron datos reales.');
  console.log('Contraseña exclusiva del emulador:',password);
} finally { await env.cleanup(); }
