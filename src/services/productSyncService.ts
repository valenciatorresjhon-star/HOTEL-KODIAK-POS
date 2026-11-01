import {
  Product,
  OFFICIAL_KODIAK_PRODUCTS,
  getCanonicalProductName,
  isProductArchivedOrHidden
} from '../types';
import { safeGetLocalStorage } from '../utils/storage';

export interface ProductReconciliationResult {
  consolidated: Product[];
  actionsToRun: Array<() => Promise<void>>;
}

/**
 * Versión de actualización de inventario del Hotel Kodiak.
 *
 * Se aplica UNA SOLA VEZ por documento. Cuando un producto recibe inventoryUpdateVersion = 4,
 * sus existencias quedan fijadas exactamente a la lista solicitada.
 * En arranques o lecturas posteriores (incluso si se venden unidades o se cambia el stock),
 * al tener ya version = 4, NO se restablecen las cantidades y se preserva el inventario en curso.
 */
export const PRODUCT_INVENTORY_SYNC_VERSION = 4;
export const PRODUCT_CATALOG_RECOVERY_VERSION = 4;

export const TARGET_INVENTORY_PRODUCTS = OFFICIAL_KODIAK_PRODUCTS.map((product) => ({
  nombre: product.nombre,
  categoria: product.categoria,
  precio: product.precioSugerido,
  stock: product.stock,
  stockMinimo: product.stockMinimo,
  preferredId: product.id,
  aliases: product.aliases
}));

const TARGET_MAP = new Map(TARGET_INVENTORY_PRODUCTS.map((p) => [p.nombre, p]));

function getLocalProductsByCanonicalName(): Map<string, Product> {
  const localList = safeGetLocalStorage<Product[]>('hotel_products', []);
  const map = new Map<string, Product>();

  for (const raw of Array.isArray(localList) ? localList : []) {
    if (!raw) continue;
    const canonical = getCanonicalProductName(raw.nombre || (raw as any).name);
    if (!canonical) continue;
    map.set(canonical, { ...raw, nombre: canonical });
  }

  return map;
}

function hasAppliedInventoryUpdate(item: any): boolean {
  return Number(item?.inventoryUpdateVersion || 0) >= PRODUCT_INVENTORY_SYNC_VERSION;
}

function makeActiveProduct(item: any, canonicalName: string): Product {
  const stock = Number.isFinite(Number(item?.stock)) ? Math.max(0, Number(item.stock)) : 0;
  const stockMinimo = Number.isFinite(Number(item?.stockMinimo)) ? Math.max(0, Number(item.stockMinimo)) : 0;
  const now = new Date().toISOString();

  let estado: Product['estado'] = 'Disponible';
  if (stock <= 0) estado = 'Agotado';
  else if (stock <= stockMinimo) estado = 'Bajo stock';

  return {
    ...item,
    nombre: canonicalName,
    stock,
    stockMinimo,
    estado,
    activo: true,
    archivado: false,
    oculto: false,
    visible: true,
    eliminado: false,
    deleted: false,
    isDeleted: false,
    status: 'active',
    catalogRecoveryVersion: PRODUCT_CATALOG_RECOVERY_VERSION,
    recoveredFromLegacyCatalog: true,
    recoveredAt: item?.recoveredAt || now,
    updatedAt: now,
    clientUpdatedAt: now
  } as Product;
}

/**
 * Reconcilia el catálogo de productos contra la colección real `hotel_products`.
 *
 * Reglas:
 * - Firebase es la fuente de verdad durante la operación normal.
 * - No existe una lista blanca que impida crear productos nuevos.
 * - Los 11 productos requeridos por el hotel se garantizan una vez.
 * - Productos que quedaron archivados por la vieja lista blanca se recuperan una sola vez.
 * - Después de catalogRecoveryVersion=3, una eliminación explícita del admin se respeta.
 * - Nunca se reinicia el stock de un producto activo existente.
 */
export function reconcileAndSyncKodiakProducts(
  remoteItems: any[],
  saveDocFn: (prod: Product) => Promise<void>,
  deleteDocFn: (id: string) => Promise<void>
): ProductReconciliationResult {
  const actionsToRun: Array<() => Promise<void>> = [];
  const validRemote = Array.isArray(remoteItems) ? remoteItems.filter(Boolean) : [];
  const localByCanonical = getLocalProductsByCanonicalName();

  const groupedByCanonical = new Map<string, Array<{ item: any; canonicalName: string; rawName: string }>>();

  for (const rawItem of validRemote) {
    const item: any = { ...rawItem };
    const rawName = String(item.nombre || item.name || '').trim();
    const canonicalName = getCanonicalProductName(rawName) || rawName;
    if (!canonicalName) continue;

    const list = groupedByCanonical.get(canonicalName) || [];
    list.push({ item, canonicalName, rawName });
    groupedByCanonical.set(canonicalName, list);
  }

  const consolidated: Product[] = [];
  const processedCanonicalNames = new Set<string>();

  for (const [canonicalName, entries] of groupedByCanonical.entries()) {
    processedCanonicalNames.add(canonicalName);

    // Si hay duplicados, conservar el documento ACTIVO más reciente.
    // Priorizar el stock más alto recuperaba unidades ya vendidas y hacía parecer
    // que la venta no descontaba inventario.
    const sorted = [...entries].sort((a, b) => {
      const activeA = isProductArchivedOrHidden(a.item) ? 0 : 1;
      const activeB = isProductArchivedOrHidden(b.item) ? 0 : 1;
      if (activeA !== activeB) return activeB - activeA;

      const dateA = Math.max(
        Date.parse(a.item.clientUpdatedAt || '') || 0,
        Date.parse(a.item.updatedAt || '') || 0
      );
      const dateB = Math.max(
        Date.parse(b.item.clientUpdatedAt || '') || 0,
        Date.parse(b.item.updatedAt || '') || 0
      );
      if (dateA !== dateB) return dateB - dateA;

      if (a.rawName === canonicalName && b.rawName !== canonicalName) return -1;
      if (b.rawName === canonicalName && a.rawName !== canonicalName) return 1;
      return 0;
    });

    const winnerEntry = sorted[0];
    const duplicates = sorted.slice(1);
    let winnerDoc: Product = { ...winnerEntry.item, nombre: canonicalName } as Product;
    let needsSave = winnerEntry.rawName !== canonicalName;

    const targetDef = TARGET_MAP.get(canonicalName);
    // Conservar siempre precio y stock de Firebase: la foto es un inventario
    // fechado, no una autorización para sobrescribir ventas posteriores.
    if (targetDef && winnerDoc.nombre !== targetDef.nombre) {
      winnerDoc = { ...winnerDoc, nombre: targetDef.nombre };
      needsSave = true;
    }

    consolidated.push(winnerDoc);

    if (needsSave) {
      const docToSave = { ...winnerDoc };
      actionsToRun.push(async () => {
        try {
          await saveDocFn(docToSave);
          console.log(`[reconcileProducts] Producto actualizado/guardado: ${docToSave.nombre} (${docToSave.stock} u.)`);
        } catch (err) {
          console.warn(`[reconcileProducts] Error guardando ${docToSave.nombre}:`, err);
        }
      });
    }

    // Los duplicados permanecen en Firebase para conciliación manual.
    // No borrar documentos con historial de ventas, ni restablecer su stock.
    if (duplicates.length) {
      console.warn('[Inventario Kodiak] Posibles duplicados para revisar:', canonicalName,
        duplicates.map((entry) => entry.item.id));
    }
  }

  // Crear únicamente los productos base que realmente NO existen en Firestore.
  for (const target of TARGET_INVENTORY_PRODUCTS) {
    if (processedCanonicalNames.has(target.nombre)) continue;

    const now = new Date().toISOString();
    const newProductDoc: Product = {
      id: target.preferredId,
      nombre: target.nombre,
      categoria: target.categoria,
      precio: target.precio,
      stock: target.stock,
      stockMinimo: target.stockMinimo,
      estado: 'Disponible',
      activo: true,
      archivado: false,
      oculto: false,
      visible: true,
      eliminado: false,
      deleted: false,
      isDeleted: false,
      status: 'active',
      inventoryUpdateVersion: PRODUCT_INVENTORY_SYNC_VERSION,
      catalogRecoveryVersion: PRODUCT_CATALOG_RECOVERY_VERSION,
      createdAt: now,
      updatedAt: now,
      clientUpdatedAt: now
    } as Product;

    consolidated.push(newProductDoc);
    processedCanonicalNames.add(target.nombre);

    actionsToRun.push(async () => {
      try {
        await saveDocFn(newProductDoc);
        console.log(`[reconcileProducts] Producto faltante creado: ${target.nombre} (${target.stock} u.)`);
      } catch (err) {
        console.warn(`[reconcileProducts] Error creando ${target.nombre}:`, err);
      }
    });
  }

  return { consolidated, actionsToRun };
}
