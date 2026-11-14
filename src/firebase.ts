import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, Auth } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, Firestore } from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || ''
};

console.log("Firebase projectId:", firebaseConfig.projectId || "(no configurado)");

export const isFirebaseConfigured: boolean = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.apiKey !== '' &&
  firebaseConfig.projectId !== ''
);

const useEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';
if (useEmulators && !firebaseConfig.projectId.startsWith('demo-')) {
  throw new Error('Las pruebas locales requieren un proyecto demo- sin recursos reales.');
}
if (import.meta.env.MODE === 'staging' && !useEmulators) {
  throw new Error('La configuración staging local requiere emuladores.');
}

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

if (isFirebaseConfigured) {
  try {
    appInstance = getApps().some(app => app.name === '[DEFAULT]') ? getApp() : initializeApp(firebaseConfig);
    authInstance = getAuth(appInstance);
    dbInstance = getFirestore(appInstance);
    if (useEmulators) {
      const host = import.meta.env.VITE_FIREBASE_EMULATOR_HOST || '127.0.0.1';
      connectAuthEmulator(authInstance, 'http://' + host + ':9099', { disableWarnings: true });
      connectFirestoreEmulator(dbInstance, host, 8080);
    }
  } catch (error) {
    console.warn('[Firebase] Error initializing Firebase:', error);
  }
}

export const app = appInstance as FirebaseApp;
export const auth = authInstance as Auth;
export const db = dbInstance as Firestore;
