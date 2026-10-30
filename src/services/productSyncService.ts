import {
  Product,
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

export const TARGET_INVENTORY_PRODUCTS: Array<{
  nombre: string;
  categoria: string;
  precio: number;
  stock: number;
  stockMinimo: number;
  preferredId: string;
  aliases: string[];
}> = [
  {
    nombre: 'JUGO DEL VALLE',
    categoria: 'Bebidas',
    precio: 4000,
    stock: 9,
    stockMinimo: 3,
    preferredId: 'prod-jugo-del-valle',
    aliases: ['JUGO DEL VALLE PET 400', 'JUGOS DEL VALLE', 'DEL VALLE', 'VALLE']
  },
  {
    nombre: 'REFAJO',
    categoria: 'Bebidas',
    precio: 4000,
    stock: 11,
    stockMinimo: 2,
    preferredId: 'prod-refajo',
    aliases: ['REFAJO PET 400', 'CERVEZA REFAJO', 'REFAJO COLOMBIANA']
  },
  {
    nombre: 'POWER',
    categoria: 'Bebidas',
    precio: 5000,
    stock: 14,
    stockMinimo: 2,
    preferredId: 'prod-power',
    aliases: ['POWER PET 400 ML', 'POWER PET 400', 'POWERADE']
  },
  {
    nombre: 'COCA-COLA',
    categoria: 'Bebidas',
    precio: 4000,
    stock: 12,
    stockMinimo: 3,
    preferredId: 'prod-coca-cola',
    aliases: ['COCA COLA', 'COCACOLA', 'COCA-COLA PET 400']
  },
  {
    nombre: 'JUGO HIT',
    categoria: 'Bebidas',
    precio: 4000,
    stock: 9,
    stockMinimo: 3,
    preferredId: 'prod-jugo-hit',
    aliases: ['HIT', 'JUGOS HIT', 'JUGO HIT PET']
  },
  {
    nombre: 'QUATRO',
    categoria: 'Bebidas',
    precio: 4000,
    stock: 12,
    stockMinimo: 3,
    preferredId: 'prod-quatro',
    aliases: ['QUATRO PET 400', 'CUATRO', 'CUATRO PET 400']
  },
  {
    nombre: 'AGUA NATURAL',
    categoria: 'Bebidas',
    precio: 3000,
    stock: 22,
    stockMinimo: 2,
    preferredId: 'prod-agua-natural',
    aliases: ['AGUA', 'AGUAS', 'AGUA NATURAL', 'AGUA SIN GAS', 'AGUA PURIFICADA']
  },
  {
    nombre: 'SPEEDMAX',
    categoria: 'Bebidas',
    precio: 4000,
    stock: 12,
    stockMinimo: 3,
    preferredId: 'prod-speedmax',
    aliases: ['SPINAX', 'SPINMAX', 'SPEED MAX', 'SPEED']
  },
  {
    nombre: 'DORITOS',
    categoria: 'Snacks',
    precio: 4000,
    stock: 5,
    stockMinimo: 3,
    preferredId: 'prod-doritos',
    aliases: ['DORITO', 'DORITOS MEGA']
  },
  {
    nombre: 'PAPAS RIZADAS',
    categoria: 'Snacks',
    precio: 4000,
    stock: 10,
    stockMinimo: 3,
    preferredId: 'prod-papas',
    aliases: ['PAPAS', 'PAPAS MARGARITA', 'PAPITAS', 'PAPAS FRITAS']
  },
  {
    nombre: 'GALLETAS FESTIVAL',
    categoria: 'Snacks',
    precio: 2000,
    stock: 11,
    stockMinimo: 3,
    preferredId: 'prod-galletas-festival',
    aliases: ['FESTIVAL', 'GALLETA FESTIVAL']
  }
];

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

    // Si hay duplicados, priorizamos primero un documento ACTIVO; luego el stock mayor;
    // finalmente el más reciente. Esto evita escoger como ganador un duplicado archivado.
    const sorted = [...entries].sort((a, b) => {
      const activeA = isProductArchivedOrHidden(a.item) ? 0 : 1;
      const activeB = isProductArchivedOrHidden(b.item) ? 0 : 1;
      if (activeA !== activeB) return activeB - activeA;

      const stockA = Number.isFinite(Number(a.item.stock)) ? Number(a.item.stock) : 0;
      const stockB = Number.isFinite(Number(b.item.stock)) ? Number(b.item.stock) : 0;
      if (stockA !== stockB) return stockB - stockA;

      if (a.rawName === canonicalName && b.rawName !== canonicalName) return -1;
      if (b.rawName === canonicalName && a.rawName !== canonicalName) return 1;

      const msA = new Date(a.item.updatedAt || a.item.clientUpdatedAt || 0).getTime();
      const msB = new Date(b.item.updatedAt || b.item.clientUpdatedAt || 0).getTime();
      return msB - msA;
    });

    const winnerEntry = sorted[0];
    const duplicates = sorted.slice(1);
    let winnerDoc: Product = { ...winnerEntry.item, nombre: canonicalName } as Product;
    let needsSave = winnerEntry.rawName !== canonicalName;

    const targetDef = TARGET_MAP.get(canonicalName);
    const alreadyUpdated = hasAppliedInventoryUpdate(winnerDoc);

    if (targetDef && !alreadyUpdated) {
      // Actualización de inventario oficial del Hotel Kodiak (se ejecuta UNA SOLA VEZ por producto).
      const now = new Date().toISOString();
      winnerDoc = {
        ...winnerDoc,
        nombre: targetDef.nombre,
        categoria: targetDef.categoria,
        precio: targetDef.precio,
        stock: targetDef.stock,
        stockMinimo: targetDef.stockMinimo,
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
        recoveredFromLegacyCatalog: true,
        updatedAt: now,
        clientUpdatedAt: now
      } as Product;
      needsSave = true;
    } else {
      // Operación normal o producto ya actualizado previamente:
      // NUNCA restablecemos el stock ni precio. Si hubo ventas o cambios, se conservan.
      const normalizedActive: Product = {
        ...winnerDoc,
        nombre: canonicalName,
        activo: true,
        archivado: false,
        oculto: false,
        visible: true,
        eliminado: false,
        deleted: false,
        isDeleted: false,
        status: 'active'
      } as Product;

      if (!hasAppliedInventoryUpdate(normalizedActive) && targetDef) {
        (normalizedActive as any).inventoryUpdateVersion = PRODUCT_INVENTORY_SYNC_VERSION;
        needsSave = true;
      }

      winnerDoc = normalizedActive;
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

    // Borrar únicamente duplicados reales después de haber elegido un ganador.
    for (const dup of duplicates) {
      const dupId = dup.item.firestoreId || dup.item.documentId || dup.item.docId || dup.item.id;
      const winnerId = (winnerDoc as any).firestoreId || (winnerDoc as any).documentId || (winnerDoc as any).docId || (winnerDoc as any).id;
      if (dupId && dupId !== winnerId) {
        actionsToRun.push(async () => {
          try {
            await deleteDocFn(dupId);
            console.log(`[reconcileProducts] Duplicado eliminado: ${dup.rawName} (${dupId})`);
          } catch (err) {
            console.warn(`[reconcileProducts] Error eliminando duplicado ${dupId}:`, err);
          }
        });
      }
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
