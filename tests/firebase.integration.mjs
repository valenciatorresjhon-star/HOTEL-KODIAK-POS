import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, onSnapshot, collection, getDocs, disableNetwork, enableNetwork } from 'firebase/firestore';
import { build } from 'esbuild';

const projectId = 'demo-hotel-kodiak';
assert.equal(process.env.GCLOUD_PROJECT, projectId, 'Solo se permite el proyecto demo.');
const env = await initializeTestEnvironment({
  projectId,
  firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('config/firestore.staging.rules', 'utf8') }
});
const results = [];
// El servicio de la aplicación guarda caché de navegador tras confirmar Firestore.
const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key)
};
const apps = [];
async function check(name, fn) {
  await fn();
  results.push({ name, passed: true });
  console.log('PASS', name);
}
const collections = ['hotel_rooms','hotel_clients','hotel_products','hotel_sales','hotel_expenses','hotel_shifts',
'hotel_shift_closures','hotel_reservations','hotel_settings','hotel_movements','hotel_inventory_movements',
'hotel_stock_movements','hotel_stock_alerts','hotel_audit_logs','hotel_extra_hours','hotel_checkout_events',
'hotel_cash_drawer_logs','hotel_printer_errors','hotel_printer_logs'];
try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    for (const [uid, rol, activo] of [['admin','admin',true],['reception','recepcionista',true],['viewer','visor',true],['inactive','admin',false]]) {
      await setDoc(doc(db,'hotel_users',uid), { uid, rol, activo, nombre:uid });
    }
    for (const name of collections) await setDoc(doc(db,name,'fixture'), { prueba: true, stock: 2 });
  });
  const viewer = env.authenticatedContext('viewer').firestore();
  const reception = env.authenticatedContext('reception').firestore();
  const admin = env.authenticatedContext('admin').firestore();
  await check('Visor: lectura y rechazo de crear, editar y borrar en las 19 colecciones', async () => {
    for (const name of collections) {
      await assertSucceeds(getDoc(doc(viewer,name,'fixture')));
      await assertFails(setDoc(doc(viewer,name,'new'),{ prueba:true }));
      await assertFails(updateDoc(doc(viewer,name,'fixture'),{ prueba:false }));
      await assertFails(deleteDoc(doc(viewer,name,'fixture')));
    }
  });
  await check('Sin sesión, sin perfil, inactivo y correo admin sin rol: acceso denegado', async () => {
    for (const ctx of [env.unauthenticatedContext(),env.authenticatedContext('unknown'),
      env.authenticatedContext('inactive'),env.authenticatedContext('impostor',{email:'admin@hotelkodiak.com'})]) {
      await assertFails(getDoc(doc(ctx.firestore(),'hotel_rooms','fixture')));
      await assertFails(setDoc(doc(ctx.firestore(),'hotel_users',ctx.auth?.uid || 'impostor'),{rol:'admin',activo:true}));
    }
  });
  await check('Recepción no cambia roles, configuración, ventas ni cierres históricos', async () => {
    await assertFails(updateDoc(doc(reception,'hotel_users','reception'),{rol:'admin'}));
    await assertFails(setDoc(doc(reception,'hotel_settings','fixture'),{prueba:false}));
    for (const name of ['hotel_sales','hotel_shift_closures']) {
      await assertFails(updateDoc(doc(reception,name,'fixture'),{prueba:false}));
      await assertFails(deleteDoc(doc(reception,name,'fixture')));
    }
    await assertSucceeds(setDoc(doc(reception,'hotel_sales','new'),{prueba:true}));
    await assertSucceeds(updateDoc(doc(admin,'hotel_settings','fixture'),{prueba:true}));
  });
  await check('Tiempo real entre dos clientes SDK: habitación, venta y turno', async () => {
    for (const name of ['hotel_rooms','hotel_sales','hotel_shifts']) {
      const id = 'realtime-' + name;
      let stop;
      const arrived = new Promise((resolve,reject) => {
        const timeout = setTimeout(()=>reject(new Error('No llegó el snapshot: '+name)),10000);
        stop = onSnapshot(doc(viewer,name,id), snap => {
          if (snap.exists() && snap.data().marker === id && !snap.metadata.fromCache) {
            clearTimeout(timeout); resolve();
          }
        }, reject);
      });
      try {
        await setDoc(doc(reception,name,id),{marker:id,prueba:true});
        await arrived;
      } finally { stop?.(); }
    }
  });
  await check('Reconexión del visor recibe el estado del servidor sin sobrescribirlo', async () => {
    await setDoc(doc(reception,'hotel_rooms','reconnect'),{estado:'Disponible',prueba:true});
    await getDoc(doc(viewer,'hotel_rooms','reconnect'));
    await disableNetwork(viewer);
    await updateDoc(doc(reception,'hotel_rooms','reconnect'),{estado:'Ocupada'});
    await enableNetwork(viewer);
    let stop;
    await new Promise((resolve,reject) => {
      const timeout = setTimeout(()=>reject(new Error('Reconexión sin snapshot de servidor')),10000);
      stop = onSnapshot(doc(viewer,'hotel_rooms','reconnect'),snapshot=>{
        if (!snapshot.metadata.fromCache && snapshot.data()?.estado==='Ocupada') {
          clearTimeout(timeout); resolve();
        }
      },reject);
    }).finally(()=>stop?.());
    assert.equal((await getDoc(doc(reception,'hotel_rooms','reconnect'))).data().estado,'Ocupada');
  });
  await check('Autenticación de la aplicación y venta simultánea real: stock 1, solo una venta; reintento sin duplicado', async () => {
    await build({entryPoints:['src/services/firebaseService.ts'],bundle:true,platform:'node',format:'esm',
      packages:'external',outfile:'tests/service.generated.mjs',
      define:{'import.meta.env':JSON.stringify({
        MODE:'staging',VITE_FIREBASE_API_KEY:'demo-key',VITE_FIREBASE_PROJECT_ID:projectId,
        VITE_FIREBASE_APP_ID:'demo-app',VITE_FIREBASE_AUTH_DOMAIN:projectId+'.firebaseapp.com',
        VITE_USE_FIREBASE_EMULATORS:'true',VITE_FIREBASE_EMULATOR_HOST:'127.0.0.1'
      })}});
    const { getAuth: getDefaultAuth } = await import('firebase/auth');
    const svc = await import('./service.generated.mjs');
    const auth = getDefaultAuth();
    const credential = await createUserWithEmailAndPassword(auth,'reception-test@example.test','SoloPruebas2026!');
    const uid = credential.user.uid;
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(),'hotel_users',uid),{uid,rol:'recepcionista',activo:true,nombre:'Recepción ficticia'});
      await setDoc(doc(ctx.firestore(),'hotel_products','concurrency'),{id:'concurrency',stock:1,stockMinimo:0});
    });
    await signOut(auth);
    const login = await svc.loginUser('reception-test@example.test','SoloPruebas2026!');
    assert.equal(login.profile.rol,'recepcionista');
    const sales = ['concurrent-a','concurrent-b'].map(id=>({id,total:1000,metodoPago:'Efectivo',prueba:true}));
    const outcomes = await Promise.allSettled(sales.map(s=>svc.saveSaleAndDecrementStock(s,{id:'concurrency',qty:1})));

    assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
    const winner = sales[outcomes.findIndex(x=>x.status==='fulfilled')];
    await svc.saveSaleAndDecrementStock(winner,{id:'concurrency',qty:1});
    assert.equal((await getDoc(doc(viewer,'hotel_products','concurrency'))).data().stock,0);
    const all = await getDocs(collection(viewer,'hotel_sales'));
    assert.equal(all.docs.filter(d=>d.id.startsWith('concurrent-')).length,1);
    await signOut(auth);
    const app2 = initializeApp({apiKey:'demo-key',projectId},'no-profile');
    apps.push(app2);
    const auth2 = getAuth(app2); connectAuthEmulator(auth2,'http://127.0.0.1:9099',{disableWarnings:true});
    await createUserWithEmailAndPassword(auth2,'admin-impostor@example.test','SoloPruebas2026!');
    await assert.rejects(()=>svc.loginUser('admin-impostor@example.test','SoloPruebas2026!'));
    assert.equal(svc.cachedUserProfile,null);
    const viewerCred = await createUserWithEmailAndPassword(auth2,'viewer-test@example.test','SoloPruebas2026!');
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(),'hotel_users',viewerCred.user.uid),{
        uid:viewerCred.user.uid,rol:'visor',activo:true,nombre:'Propietario ficticio'
      });
    });
    await svc.loginUser('viewer-test@example.test','SoloPruebas2026!');
    storage.set('hotel_rooms',JSON.stringify([{id:'stale-local-room',estado:'Disponible'}]));
    globalThis.window = {localStorage:globalThis.localStorage, dispatchEvent:()=>true};
    let stop;
    try {
      const emissions = [];
      await new Promise((resolve,reject)=>{
        const timeout = setTimeout(()=>reject(new Error('Visor sin respuesta')),10000);
        stop = svc.subscribeToCollection('hotel_rooms',items=>{
          emissions.push(items);
          if (items.some(item=>item.id==='reconnect')) { clearTimeout(timeout); resolve(); }
        });
      });
      assert.ok(emissions.every(items=>!items.some(item=>item.id==='stale-local-room')));
      const queued = await svc.syncPendingOperationsToFirestore();
      assert.equal(queued.success,false);
      results.push({name:'Visor de la aplicación omite caché local antiguo y no vacía cola de escrituras',passed:true});
    } finally {
      stop?.(); delete globalThis.window;
    }
    await signOut(auth);
    await signOut(auth2);
    await deleteApp((await import('firebase/app')).getApp());
  });
  await writeFile('tests/results.json',JSON.stringify({projectId,scope:'Emuladores; no dispositivos físicos',results},null,2));
} finally {
  await Promise.all(apps.map(deleteApp));
  await env.cleanup();
}




