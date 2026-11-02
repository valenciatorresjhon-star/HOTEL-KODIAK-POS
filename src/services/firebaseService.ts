import { auth, db, isFirebaseConfigured, firebaseConfig } from '../firebase';
import { 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  writeBatch,
  runTransaction,
  onSnapshot, 
  serverTimestamp, 
  query, 
  orderBy, 
  limit,
  Timestamp
} from 'firebase/firestore';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  User as FirebaseUserObject
} from 'firebase/auth';
import { 
  Room, 
  Client, 
  Product, 
  Sale, 
  Expense, 
  Shift, 
  ShiftClosure, 
  Reservation, 
  FirebaseUser, 
  UserRole, 
  getEmployeeProfile, 
  OFFICIAL_KODIAK_PRODUCTS,
  matchOfficialProduct,
  normalizeProductName,
  OfficialProductDefinition,
  INITIAL_PRODUCTS_DATA,
  isProductVisible,
  isProductArchivedOrHidden,
  getCanonicalProductName
} from '../types';
import { safeGetLocalStorage, safeSetLocalStorage, loadInitialRooms, loadInitialProducts } from '../utils/storage';
import { reconcileAndSyncKodiakProducts } from './productSyncService';
export { reconcileAndSyncKodiakProducts } from './productSyncService';

// Helper utility to deep-sanitize data before sending to Firestore.
// It removes any properties that are undefined, as Firestore doesn't support undefined.
export function sanitizeForFirestore<T>(data: T): T {
  if (data === undefined) {
    return null as any;
  }
  if (data === null) {
    return null as any;
  }
  if (Array.isArray(data)) {
    return data.map(item => sanitizeForFirestore(item)) as any;
  }
  if (typeof data === 'object') {
    if (data instanceof Date) {
      return data;
    }
    // Handle Firestore FieldValue, Timestamp, or other special SDK/platform classes
    const proto = Object.getPrototypeOf(data);
    if (proto && proto.constructor && proto.constructor.name !== 'Object') {
      return data;
    }
    
    const cleanObj: any = {};
    for (const key of Object.keys(data)) {
      const val = (data as any)[key];
      if (val !== undefined) {
        cleanObj[key] = sanitizeForFirestore(val);
      }
    }
    return cleanObj as T;
  }
  return data;
}

// ==========================================
// LOCAL MODE PUB/SUB SYSTEM FOR FALLBACK
// ==========================================

interface LocalListener {
  collectionName: string;
  callback: (data: any[]) => void;
}
const localListeners: LocalListener[] = [];

const notifyLocalListeners = (collectionName: string) => {
  const matching = localListeners.filter(l => l.collectionName === collectionName);
  const stored = localStorage.getItem(collectionName);
  let data: any[] = [];
  if (stored) {
    try {
      data = JSON.parse(stored);
    } catch (e) {}
  } else {
    if (collectionName === 'hotel_rooms') data = loadInitialRooms();
    else if (collectionName === 'hotel_products') data = loadInitialProducts();
  }

  data = normalizeProductCollectionForStorage(collectionName, data);
  matching.forEach(l => l.callback(data));
};

// ==========================================
// MODO POS SEGURO: CACHE LOCAL + COLA DE SINCRONIZACIÓN
// ==========================================
// Regla del Hotel Kodiak: ningún cambio importante debe vivir solo en pantalla.
// Primero se guarda en este computador, después se intenta subir a Firebase.
// Si falla internet/Firebase/permisos temporales, queda en hotel_pending_sync
// para reintentar cuando vuelva conexión.

const PENDING_SYNC_KEY = 'hotel_pending_sync';

type PendingSyncOperation = {
  id: string;
  collectionName: string;
  docId: string;
  data: any;
  op: 'set' | 'delete';
  merge?: boolean;
  createdAt: string;
  lastError?: string;
  attempts?: number;
};

function hasBrowserStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function toLocalPlainValue(value: any): any {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();

  // Firestore Timestamp
  if (value && typeof value.toDate === 'function') {
    try {
      return value.toDate().toISOString();
    } catch (e) {
      return new Date().toISOString();
    }
  }

  if (Array.isArray(value)) {
    return value.map(toLocalPlainValue);
  }

  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    const constructorName = proto?.constructor?.name || '';

    // Firestore serverTimestamp() FieldValue and other SDK internals are not JSON-safe.
    // For cache/queue purposes we replace them with current local time.
    if (constructorName && constructorName !== 'Object') {
      return new Date().toISOString();
    }

    const clean: any = {};
    for (const key of Object.keys(value)) {
      clean[key] = toLocalPlainValue(value[key]);
    }
    return clean;
  }

  return value;
}

function getDocKey(item: any): string {
  // Para documentos provenientes de Firestore, el identificador real del documento
  // tiene prioridad sobre un campo `id` antiguo guardado dentro de los datos.
  return String(
    item?.firestoreId ||
    item?.documentId ||
    item?.docId ||
    item?.id ||
    ''
  );
}

function getDateMs(value: any): number {
  if (!value) return 0;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value?.toMillis === 'function') {
    try {
      return value.toMillis();
    } catch (e) {
      return 0;
    }
  }
  if (typeof value?.toDate === 'function') {
    try {
      return value.toDate().getTime();
    } catch (e) {
      return 0;
    }
  }
  return 0;
}

function getRecordVersionMs(item: any): number {
  return Math.max(
    getDateMs(item?.updatedAt),
    getDateMs(item?.clientUpdatedAt),
    getDateMs(item?.releasedAt),
    getDateMs(item?.closedAt),
    getDateMs(item?.createdAt),
    getDateMs(item?.fechaActualizacion)
  );
}

function forceArchiveProductIfHidden(product: any): any {
  if (!product) return product;
  if (!isProductArchivedOrHidden(product)) return product;

  const now = new Date().toISOString();
  return {
    ...product,
    activo: false,
    archivado: true,
    oculto: true,
    visible: false,
    eliminado: true,
    deleted: true,
    isDeleted: true,
    estado: 'Archivado',
    status: 'archived',
    desactivadoAt: product?.desactivadoAt || product?.deletedAt || now,
    deletedAt: product?.deletedAt || product?.desactivadoAt || now,
    motivoDesactivacion: product?.motivoDesactivacion || 'Producto oculto/archivado por regla de catálogo Hotel Kodiak',
    updatedAt: product?.updatedAt || now,
    clientUpdatedAt: product?.clientUpdatedAt || now
  };
}

function normalizeProductCollectionForStorage<T = any>(collectionName: string, items: T[]): T[] {
  if (collectionName !== 'hotel_products') return items;
  const rawList = Array.isArray(items) ? items : [];
  const byCanonical = new Map<string, any>();
  const recordMs = (item: any) => {
    const vals = [item?.lastMovementAt, item?.clientUpdatedAt, item?.updatedAt];
    return Math.max(0, ...vals.map((value) => {
      const ms = Date.parse(String(value || ''));
      return Number.isFinite(ms) ? ms : 0;
    }));
  };

  for (const rawItem of rawList) {
    if (!rawItem) continue;
    const canonical = getCanonicalProductName(rawItem.nombre || rawItem.name);
    if (!canonical) continue;
    const item = forceArchiveProductIfHidden({ ...rawItem, nombre: canonical });
    const existing = byCanonical.get(canonical);
    if (!existing ||
      (isProductVisible(item) && !isProductVisible(existing)) ||
      (isProductVisible(item) === isProductVisible(existing) && recordMs(item) > recordMs(existing))) {
      byCanonical.set(canonical, item);
    }
  }
  return Array.from(byCanonical.values()) as any;
}

function normalizeShiftCollectionForStorage<T = any>(collectionName: string, items: T[]): T[] {
  if (collectionName !== 'hotel_shifts') return items;
  return (Array.isArray(items) ? items : []).map((item: any) => {
    if (item && item.estado === 'abierto' && (item.baseInicial === 668500 || item.baseConfirmadaApertura === 668500)) {
      return {
        ...item,
        baseInicial: 0,
        baseConfirmadaApertura: 0
      };
    }
    return item;
  }) as any;
}

function loadLocalCollection<T = any>(collectionName: string): T[] {
  if (!hasBrowserStorage()) return [];

  try {
    const raw = window.localStorage.getItem(collectionName);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return normalizeShiftCollectionForStorage(collectionName, normalizeProductCollectionForStorage(collectionName, parsed)) as any;
      if (parsed && typeof parsed === 'object') return normalizeShiftCollectionForStorage(collectionName, normalizeProductCollectionForStorage(collectionName, [parsed])) as any;
    }

    if (collectionName === 'hotel_rooms') return loadInitialRooms() as any;
    if (collectionName === 'hotel_products') return normalizeProductCollectionForStorage(collectionName, loadInitialProducts()) as any;
    if (collectionName === 'hotel_settings') {
      const localSettings = safeGetLocalStorage('hotel_settings', DEFAULT_KODIAK_CONFIG);
      return [localSettings] as any;
    }
  } catch (error) {
    console.warn(`No se pudo leer cache local de ${collectionName}:`, error);
  }

  return [];
}

function saveLocalCollection(collectionName: string, items: any[]) {
  if (!hasBrowserStorage()) return;

  try {
    const normalizedItems = normalizeShiftCollectionForStorage(collectionName, normalizeProductCollectionForStorage(collectionName, items));
    safeSetLocalStorage(collectionName, normalizedItems.map(toLocalPlainValue));
  } catch (error) {
    console.warn(`No se pudo guardar cache local de ${collectionName}:`, error);
  }

  notifyLocalListeners(collectionName);
}

function mergeCollectionsPreferNewest(collectionName: string, remoteItems: any[]): any[] {
  const localItems = loadLocalCollection(collectionName);
  const map = new Map<string, any>();

  for (const item of remoteItems || []) {
    const key = getDocKey(item);
    if (key) {
      map.set(key, item);
    }
  }

  for (const localItem of localItems || []) {
    const key = getDocKey(localItem);
    if (!key) continue;

    const remoteItem = map.get(key);
    if (!remoteItem) {
      if (collectionName === 'hotel_products') {
        // En hotel_products, Firebase es la ÚNICA FUENTE DE VERDAD.
        // NO resucitar productos desde localStorage si no existen en Firebase,
        // a menos que sea una operación explícitamente pendiente de sincronizar por estar offline.
        if (localItem?.syncPending === true || localItem?.sincronizacionPendiente === true) {
          map.set(key, localItem);
        }
        continue;
      }
      map.set(key, localItem);
      continue;
    }

    const localMs = getRecordVersionMs(localItem);
    const remoteMs = getRecordVersionMs(remoteItem);

    // Si el local está marcado como pendiente, debe ganar hasta que Firebase lo reciba.
    if (localItem?.syncPending === true || localItem?.sincronizacionPendiente === true || localMs > remoteMs) {
      map.set(key, { ...remoteItem, ...localItem });
    }

    // Regla de seguridad para productos: si fue archivado local o remotamente, preservar las banderas de archivo
    if (collectionName === 'hotel_products') {
      const currentMerged = map.get(key);
      const isArchivedLocally = localItem?.activo === false || localItem?.archivado === true || localItem?.oculto === true;
      const isArchivedRemotely = remoteItem?.activo === false || remoteItem?.archivado === true || remoteItem?.oculto === true;
      if (isArchivedLocally || isArchivedRemotely) {
        // Solo desarchivar si la versión más reciente explícitamente tiene activo: true con fecha superior
        const latestMs = Math.max(localMs, remoteMs);
        const latestItem = localMs >= remoteMs ? localItem : remoteItem;
        if (latestItem?.activo !== true) {
          map.set(key, {
            ...currentMerged,
            activo: false,
            archivado: true,
            oculto: true,
            visible: false,
            eliminado: true,
            deleted: true,
            estado: 'Archivado'
          });
        }
      }
    }

    // Regla de sanitización para productos: reemplazar cualquier SPINAX por SPEEDMAX
    if (collectionName === 'hotel_products') {
      const currentMerged = map.get(key);
      if (currentMerged) {
        const norm = normalizeProductName(currentMerged.nombre);
        if (norm === 'SPINAX' || norm.includes('SPINAX')) {
          map.set(key, {
            ...currentMerged,
            nombre: 'SPEEDMAX',
            precio: currentMerged.precio || 4000,
            stock: (currentMerged.stock !== undefined && currentMerged.stock !== null && currentMerged.stock > 0) ? currentMerged.stock : 12,
            categoria: currentMerged.categoria || 'BEBIDAS',
            activo: true,
            archivado: false,
            oculto: false,
            visible: true
          });
        }
      }
    }

    // Regla de sanitización para turnos activos: corregir saldo legado de 668.500 a 0
    if (collectionName === 'hotel_shifts') {
      const currentMerged = map.get(key);
      if (currentMerged && currentMerged.estado === 'abierto' && (currentMerged.baseInicial === 668500 || currentMerged.baseConfirmadaApertura === 668500)) {
        map.set(key, {
          ...currentMerged,
          baseInicial: 0,
          baseConfirmadaApertura: 0
        });
      }
    }
  }

  let merged = Array.from(map.values());

  // Deduplicación para hotel_products: si quedó más de un SPEEDMAX por conversión de Spinax, dejar solo uno
  if (collectionName === 'hotel_products') {
    const seenSpeedmax = new Set<string>();
    const deduplicated: any[] = [];
    for (const item of merged) {
      const norm = normalizeProductName((item as any)?.nombre);
      if (norm === 'SPEEDMAX') {
        if (seenSpeedmax.has('SPEEDMAX')) {
          continue; // omitir duplicado
        }
        seenSpeedmax.add('SPEEDMAX');
      }
      deduplicated.push(item);
    }
    merged = deduplicated;
  }

  // Guardamos copia local de lo más reciente para que al cerrar/abrir no se pierda el estado.
  saveLocalCollection(collectionName, merged);

  return merged;
}

function upsertLocalDocument<T extends { id?: string }>(
  collectionName: string,
  docId: string,
  data: T,
  markPending: boolean = false
) {
  const now = new Date().toISOString();
  const plain = toLocalPlainValue({
    ...data,
    id: (data as any)?.id || docId,
    firestoreId: (data as any)?.firestoreId || docId,
    documentId: (data as any)?.documentId || docId,
    docId: (data as any)?.docId || docId,
    clientUpdatedAt: (data as any)?.clientUpdatedAt || now,
    ...(markPending ? { syncPending: true, sincronizacionPendiente: true } : {})
  });

  const list = loadLocalCollection(collectionName);
  const idx = list.findIndex((x: any) => getDocKey(x) === docId);

  if (idx >= 0) {
    list[idx] = { ...list[idx], ...plain };
  } else {
    list.push(plain);
  }

  saveLocalCollection(collectionName, list);
}

function loadPendingSync(): PendingSyncOperation[] {
  if (!hasBrowserStorage()) return [];
  try {
    const raw = window.localStorage.getItem(PENDING_SYNC_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("No se pudo leer la cola de sincronización:", error);
    return [];
  }
}

function savePendingSync(list: PendingSyncOperation[]) {
  if (!hasBrowserStorage()) return;
  try {
    safeSetLocalStorage(PENDING_SYNC_KEY, list);
  } catch (error) {
    console.warn("No se pudo guardar la cola de sincronización:", error);
  }
}

function queuePendingSync(collectionName: string, docId: string, data: any, op: 'set' | 'delete' = 'set', merge: boolean = true) {
  if (!hasBrowserStorage()) return;

  const pending = loadPendingSync();
  const id = `${collectionName}__${docId}`;
  const existingIdx = pending.findIndex((x) => x.id === id);

  const pendingItem: PendingSyncOperation = {
    id,
    collectionName,
    docId,
    data: toLocalPlainValue(data),
    op,
    merge,
    createdAt: new Date().toISOString(),
    attempts: existingIdx >= 0 ? (pending[existingIdx].attempts || 0) : 0
  };

  if (existingIdx >= 0) {
    pending[existingIdx] = { ...pending[existingIdx], ...pendingItem };
  } else {
    pending.push(pendingItem);
  }

  savePendingSync(pending);
  window.dispatchEvent(new CustomEvent("hotel_pending_sync_changed", { detail: pending.length }));
}

function removePendingSync(collectionName: string, docId: string) {
  const id = `${collectionName}__${docId}`;
  const pending = loadPendingSync().filter((x) => x.id !== id);
  savePendingSync(pending);
  if (hasBrowserStorage()) {
    window.dispatchEvent(new CustomEvent("hotel_pending_sync_changed", { detail: pending.length }));
  }
}

async function writeFirestoreSet(collectionName: string, docId: string, data: any, merge: boolean = true) {
  await setDoc(
    doc(db, collectionName, docId),
    sanitizeForFirestore(data),
    merge ? { merge: true } : undefined
  );
}

export async function syncPendingOperationsToFirestore(): Promise<{ success: boolean; remaining: number }> {
  if (!isFirebaseConfigured || !hasBrowserStorage()) {
    return { success: false, remaining: loadPendingSync().length };
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { success: false, remaining: loadPendingSync().length };
  }

  let pending = loadPendingSync();
  if (pending.length === 0) {
    return { success: true, remaining: 0 };
  }

  const stillPending: PendingSyncOperation[] = [];

  for (const item of pending) {
    try {
      if (item.op === 'delete') {
        await deleteDoc(doc(db, item.collectionName, item.docId));
      } else {
        await writeFirestoreSet(item.collectionName, item.docId, {
          ...item.data,
          syncPending: false,
          sincronizacionPendiente: false,
          syncedAt: new Date().toISOString()
        }, item.merge !== false);
      }

      const localList = loadLocalCollection(item.collectionName);
      const updatedLocal = localList.map((x: any) => {
        if (getDocKey(x) !== item.docId) return x;
        return {
          ...x,
          syncPending: false,
          sincronizacionPendiente: false,
          syncedAt: new Date().toISOString()
        };
      });
      saveLocalCollection(item.collectionName, updatedLocal);
    } catch (error: any) {
      stillPending.push({
        ...item,
        attempts: (item.attempts || 0) + 1,
        lastError: error?.message || String(error)
      });
      console.warn("Pendiente no sincronizado todavía:", item.collectionName, item.docId, error?.message || error);
    }
  }

  savePendingSync(stillPending);

  if (hasBrowserStorage()) {
    window.dispatchEvent(new CustomEvent("hotel_pending_sync_changed", { detail: stillPending.length }));
  }

  return { success: stillPending.length === 0, remaining: stillPending.length };
}

let pendingSyncAutoInstalled = false;

function installPendingSyncAutoFlush() {
  if (pendingSyncAutoInstalled || !hasBrowserStorage()) return;
  pendingSyncAutoInstalled = true;

  window.addEventListener('online', () => {
    syncPendingOperationsToFirestore().catch((error) => {
      console.warn("No se pudo sincronizar cola al volver internet:", error);
    });
  });

  window.setInterval(() => {
    const pending = loadPendingSync();
    if (pending.length > 0) {
      syncPendingOperationsToFirestore().catch((error) => {
        console.warn("No se pudo sincronizar cola pendiente:", error);
      });
    }
  }, 30000);
}

installPendingSyncAutoFlush();

async function saveDocumentSafely<T extends { id?: string }>(
  collectionName: string,
  docId: string,
  data: T,
  operation: 'create' | 'update' = 'create'
): Promise<void> {
  const safeDocId = docId || (data as any)?.id || `${collectionName}-${Date.now()}`;
  const now = new Date().toISOString();

  const localData = toLocalPlainValue({
    ...data,
    id: (data as any)?.id || safeDocId,
    updatedAt: (data as any)?.updatedAt || now,
    clientUpdatedAt: now
  });

  // 1. Guardado inmediato local para que sobreviva recarga, apagón o cierre de Chrome.
  upsertLocalDocument(collectionName, safeDocId, localData, false);

  // 2. Si no hay Firebase o no hay internet, queda en cache local y, si aplica, en cola.
  if (!isFirebaseConfigured) {
    return;
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    upsertLocalDocument(collectionName, safeDocId, localData, true);
    queuePendingSync(collectionName, safeDocId, localData, 'set', true);
    return;
  }

  // 3. Intento de subida a Firebase.
  try {
    await writeFirestoreSet(collectionName, safeDocId, {
      ...localData,
      syncPending: false,
      sincronizacionPendiente: false,
      syncedAt: new Date().toISOString()
    }, true);
    removePendingSync(collectionName, safeDocId);
  } catch (error) {
    logFirestoreError(operation, collectionName, safeDocId, error, 'firebaseService.ts');
    upsertLocalDocument(collectionName, safeDocId, localData, true);
    queuePendingSync(collectionName, safeDocId, localData, 'set', true);
    // No lanzamos error: el POS no puede perder la operación ni quedarse bloqueado.
  }
}


// ==========================================
// AUTHENTICATION & USER PROFILE SERVICES
// ==========================================

export const loginUser = async (email: string, pass: string) => {
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanPass = (pass || '').trim();

  if (!isFirebaseConfigured || !auth) {
    let rol: 'admin' | 'recepcionista' | 'visor' = 'admin';
    let nombre = 'Administrador Local';
    
    if (cleanEmail.includes('recep') || cleanEmail.includes('alicia') || cleanEmail.includes('paola') || cleanEmail.includes('mileydi')) {
      rol = 'recepcionista';
      nombre = 'Recepcionista Local';
    } else if (cleanEmail.includes('visor') || cleanEmail.includes('prop')) {
      rol = 'visor';
      nombre = 'Visor Local';
    }
    
    const mockProfile: FirebaseUser = {
      uid: 'local-uid-' + rol,
      nombre,
      email: cleanEmail,
      rol,
      activo: true,
      createdAt: new Date().toISOString()
    };
    cachedUserProfile = mockProfile;
    
    return {
      firebaseUser: { uid: mockProfile.uid, email: cleanEmail } as any,
      profile: mockProfile
    };
  }

  const credentials = await signInWithEmailAndPassword(auth, cleanEmail, cleanPass);
  const uid = credentials.user.uid;
  const userRef = doc(db, 'hotel_users', uid);

  try {
    let userDoc = await getDoc(userRef);
    
    // Si no existe el documento en hotel_users, lo creamos automáticamente para no bloquear el login
    if (!userDoc.exists()) {
      const defaultRole: UserRole = cleanEmail.includes('admin') ? 'admin' : (cleanEmail.includes('propietario') || cleanEmail.includes('visor') ? 'visor' : 'recepcionista');
      const empProf = getEmployeeProfile(cleanEmail);
      
      const newProfile: FirebaseUser = {
        uid,
        email: cleanEmail,
        nombre: empProf ? empProf.name : (credentials.user.displayName || cleanEmail.split('@')[0].toUpperCase()),
        nombreCompleto: empProf ? empProf.nombreCompleto : '',
        fechaNacimiento: empProf?.fechaNacimiento || '',
        fechaNacimientoTexto: empProf?.fechaNacimientoTexto || '',
        rol: defaultRole,
        activo: true,
        createdAt: new Date().toISOString()
      };

      try {
        await setDoc(userRef, sanitizeForFirestore(newProfile));
      } catch (writeErr) {
        console.warn("Aviso al crear documento de usuario en Firestore hotel_users:", writeErr);
      }

      cachedUserProfile = newProfile;
      return {
        firebaseUser: credentials.user,
        profile: newProfile
      };
    }

    const data = userDoc.data() as FirebaseUser;
    
    if (data.activo === false) {
      throw new Error(`El usuario está desactivado por administración.`);
    }

    // Automatically augment and synchronize employee fields in Firestore if available
    const empProf = getEmployeeProfile(cleanEmail || data.nombre);
    let needsUpdate = false;
    if (empProf && (!data.nombreCompleto || data.nombreCompleto !== empProf.nombreCompleto)) {
      data.nombreCompleto = empProf.nombreCompleto;
      data.fechaNacimiento = empProf.fechaNacimiento;
      data.fechaNacimientoTexto = empProf.fechaNacimientoTexto;
      data.nombre = empProf.name;
      needsUpdate = true;
    }

    if (needsUpdate) {
      try {
        await setDoc(userRef, sanitizeForFirestore(data), { merge: true });
      } catch (e) {
        console.warn("Could not save merged employee profile in loginUser:", e);
      }
    }

    cachedUserProfile = data;
    return {
      firebaseUser: credentials.user,
      profile: data
    };
  } catch (firestoreError: any) {
    if (firestoreError.message && firestoreError.message.includes('desactivado')) {
      throw firestoreError;
    }
    
    // Si hubo error de lectura por reglas o red temporal, proveer perfil seguro y continuar
    console.warn("Lectura de perfil en hotel_users con fallback:", firestoreError);
    const fallbackRol: UserRole = cleanEmail.includes('admin') ? 'admin' : (cleanEmail.includes('propietario') ? 'visor' : 'recepcionista');
    const fallbackProfile: FirebaseUser = {
      uid,
      email: cleanEmail,
      nombre: cleanEmail.split('@')[0].toUpperCase(),
      nombreCompleto: '',
      rol: fallbackRol,
      activo: true,
      createdAt: new Date().toISOString()
    };
    cachedUserProfile = fallbackProfile;
    return {
      firebaseUser: credentials.user,
      profile: fallbackProfile
    };
  }
};

export const registerUser = async (email: string, pass: string, nombre: string, rol: UserRole) => {
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanPass = (pass || '').trim();
  const empProf = getEmployeeProfile(cleanEmail || nombre);

  if (!isFirebaseConfigured || !auth) {
    const profile: FirebaseUser = {
      uid: 'local-uid-' + Math.random().toString(36).substring(7),
      nombre: empProf ? empProf.name : nombre,
      email: cleanEmail,
      rol,
      activo: true,
      createdAt: new Date().toISOString()
    };
    if (empProf) {
      profile.nombreCompleto = empProf.nombreCompleto;
      profile.fechaNacimiento = empProf.fechaNacimiento;
      profile.fechaNacimientoTexto = empProf.fechaNacimientoTexto;
    }
    cachedUserProfile = profile;
    return {
      firebaseUser: { uid: profile.uid, email: cleanEmail } as any,
      profile
    };
  }

  const credentials = await createUserWithEmailAndPassword(auth, cleanEmail, cleanPass);
  const profile: FirebaseUser = {
    uid: credentials.user.uid,
    nombre: empProf ? empProf.name : nombre,
    email: cleanEmail,
    rol,
    activo: true,
    createdAt: new Date().toISOString()
  };
  if (empProf) {
    profile.nombreCompleto = empProf.nombreCompleto;
    profile.fechaNacimiento = empProf.fechaNacimiento;
    profile.fechaNacimientoTexto = empProf.fechaNacimientoTexto;
  }
  
  try {
    await setDoc(doc(db, 'hotel_users', credentials.user.uid), sanitizeForFirestore(profile));
    cachedUserProfile = profile;
  } catch (error) {
    logFirestoreError('create', 'hotel_users', credentials.user.uid, error, 'firebaseService.ts');
  }
  return {
    firebaseUser: credentials.user,
    profile
  };
};

export let cachedUserProfile: FirebaseUser | null = null;

export const logFirestoreError = (
  operation: 'read' | 'create' | 'update' | 'delete',
  collectionName: string,
  docId: string,
  error: any,
  fileName: string
) => {
  const errMsg = error instanceof Error ? error.message : String(error?.message || error || '');
  console.warn(`[Firestore Notice] Operación '${operation}' en '${collectionName}/${docId}' (${fileName}): ${errMsg}`);
};

export const logoutUser = async () => {
  cachedUserProfile = null;
  if (!isFirebaseConfigured || !auth) {
    return;
  }
  try {
    await signOut(auth);
  } catch (err) {
    console.warn("logoutUser warning while signing out from Firebase:", err);
  }
};

export const getUserProfile = async (uid: string): Promise<FirebaseUser | null> => {
  if (!isFirebaseConfigured) {
    let rol: 'admin' | 'recepcionista' | 'visor' = 'admin';
    let nombre = 'Administrador Local';
    if (uid.includes('recep') || uid.includes('alicia')) {
      rol = 'recepcionista';
      nombre = 'Recepcionista Local';
    } else if (uid.includes('visor') || uid.includes('prop')) {
      rol = 'visor';
      nombre = 'Visor Local';
    }
    const localProf: FirebaseUser = {
      uid,
      nombre,
      email: `${rol}@hotelkodiak.com`,
      rol,
      activo: true,
      createdAt: new Date().toISOString()
    };
    const empProf = getEmployeeProfile(localProf.email || localProf.nombre);
    if (empProf) {
      localProf.nombre = empProf.name;
      localProf.nombreCompleto = empProf.nombreCompleto;
      localProf.fechaNacimiento = empProf.fechaNacimiento;
      localProf.fechaNacimientoTexto = empProf.fechaNacimientoTexto;
    }
    cachedUserProfile = localProf;
    return localProf;
  }

  try {
    const userDoc = await getDoc(doc(db, 'hotel_users', uid));
    if (userDoc.exists()) {
      const data = userDoc.data() as FirebaseUser;
      if (data.activo !== false) {
        const empProf = getEmployeeProfile(data.email || data.nombre);
        if (empProf && (!data.nombreCompleto || data.nombreCompleto !== empProf.nombreCompleto)) {
          data.nombre = empProf.name;
          data.nombreCompleto = empProf.nombreCompleto;
          data.fechaNacimiento = empProf.fechaNacimiento;
          data.fechaNacimientoTexto = empProf.fechaNacimientoTexto;
          try {
            await setDoc(doc(db, 'hotel_users', uid), sanitizeForFirestore(data), { merge: true });
          } catch (e) {
            console.warn("Could not save merged employee profile in getUserProfile:", e);
          }
        }
        cachedUserProfile = data;
        return data;
      }
      return null;
    } else {
      // Auto-provision if user exists in Firebase Auth but missing doc in hotel_users
      const currentEmail = (auth.currentUser?.email || '').trim().toLowerCase();
      const defaultRole: UserRole = currentEmail.includes('admin') ? 'admin' : (currentEmail.includes('propietario') || currentEmail.includes('visor') ? 'visor' : 'recepcionista');
      const empProf = getEmployeeProfile(currentEmail);
      
      const newProfile: FirebaseUser = {
        uid,
        email: currentEmail,
        nombre: empProf ? empProf.name : (auth.currentUser?.displayName || currentEmail.split('@')[0].toUpperCase()),
        nombreCompleto: empProf ? empProf.nombreCompleto : '',
        fechaNacimiento: empProf?.fechaNacimiento || '',
        fechaNacimientoTexto: empProf?.fechaNacimientoTexto || '',
        rol: defaultRole,
        activo: true,
        createdAt: new Date().toISOString()
      };

      try {
        await setDoc(doc(db, 'hotel_users', uid), sanitizeForFirestore(newProfile));
      } catch (writeErr) {
        console.warn("Aviso al auto-provisionar usuario en getUserProfile:", writeErr);
      }
      cachedUserProfile = newProfile;
      return newProfile;
    }
  } catch (error) {
    logFirestoreError('read', 'hotel_users', uid, error, 'firebaseService.ts');
    // Fallback safe profile in case of network glitch
    const currentEmail = (auth.currentUser?.email || '').trim().toLowerCase();
    if (currentEmail) {
      const fallbackRole: UserRole = currentEmail.includes('admin') ? 'admin' : (currentEmail.includes('propietario') ? 'visor' : 'recepcionista');
      const fallbackProfile: FirebaseUser = {
        uid,
        email: currentEmail,
        nombre: currentEmail.split('@')[0].toUpperCase(),
        nombreCompleto: '',
        rol: fallbackRole,
        activo: true,
        createdAt: new Date().toISOString()
      };
      cachedUserProfile = fallbackProfile;
      return fallbackProfile;
    }
    return null;
  }
};

// ==========================================
// DATABASE REALTIME LISTENERS (onSnapshot)
// ==========================================


export const subscribeToCollection = <T>(
  collectionName: string, 
  callback: (data: T[]) => void,
  orderField?: string,
  direction: 'asc' | 'desc' = 'asc'
) => {
  if (!isFirebaseConfigured) {
    const listener = { collectionName, callback };
    localListeners.push(listener);

    let data = loadLocalCollection<T>(collectionName);

    // También reparar el catálogo en modo local. Antes se devolvía directamente
    // un localStorage viejo (por ejemplo, solo 4 productos) y el Preview quedaba
    // atrapado en ese estado aunque el código ya tuviera los productos nuevos.
    if (collectionName === 'hotel_products') {
      const source = (data.length > 0 ? data : loadInitialProducts()) as any[];
      const { consolidated } = reconcileAndSyncKodiakProducts(
        source,
        async () => {},
        async () => {}
      );
      data = consolidated as any;
      saveLocalCollection('hotel_products', consolidated);
    }

    if (orderField) {
      data.sort((a: any, b: any) => {
        const valA = a[orderField] || '';
        const valB = b[orderField] || '';
        return direction === 'asc'
          ? String(valA).localeCompare(String(valB))
          : String(valB).localeCompare(String(valA));
      });
    }

    callback(data as T[]);

    return () => {
      const idx = localListeners.indexOf(listener);
      if (idx !== -1) {
        localListeners.splice(idx, 1);
      }
    };
  }

  // Mostrar inmediatamente un respaldo local REPARADO mientras llega Firestore.
  // Así la interfaz nunca se queda mostrando un catálogo antiguo de 4 productos.
  let localCached = loadLocalCollection<T>(collectionName);
  if (collectionName === 'hotel_products') {
    const source = (localCached.length > 0 ? localCached : loadInitialProducts()) as any[];
    const { consolidated } = reconcileAndSyncKodiakProducts(
      source,
      async () => {},
      async () => {}
    );
    localCached = consolidated as any;
    saveLocalCollection('hotel_products', consolidated);
  }
  if (localCached.length > 0) {
    callback(localCached as T[]);
  }

  const colRef = collection(db, collectionName);
  const q = orderField ? query(colRef, orderBy(orderField, direction)) : colRef;

  return onSnapshot(q, (snapshot) => {
    const remoteItems: any[] = [];
    snapshot.forEach((docSnap) => {
      remoteItems.push({ 
        ...docSnap.data(),
        id: docSnap.id,
        firestoreId: docSnap.id,
        documentId: docSnap.id,
        docId: docSnap.id 
      });
    });

    if (collectionName === 'hotel_products') {
      console.log("Firebase projectId:", firebaseConfig.projectId || "(no configurado)");
      console.log("Colección productos:", collectionName);
      console.log("Productos recibidos desde Firebase:", remoteItems.map((p: any) => `${p.nombre || p.name || 'Sin nombre'} (${p.stock ?? 0})`));
      console.log("Cantidad:", remoteItems.length);

      // Firebase es la ÚNICA FUENTE DE VERDAD.
      // Reconciliamos nombres canónicos, consolidamos duplicados y garantizamos catálogo dinámico.
      // Protección del catálogo: una lectura de Firebase NUNCA debe
      // crear productos, archivar duplicados ni corregir precios/stock.
      // El listado consolidado es solo una representación para la pantalla.
      // Todas las modificaciones persistentes requieren una acción explícita.
      const { consolidated } = reconcileAndSyncKodiakProducts(
        remoteItems,
        async () => {},
        async () => {}
      );
      saveLocalCollection('hotel_products', consolidated);

      if (orderField) {
        consolidated.sort((a: any, b: any) => {
          const valA = a[orderField] || '';
          const valB = b[orderField] || '';
          return direction === 'asc'
            ? String(valA).localeCompare(String(valB))
            : String(valB).localeCompare(String(valA));
        });
      }

      callback(consolidated as T[]);

      syncPendingOperationsToFirestore().catch((error) => {
        console.warn("No se pudo sincronizar pendientes después de recibir snapshot:", error);
      });

      return;
    }

    const normalizedRemoteItems = normalizeProductCollectionForStorage(collectionName, remoteItems);

    // HOTEL SHIFTS: cuando Firebase está online, Firestore es la única fuente de verdad.
    // Antes se mezclaba con localStorage y una copia local antigua podía volver a imponer
    // bases viejas (por ejemplo 339.200/339.500) incluso después de corregir Firestore.
    if (collectionName === 'hotel_shifts') {
      const remoteShifts = normalizeShiftCollectionForStorage(collectionName, normalizedRemoteItems as any[]) as any[];
      saveLocalCollection('hotel_shifts', remoteShifts);

      if (orderField) {
        remoteShifts.sort((a: any, b: any) => {
          const valA = a[orderField] || '';
          const valB = b[orderField] || '';
          return direction === 'asc'
            ? String(valA).localeCompare(String(valB))
            : String(valB).localeCompare(String(valA));
        });
      }

      callback(remoteShifts as T[]);
      return;
    }

    const merged = mergeCollectionsPreferNewest(collectionName, normalizedRemoteItems);

    if (orderField) {
      merged.sort((a: any, b: any) => {
        const valA = a[orderField] || '';
        const valB = b[orderField] || '';
        return direction === 'asc'
          ? String(valA).localeCompare(String(valB))
          : String(valB).localeCompare(String(valA));
      });
    }

    callback(merged as T[]);

    // Si hay pendientes, intentamos sincronizar sin bloquear la pantalla.
    syncPendingOperationsToFirestore().catch((error) => {
      console.warn("No se pudo sincronizar pendientes después de recibir snapshot:", error);
    });
  }, (error) => {
    logFirestoreError('read', collectionName, 'query', error, 'firebaseService.ts');

    // Si Firebase falla, la app NO queda vacía. Para productos usamos el catálogo
    // local reparado; para las demás colecciones conservamos el comportamiento previo.
    if (collectionName === 'hotel_products') {
      const fallbackSource = loadInitialProducts();
      const { consolidated } = reconcileAndSyncKodiakProducts(
        fallbackSource,
        async () => {},
        async () => {}
      );
      saveLocalCollection('hotel_products', consolidated);
      callback(consolidated as T[]);
      console.warn('[hotel_products] Firestore falló; se muestra catálogo local reparado hasta recuperar conexión.');
      return;
    }

    const fallback = loadLocalCollection<T>(collectionName);
    callback(fallback as T[]);
  });
};

// ==========================================
// FIRESTORE OPERATIONS (CRUD SERVICES)
// ==========================================

// Save/Update Rooms
export const saveRoomToFirestore = async (room: Room) => {
  await saveDocumentSafely('hotel_rooms', room.id, room, 'update');
};

// Save/Update Clients
export const saveClientToFirestore = async (client: Client) => {
  await saveDocumentSafely('hotel_clients', client.id, client, 'update');
};

// Save/Update Products
// La normalización del catálogo solo puede modificar nombre/visibilidad.
 // No sobrescribir stock ni precio con una lectura anterior de onSnapshot.
const saveProductCatalogMetadataToFirestore = async (product: Product): Promise<void> => {
  const item: any = product;
  const id = String(item.firestoreId || item.documentId || item.docId || item.id || '').trim();
  if (!id) throw new Error('Producto sin identificador de Firebase.');

  // Producto ausente, creado a partir del inventario físico: documento completo.
  if (item.inventoryReferenceDate === '2026-10-31' && !item.firestoreId && !item.documentId && !item.docId) {
    await saveProductToFirestore(product);
    return;
  }

  if (!isFirebaseConfigured) return;
  const patch: Record<string, any> = {
    nombre: product.nombre,
    activo: item.activo !== false,
    archivado: item.archivado === true,
    oculto: item.oculto === true,
    visible: item.visible !== false,
    eliminado: item.eliminado === true,
    deleted: item.deleted === true,
    isDeleted: item.isDeleted === true,
    estado: item.estado,
    status: item.status
  };
  if (item.motivoDesactivacion) patch.motivoDesactivacion = item.motivoDesactivacion;
  // La corrección nunca debe sustituir un precio actual válido de Firebase.
  // La transacción vuelve a leer el documento antes de reparar un precio en 0.
  const productRef = doc(db, 'hotel_products', id);
  if (item.__verifiedPriceRecovery === true && Number(item.precio) > 0) {
    await runTransaction(db, async (transaction) => {
      const current = await transaction.get(productRef);
      if (!current.exists()) return; // No recrear registros eliminados.
      const livePrice = Number(current.data()?.precio);
      const safePatch = { ...patch };
      if (!(Number.isFinite(livePrice) && livePrice > 0)) {
        safePatch.precio = Number(item.precio);
      }
      transaction.update(productRef, sanitizeForFirestore(safePatch));
    });
  } else {
    await updateDoc(productRef, sanitizeForFirestore(patch));
  }
};

export const saveProductToFirestore = async (product: Product) => {
  // El indicador de recuperación no es un dato del inventario.
  const { __verifiedPriceRecovery: _temporaryPriceRecovery, ...safeProduct } = product as any;
  let toSave = { ...safeProduct } as Product & { firestoreId?: string; documentId?: string; docId?: string };
  const rawName = String(toSave.nombre || '').trim();
  const canonicalName = getCanonicalProductName(rawName);
  toSave.nombre = canonicalName;

  // Si el usuario marcó explícitamente el producto como archivado / eliminado:
  const isExplicitlyArchived = product.activo === false || product.archivado === true || product.eliminado === true;

  const now = new Date().toISOString();
  const normalized: Product = {
    ...toSave,
    ...(Number(toSave.stock || 0) > 0 ? { migrationPlaceholder: false } : {}),
    ...(isExplicitlyArchived ? {
      activo: false,
      archivado: true,
      oculto: true,
      visible: false,
      eliminado: true,
      deleted: true,
      isDeleted: true,
      estado: 'Archivado',
      status: 'archived',
      desactivadoAt: (toSave as any).desactivadoAt || now,
      deletedAt: (toSave as any).deletedAt || (toSave as any).desactivadoAt || now,
      desactivadoPor: (toSave as any).desactivadoPor || 'admin',
      motivoDesactivacion: (toSave as any).motivoDesactivacion || 'Producto archivado/desactivado'
    } : {
      activo: true,
      archivado: false,
      oculto: false,
      visible: true,
      eliminado: false,
      deleted: false,
      isDeleted: false,
      estado: toSave.stock > 0 ? 'Disponible' : 'Agotado'
    }),
    updatedAt: (toSave as any).updatedAt || now,
    clientUpdatedAt: now
  };
  // IMPORTANTE: si el documento vino de Firestore, escribir sobre el ID REAL del
  // documento y no sobre un campo `id` heredado guardado dentro del documento.
  const firestoreDocId = String(
    (toSave as any).firestoreId ||
    (toSave as any).documentId ||
    (toSave as any).docId ||
    normalized.id
  ).trim();
  await saveDocumentSafely('hotel_products', firestoreDocId, normalized, 'update');
};

export const deleteProductFromFirestore = async (productId: string) => {
  const cleanId = String(productId || '').trim();
  if (!cleanId) return;

  // 1. Eliminar de almacenamiento y caché local
  const localList = loadLocalCollection<Product>('hotel_products');
  const filtered = localList.filter((p: any) => getDocKey(p) !== cleanId);
  saveLocalCollection('hotel_products', filtered);

  // 2. Eliminar de Firestore
  if (!isFirebaseConfigured) return;

  try {
    await deleteDoc(doc(db, 'hotel_products', cleanId));
    removePendingSync('hotel_products', cleanId);
  } catch (error) {
    console.warn(`Error eliminando documento ${cleanId} de hotel_products en Firestore:`, error);
    queuePendingSync('hotel_products', cleanId, {}, 'delete');
  }
};

export const archiveProductToFirestore = async (product: Product | any, operator?: any) => {
  const now = new Date().toISOString();
  const docId = String(
    product?.id ||
    product?.firestoreId ||
    product?.documentId ||
    product?.docId ||
    ''
  ).trim();

  if (!docId) {
    throw new Error('No se pudo archivar el producto porque no tiene ID.');
  }

  const archivedProduct: Product = {
    ...product,
    id: docId,
    firestoreId: docId,
    documentId: docId,
    docId,
    activo: false,
    archivado: true,
    oculto: true,
    visible: false,
    eliminado: true,
    deleted: true,
    isDeleted: true,
    estado: 'Archivado',
    status: 'archived',
    desactivadoAt: product?.desactivadoAt || now,
    deletedAt: product?.deletedAt || now,
    desactivadoPor:
      operator?.email ||
      operator?.nombre ||
      operator?.uid ||
      auth?.currentUser?.email ||
      'admin',
    motivoDesactivacion: product?.motivoDesactivacion || 'Producto ocultado/desactivado desde inventario por administrador',
    lastMovementAt: now,
    lastMovementType: 'desactivacion',
    lastMovementBy:
      operator?.nombre ||
      operator?.email ||
      auth?.currentUser?.email ||
      'admin',
    updatedAt: now,
    clientUpdatedAt: now
  } as any;

  await saveDocumentSafely('hotel_products', docId, archivedProduct, 'update');
  return archivedProduct;
};

// Save Sale & Decrement Product Stock using batch for atomicity when possible.
// Siempre guarda primero la venta localmente para sobrevivir cierre/apagón.
export const saveSaleAndDecrementStock = async (sale: Sale, productToDecrement?: { id: string; qty: number }) => {
  const saleId = sale.id || `sale-${Date.now()}`;
  const nowIso = new Date().toISOString();

  const saleData: Sale = {
    ...sale,
    id: saleId,
    createdAt: sale.createdAt || nowIso,
    updatedAt: (sale as any).updatedAt || nowIso
  } as any;

  // Venta de producto: registrar venta y descontar existencias EN UNA TRANSACCIÓN.
  // No informar éxito ni descontar stock local si Firestore no confirma ambas.
  // Evita duplicar el descuento si se reintenta exactamente el mismo ID de venta.
  if (productToDecrement) {
    const productId = String(productToDecrement.id || '').trim();
    const qty = Number(productToDecrement.qty);
    if (!productId || !Number.isInteger(qty) || qty <= 0) {
      throw new Error('No se pudo identificar el producto o la cantidad de la venta.');
    }
    if (!isFirebaseConfigured || typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Para vender productos se requiere conexión a Firebase. No se registró ni descontó inventario.');
    }

    const saleRef = doc(db, 'hotel_sales', saleId);
    const productRef = doc(db, 'hotel_products', productId);
    const stockFinal = await runTransaction(db, async (transaction) => {
      const previousSale = await transaction.get(saleRef);
      const productSnapshot = await transaction.get(productRef);
      if (!productSnapshot.exists()) {
        throw new Error('El producto no existe en Firebase. Actualice el inventario antes de vender.');
      }

      const product = productSnapshot.data() as Product;
      const stockActual = Number(product.stock || 0);
      if (previousSale.exists()) return stockActual; // Venta ya aplicada: no descontar dos veces.
      if (!Number.isFinite(stockActual) || stockActual < qty) {
        throw new Error(`Inventario insuficiente. Quedan ${stockActual} unidades disponibles.`);
      }

      const nuevoStock = stockActual - qty;
      const estado = nuevoStock === 0 ? 'Agotado' :
        nuevoStock <= Number(product.stockMinimo || 0) ? 'Bajo stock' : 'Disponible';

      transaction.set(saleRef, sanitizeForFirestore({
        ...saleData,
        syncPending: false,
        sincronizacionPendiente: false,
        syncedAt: nowIso
      }), { merge: true });
      transaction.update(productRef, {
        stock: nuevoStock,
        estado,
        updatedAt: nowIso,
        clientUpdatedAt: nowIso
      });
      return nuevoStock;
    });

    upsertLocalDocument('hotel_sales', saleId, saleData, false);
    notifyLocalListeners('hotel_sales');
    removePendingSync('hotel_sales', saleId);
    return stockFinal;
  }

  // 1. Guardar venta local inmediata.
  upsertLocalDocument('hotel_sales', saleId, saleData, false);

  // 2. Mantener cache local de producto si se conoce el movimiento.
  // Nota: normalmente ProductosView ya actualiza el producto antes de registrar la venta.
  // Por eso aquí NO volvemos a descontar localmente para evitar doble descuento.
  notifyLocalListeners('hotel_sales');

  if (!isFirebaseConfigured) {
    return;
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    upsertLocalDocument('hotel_sales', saleId, saleData, true);
    queuePendingSync('hotel_sales', saleId, saleData, 'set', true);
    return;
  }

  try {
    const batch = writeBatch(db);

    const saleRef = doc(db, 'hotel_sales', saleId);
    batch.set(saleRef, sanitizeForFirestore({
      ...saleData,
      syncPending: false,
      sincronizacionPendiente: false,
      syncedAt: new Date().toISOString()
    }), { merge: true });

    if (productToDecrement) {
      const prodRef = doc(db, 'hotel_products', productToDecrement.id);
      let prodDoc;
      try {
        prodDoc = await getDoc(prodRef);
      } catch (readErr) {
        logFirestoreError('read', 'hotel_products', productToDecrement.id, readErr, 'firebaseService.ts');
        throw readErr;
      }

      if (prodDoc.exists()) {
        const currentProd = prodDoc.data() as Product;
        const newStock = Math.max(0, Number(currentProd.stock || 0) - Number(productToDecrement.qty || 0));
        const newEstado = newStock === 0 ? 'Agotado' : newStock <= Number(currentProd.stockMinimo || 0) ? 'Bajo stock' : 'Disponible';

        batch.set(prodRef, sanitizeForFirestore({
          ...currentProd,
          id: productToDecrement.id,
          stock: newStock,
          estado: newEstado,
          updatedAt: nowIso,
          clientUpdatedAt: nowIso
        }), { merge: true });
      }
    }

    await batch.commit();
    removePendingSync('hotel_sales', saleId);
  } catch (error) {
    logFirestoreError('create', 'hotel_sales', saleId, error, 'firebaseService.ts');
    upsertLocalDocument('hotel_sales', saleId, saleData, true);
    queuePendingSync('hotel_sales', saleId, saleData, 'set', true);
  }
};

// Save Expense
export const saveExpenseToFirestore = async (expense: Expense) => {
  const id = expense.id || `expense-${Date.now()}`;
  await saveDocumentSafely('hotel_expenses', id, { ...expense, id } as any, 'create');
};

// Save Shift
export const saveShiftToFirestore = async (shift: Shift) => {
  await saveDocumentSafely('hotel_shifts', shift.id, {
    ...shift,
    createdAt: shift.createdAt || new Date().toISOString()
  } as any, 'update');
};

// Save Shift Closure
export const saveShiftClosureToFirestore = async (closure: ShiftClosure) => {
  await saveDocumentSafely('hotel_shift_closures', closure.id, {
    ...closure,
    createdAt: closure.createdAt || new Date().toISOString()
  } as any, 'create');
};

// Save/Update Reservation
export const saveReservationToFirestore = async (reservation: Reservation) => {
  await saveDocumentSafely('hotel_reservations', reservation.id, {
    ...reservation,
    createdAt: reservation.createdAt || new Date().toISOString()
  } as any, 'update');
};

// Save Settings
export const DEFAULT_KODIAK_CONFIG = {
  id: "kodiak_config",
  checkoutHour: "12:00",
  checkoutHourlyRate: 10000,
  extraHourRate: 10000,
  extraHoursOptional: true,
  currency: "COP",
  hotelName: "HOTEL KODIAK",
  allowReceptionistStockAdd: true,
  requireAdminPinForProductCreate: true,
  requireAdminPinForProductEdit: true,
  requireAdminPinForProductDelete: true,
  // Printer and Cash Drawer Defaults
  autoPrintEnabled: false,
  printerType: 'browser',
  paperSize: '48mm',
  windowsPrinterName: 'MiniPOS-58',
  autoOpenDrawer: false,
  openDrawerCashOnly: true,
  useBrowserPrintFallback: true,
  allowManualReprint: true,
  printOnSale: false,
  printOnRoomCharge: false,
  printOnExtraHours: false,
  printOnShiftClose: false,
  cashDrawerCommand: '1B700019FA'
};

export async function loadHotelSettings(userProfile?: FirebaseUser | null): Promise<any> {
  if (!isFirebaseConfigured) {
    return safeGetLocalStorage('hotel_settings', DEFAULT_KODIAK_CONFIG);
  }
  try {
    const ref = doc(db, "hotel_settings", "kodiak_config");
    const snap = await getDoc(ref);

    if (snap.exists()) {
      return snap.data();
    }

    console.warn("No existe hotel_settings/kodiak_config. Usando configuración local por defecto.");
    return DEFAULT_KODIAK_CONFIG;
  } catch (error) {
    console.error("Error leyendo configuración del hotel:", error);
    return DEFAULT_KODIAK_CONFIG;
  }
}

export async function saveHotelSettings(userProfile: FirebaseUser | null, newConfig: any): Promise<void> {
  // 1. Guardado inmediato en almacenamiento local para asegurar que la configuración nunca se pierda
  safeSetLocalStorage('hotel_settings', newConfig);
  notifyLocalListeners('hotel_settings');

  if (!isFirebaseConfigured) {
    return;
  }
  if (userProfile && userProfile.rol !== "admin") {
    return;
  }

  try {
    const ref = doc(db, "hotel_settings", "kodiak_config");
    await setDoc(ref, sanitizeForFirestore({
      ...newConfig,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser?.uid || "",
      updatedByName: userProfile?.nombre || auth.currentUser?.email || ""
    }), { merge: true });
  } catch (error) {
    logFirestoreError('create', 'hotel_settings', 'kodiak_config', error, 'firebaseService.ts');
  }
}

export const saveSettingsToFirestore = async (settings: any) => {
  return saveHotelSettings(cachedUserProfile, settings);
};

// Cash Drawer Logs and Printer Errors Logging
export const saveCashDrawerLog = async (log: any) => {
  if (!isFirebaseConfigured) {
    const localLogs = safeGetLocalStorage('hotel_cash_drawer_logs', []);
    localLogs.push({ ...log, createdAt: new Date().toISOString() });
    safeSetLocalStorage('hotel_cash_drawer_logs', localLogs);
    console.log("Offline Cash Drawer Log saved:", log);
    return;
  }
  try {
    const id = `drawer-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    await setDoc(doc(db, 'hotel_cash_drawer_logs', id), sanitizeForFirestore({
      ...log,
      createdAt: serverTimestamp()
    }));
  } catch (error: any) {
    const localLogs = safeGetLocalStorage('hotel_cash_drawer_logs', []);
    localLogs.push({ ...log, createdAt: new Date().toISOString(), syncError: error?.message || String(error) });
    safeSetLocalStorage('hotel_cash_drawer_logs', localLogs);
    console.warn("No se pudo subir el registro del cajón a Firestore. Se guardó localmente:", error?.message || error);
  }
};

export const savePrinterError = async (errLog: any) => {
  if (!isFirebaseConfigured) {
    const localErrors = safeGetLocalStorage('hotel_printer_errors', []);
    localErrors.push({ ...errLog, createdAt: new Date().toISOString() });
    safeSetLocalStorage('hotel_printer_errors', localErrors);
    console.log("Offline Printer Error saved:", errLog);
    return;
  }
  try {
    const id = `printer-err-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    await setDoc(doc(db, 'hotel_printer_errors', id), sanitizeForFirestore({
      ...errLog,
      createdAt: serverTimestamp()
    }));
  } catch (error: any) {
    const localErrors = safeGetLocalStorage('hotel_printer_errors', []);
    localErrors.push({ ...errLog, createdAt: new Date().toISOString(), syncError: error?.message || String(error) });
    safeSetLocalStorage('hotel_printer_errors', localErrors);
    console.warn("No se pudo subir el error de impresora a Firestore. Se guardó localmente:", error?.message || error);
  }
};

export const savePrinterLog = async (log: any) => {
  if (!isFirebaseConfigured) {
    const localLogs = safeGetLocalStorage('hotel_printer_logs', []);
    localLogs.push({ ...log, createdAt: new Date().toISOString() });
    safeSetLocalStorage('hotel_printer_logs', localLogs);
    console.log("Offline Printer Log saved:", log);
    return;
  }
  try {
    const id = `print-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    await setDoc(doc(db, 'hotel_printer_logs', id), sanitizeForFirestore({
      ...log,
      createdAt: serverTimestamp()
    }));
  } catch (error: any) {
    const localLogs = safeGetLocalStorage('hotel_printer_logs', []);
    localLogs.push({ ...log, createdAt: new Date().toISOString(), syncError: error?.message || String(error) });
    safeSetLocalStorage('hotel_printer_logs', localLogs);
    console.warn("No se pudo subir el log de impresora a Firestore. Se guardó localmente:", error?.message || error);
  }
};

// ==========================================
// MIGRATION UTILITY
// ==========================================

export const migrateLocalStorageToFirestore = async (
  onProgress: (message: string) => void
): Promise<{ success: boolean; count: number }> => {
  if (!isFirebaseConfigured) {
    onProgress('No se puede migrar: Firebase no está configurado.');
    return { success: false, count: 0 };
  }

  try {
    let totalMigrated = 0;
    
    // 1. Rooms
    onProgress('Migrando Habitaciones...');
    const localRooms = localStorage.getItem('hotel_rooms');
    if (localRooms) {
      const rooms: Room[] = JSON.parse(localRooms);
      for (const r of rooms) {
        await setDoc(doc(db, 'hotel_rooms', r.id), sanitizeForFirestore(r));
        totalMigrated++;
      }
    }

    // 2. Clients
    onProgress('Migrando Clientes...');
    const localClients = localStorage.getItem('hotel_clients');
    if (localClients) {
      const clients: Client[] = JSON.parse(localClients);
      for (const c of clients) {
        await setDoc(doc(db, 'hotel_clients', c.id), sanitizeForFirestore(c));
        totalMigrated++;
      }
    }

    // 3. Products
    onProgress('Migrando Productos...');
    const localProducts = localStorage.getItem('hotel_products');
    if (localProducts) {
      const products: Product[] = JSON.parse(localProducts);
      for (const p of products) {
        await setDoc(doc(db, 'hotel_products', p.id), sanitizeForFirestore(p));
        totalMigrated++;
      }
    }

    // 4. Sales
    onProgress('Migrando Historial de Ventas...');
    const localSales = localStorage.getItem('hotel_sales');
    if (localSales) {
      const sales: Sale[] = JSON.parse(localSales);
      for (let i = 0; i < sales.length; i += 100) {
        const batch = writeBatch(db);
        const chunk = sales.slice(i, i + 100);
        chunk.forEach((s) => {
          batch.set(doc(db, 'hotel_sales', s.id), sanitizeForFirestore({
            ...s,
            createdAt: s.createdAt || new Date().toISOString()
          }));
          totalMigrated++;
        });
        await batch.commit();
      }
    }

    // 5. Expenses
    onProgress('Migrando Gastos...');
    const localExpenses = localStorage.getItem('hotel_expenses');
    if (localExpenses) {
      const expenses: Expense[] = JSON.parse(localExpenses);
      for (const e of expenses) {
        await setDoc(doc(db, 'hotel_expenses', e.id), sanitizeForFirestore({
          ...e,
          createdAt: e.createdAt || new Date().toISOString()
        }));
        totalMigrated++;
      }
    }

    // 6. Shifts
    onProgress('Migrando Turnos...');
    const localShifts = localStorage.getItem('hotel_shifts');
    if (localShifts) {
      const shifts: Shift[] = JSON.parse(localShifts);
      for (const s of shifts) {
        await setDoc(doc(db, 'hotel_shifts', s.id), sanitizeForFirestore({
          ...s,
          createdAt: s.createdAt || new Date().toISOString()
        }));
        totalMigrated++;
      }
    }

    // 7. Shift Closures
    onProgress('Migrando Cierres de Turno...');
    const localClosures = localStorage.getItem('hotel_shift_closures');
    if (localClosures) {
      const closures: ShiftClosure[] = JSON.parse(localClosures);
      for (const c of closures) {
        await setDoc(doc(db, 'hotel_shift_closures', c.id), sanitizeForFirestore({
          ...c,
          createdAt: c.createdAt || new Date().toISOString()
        }));
        totalMigrated++;
      }
    }

    // 8. Reservations
    onProgress('Migrando Reservas...');
    const localReservations = localStorage.getItem('hotel_reservations');
    if (localReservations) {
      const reservations: Reservation[] = JSON.parse(localReservations);
      for (const r of reservations) {
        await setDoc(doc(db, 'hotel_reservations', r.id), sanitizeForFirestore({
          ...r,
          createdAt: r.createdAt || new Date().toISOString()
        }));
        totalMigrated++;
      }
    }

    onProgress('¡Migración completada con éxito!');
    return { success: true, count: totalMigrated };
  } catch (error: any) {
    console.error("Migration error:", error);
    onProgress(`Error durante la migración: ${error.message}`);
    return { success: false, count: 0 };
  }
};