import { Bytes, DocumentReference, GeoPoint, Timestamp, collection, doc, getDocFromServer, getDocsFromServer, runTransaction } from 'firebase/firestore';
import { auth, db, firebaseConfig, isFirebaseConfigured } from '../firebase';
import { PRICE_SOURCE, RawProduct, reviewPrices, validateRecovery } from './priceRecoveryPolicy';

// Exportación con tipos explícitos para conservar timestamps, referencias y bytes.
export function encodeBackup(value: any): any {
  if (value === null) return { type: 'null' };
  if (value instanceof Timestamp) return { type: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (value instanceof GeoPoint) return { type: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  if (value instanceof Bytes) return { type: 'bytes', base64: value.toBase64() };
  if (value instanceof DocumentReference) return { type: 'reference', path: value.path };
  if (Array.isArray(value)) return { type: 'array', values: value.map(encodeBackup) };
  if (typeof value === 'object') return { type: 'map', fields: Object.fromEntries(Object.keys(value).sort().map(k => [k, encodeBackup(value[k])])) };
  return { type: typeof value, value: typeof value === 'number' && !Number.isFinite(value) ? String(value) : value };
}

const raw = (id: string, data: Record<string, any>): RawProduct => ({ id, data, fingerprint: JSON.stringify(encodeBackup(data)) });
export interface PriceBackup {
  projectId: string; capturedAt: string; uid: string; products: RawProduct[];
}

async function requireAdmin() {
  if (!isFirebaseConfigured || !auth?.currentUser) throw new Error('Inicia sesión con conexión a Firebase.');
  const uid = auth.currentUser.uid;
  const profile = await getDocFromServer(doc(db, 'hotel_users', uid));
  if (!profile.exists() || profile.data().rol !== 'admin' || profile.data().activo === false) {
    throw new Error('Esta recuperación requiere una cuenta administradora activa.');
  }
  return uid;
}

export async function preparePriceBackup(): Promise<PriceBackup> {
  const uid = await requireAdmin();
  // Fallar si el servidor no responde: nunca sustituir con caché o catálogo local.
  const snapshot = await getDocsFromServer(collection(db, 'hotel_products'));
  if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) throw new Error('Espera a que terminen los cambios pendientes y vuelve a consultar.');
  return { projectId: firebaseConfig.projectId, capturedAt: new Date().toISOString(), uid,
    products: snapshot.docs.map(d => raw(d.id, d.data())) };
}

export function priceBackupText(backup: PriceBackup) {
  return JSON.stringify({ format: 'kodiak-products-typed-v1', projectId: backup.projectId,
    database: '(default)', collection: 'hotel_products', capturedAt: backup.capturedAt,
    scope: 'Documentos de hotel_products completos. No incluye subcolecciones, ventas ni metadatos internos de creación/actualización de Firestore.',
    source: PRICE_SOURCE, documents: backup.products.map(p => ({ id: p.id, fields: encodeBackup(p.data) })),
    differences: reviewPrices(backup.products) }, null, 2);
}

export async function applyPriceRecovery(backup: PriceBackup) {
  const uid = await requireAdmin();
  if (backup.projectId !== firebaseConfig.projectId || backup.uid !== uid) throw new Error('La cuenta o el proyecto cambió. Vuelve a consultar.');
  const changes = reviewPrices(backup.products).filter(p => p.status === 'recover');
  if (!changes.length) throw new Error('No hay precios cero recuperables.');
  const auditRef = doc(collection(db, 'hotel_audit_logs'));
  return runTransaction(db, async transaction => {
    const profile = await transaction.get(doc(db, 'hotel_users', uid));
    if (!profile.exists() || profile.data().rol !== 'admin' || profile.data().activo === false) throw new Error('La cuenta ya no tiene permiso de administrador.');
    const current: RawProduct[] = [];
    for (const change of changes) {
      const snapshot = await transaction.get(doc(db, 'hotel_products', change.id));
      if (snapshot.exists()) current.push(raw(snapshot.id, snapshot.data()));
    }
    const verified = validateRecovery(backup.products, current);
    // Solo precio: sin spread del documento, cambios de stock, flags o fecha de movimiento.
    for (const change of verified) transaction.update(doc(db, 'hotel_products', change.id), { precio: change.proposed });
    transaction.set(auditRef, {
      type: 'recuperacion_precios_github', source: PRICE_SOURCE, createdBy: uid,
      createdAt: Timestamp.now(), backupCapturedAt: backup.capturedAt,
      changes: verified.map(change => ({ productId: change.id, before: change.previous, after: change.proposed,
        productBefore: current.find(p => p.id === change.id)!.data })),
    });
    return verified.length;
  });
}
