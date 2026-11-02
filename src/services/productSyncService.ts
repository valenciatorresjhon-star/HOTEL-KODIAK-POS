import { Product, OFFICIAL_KODIAK_PRODUCTS, getCanonicalProductName, isProductArchivedOrHidden } from '../types';
import { safeGetLocalStorage } from '../utils/storage';

export interface ProductReconciliationResult {
  consolidated: Product[];
  actionsToRun: Array<() => Promise<void>>;
}

// Conteo del 31/10/2026. NO volver a fijar stocks de productos existentes
// al cargar la aplicación: Firebase puede reflejar ventas posteriores.
export const PRODUCT_INVENTORY_SYNC_VERSION = 4;
export const PRODUCT_CATALOG_RECOVERY_VERSION = 5;
export const TARGET_INVENTORY_PRODUCTS = OFFICIAL_KODIAK_PRODUCTS.map((p) => ({
  nombre: p.nombre, categoria: p.categoria, precio: p.precioSugerido,
  stock: p.stock, stockMinimo: p.stockMinimo, preferredId: p.id, aliases: p.aliases
}));

const TARGET_SET = new Set(TARGET_INVENTORY_PRODUCTS.map((p) => p.nombre));
const getDocId = (p: any) => String(p?.firestoreId || p?.documentId || p?.docId || p?.id || '');
const getMs = (v: any): number => {
  if (!v) return 0;
  if (typeof v?.toDate === 'function') return v.toDate().getTime();
  if (typeof v?.seconds === 'number') return v.seconds * 1000;
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? ms : 0;
};

function compareCandidates(a: any, b: any): number {
  const activeA = isProductArchivedOrHidden(a) ? 0 : 1;
  const activeB = isProductArchivedOrHidden(b) ? 0 : 1;
  if (activeA !== activeB) return activeB - activeA;
  const dateA = Math.max(getMs(a.clientUpdatedAt), getMs(a.updatedAt), getMs(a.lastMovementAt));
  const dateB = Math.max(getMs(b.clientUpdatedAt), getMs(b.updatedAt), getMs(b.lastMovementAt));
  if (dateA !== dateB) return dateB - dateA;
  return getDocId(a).localeCompare(getDocId(b));
}

function asArchived(original: any, reason: string): Product {
  return {
    ...original, activo: false, archivado: true, oculto: true,
    visible: false, eliminado: true, deleted: true, isDeleted: true,
    estado: 'Archivado', status: 'archived',
    motivoDesactivacion: original?.motivoDesactivacion || reason,
    catalogAuditDate: '2026-10-31'
  } as Product;
}

/**
 * Mostrar exactamente una ficha por cada referencia del inventario físico.
 * Los duplicados y productos fuera de la hoja se archivan sin eliminarlos,
 * conservando IDs, movimientos y ventas históricas.
 * El stock/precio remoto de los productos existentes nunca se reemplaza
 * automáticamente por cifras del 31 de octubre.
 */
export function reconcileAndSyncKodiakProducts(
  remoteItems: any[],
  saveDocFn: (p: Product) => Promise<void>,
  _deleteDocFn: (id: string) => Promise<void>
): ProductReconciliationResult {
  const actionsToRun: Array<() => Promise<void>> = [];
  const byCanonical = new Map<string, any[]>();
  const all = Array.isArray(remoteItems) ? remoteItems.filter(Boolean) : [];

  // Recuperar precios guardados previamente en este equipo únicamente cuando
  // el documento actual tiene precio cero. No son precios inventados.
  const localRecords = safeGetLocalStorage<Product[]>('hotel_products', []);
  const historicLocalPrices = new Map<string, number>();
  for (const item of Array.isArray(localRecords) ? localRecords : []) {
    const name = getCanonicalProductName(item?.nombre);
    const price = Number(item?.precio);
    if (name && Number.isFinite(price) && price > 0 && !historicLocalPrices.has(name)) {
      historicLocalPrices.set(name, price);
    }
  }

  // Estos once precios se documentaron antes del cambio de inventario.
  // Ningún otro precio se completa mediante suposiciones.
  const knownHistoricalPrices: Record<string, number> = {
    'JUGO DEL VALLE': 4000, 'REFAJO': 4000, 'POWER': 5000,
    'COCA-COLA': 4000, 'JUGO HIT': 4000, 'QUATRO': 4000,
    'AGUA NATURAL': 3000, 'SPEEDMAX': 4000, 'DORITOS': 4000,
    'PAPAS RIZADAS': 4000, 'GALLETAS FESTIVAL': 2000,
    // Precios respaldados por capturas del POS del 01/11/2026.
    'GALLETAS MINICHIP': 3000, 'CERVEZA': 4000,
    // Valores previamente autorizados para las marcas de esas referencias.
    'CHAMPÚ': 2000, 'CREMA PARA PEINAR': 3000, 'DESODORANTE': 3000,
    'CIGARRILLO UNIDAD': 2000, 'CIGARRILLO PAQUETE': 15000,
    'CREMA DENTAL': 5000, 'PRESTOBARBA': 3000,
    // Datos directos del sistema (condones) y de un catálogo Kodiak anterior (agua).
    'CONDONES': 6000, 'AGUA CON GAS': 3000
  };

  for (const item of all) {
    const canonical = getCanonicalProductName(item.nombre || item.name);
    if (!canonical) continue;
    const list = byCanonical.get(canonical) || [];
    list.push(item);
    byCanonical.set(canonical, list);
  }

  const consolidated: Product[] = [];
  const queueSave = (p: Product) => {
    actionsToRun.push(async () => {
      try {
        await saveDocFn(p);
      } catch (err) {
        console.error('[Hotel Kodiak] No se pudo actualizar catálogo:', p.nombre, err);
      }
    });
  };

  // Archivamos las referencias ajenas a la hoja (sin eliminar los documentos).
  for (const [name, entries] of byCanonical) {
    if (TARGET_SET.has(name)) continue;
    for (const item of entries) {
      if (!isProductArchivedOrHidden(item)) queueSave(asArchived(item, 'Fuera del inventario físico del 31/10/2026'));
    }
  }

  for (const target of TARGET_INVENTORY_PRODUCTS) {
    const entries = [...(byCanonical.get(target.nombre) || [])].sort(compareCandidates);
    const winner = entries[0];
    if (winner) {
      const stock = Number.isFinite(Number(winner.stock)) ? Math.max(0, Number(winner.stock)) : 0;
      const estado: Product['estado'] =
        stock <= 0 ? 'Agotado' : stock <= Number(winner.stockMinimo || 0) ? 'Bajo stock' : 'Disponible';
      const currentPrice = Number(winner.precio);
      const verifiedRemotePrice = entries
        .filter((item) => Number.isFinite(Number(item.precio)) && Number(item.precio) > 0)
        .sort(compareCandidates)
        .map((item) => Number(item.precio))[0];
      // Prioridad: precio actual válido; un documento existente del mismo
      // producto; precio anterior guardado localmente; once valores documentados.
      const recoveredPrice = currentPrice > 0 ? currentPrice
        : (verifiedRemotePrice || historicLocalPrices.get(target.nombre)
          || knownHistoricalPrices[target.nombre] || 0);
      const priceWasRecovered = !(currentPrice > 0) && recoveredPrice > 0;
      const canonicalProduct: Product = {
        ...winner,
        nombre: target.nombre,
        ...(priceWasRecovered ? { precio: recoveredPrice } : {}),
        stock,
        estado,
        activo: true, archivado: false, oculto: false, visible: true,
        eliminado: false, deleted: false, isDeleted: false, status: 'active',
        // Indicador temporal para el guardado seguro; no es un campo de Firebase.
        ...(priceWasRecovered ? { __verifiedPriceRecovery: true } : {})
      } as Product;
      consolidated.push(canonicalProduct);
      if (winner.nombre !== target.nombre || isProductArchivedOrHidden(winner) || priceWasRecovered) {
        queueSave(canonicalProduct);
      }
      // Duplicados ocultos, pero NO borrados: conservan identidad y trazabilidad.
      for (const dupe of entries.slice(1)) {
        if (!isProductArchivedOrHidden(dupe)) {
          queueSave(asArchived(dupe, 'Duplicado de ' + target.nombre));
        }
      }
    } else {
      // No crear productos ficticios a $0: antes se mostraban como
      // "Precio pendiente" aunque el propietario ya hubiera fijado tarifas.
      // Crear solamente si hay un precio anterior verificable.
      const existingPrice = historicLocalPrices.get(target.nombre) ||
        knownHistoricalPrices[target.nombre] || 0;
      if (!(existingPrice > 0)) {
        console.warn('[Hotel Kodiak] Producto no creado por falta de precio histórico verificable:', target.nombre);
        continue;
      }
      // Referencia completamente ausente: se crea una sola vez, con ID estable.
      // El stock corresponde al conteo físico del 31/10/2026.
      const now = new Date().toISOString();
      const created: Product = {
        id: target.preferredId, nombre: target.nombre, categoria: target.categoria,
        precio: existingPrice, stock: target.stock, stockMinimo: target.stockMinimo,
        estado: target.stock === 0 ? 'Agotado' :
          target.stock <= target.stockMinimo ? 'Bajo stock' : 'Disponible',
        activo: true, archivado: false, oculto: false, visible: true,
        eliminado: false, deleted: false, isDeleted: false, status: 'active',
        inventoryReferenceDate: '2026-10-31',
        createdAt: now, updatedAt: now, clientUpdatedAt: now
      } as Product;
      consolidated.push(created);
      queueSave(created);
    }
  }
  return { consolidated, actionsToRun };
}
