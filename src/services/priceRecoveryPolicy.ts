import { getCanonicalProductName, isProductArchivedOrHidden } from '../types';

// Evidencia anterior al conteo; no usar precios añadidos posteriormente sin su fuente.
export const PRICE_SOURCE = 'https://github.com/valenciatorresjhon-star/HOTEL-KODIAK-POS/blob/97f663fa8e0107d1208dcaee0b4a445f5979d930/src/types.ts';
export const HISTORICAL_PRICES: Readonly<Record<string, number>> = Object.freeze({
  'JUGO DEL VALLE': 4000, REFAJO: 4000, POWER: 5000, 'COCA COLA': 4000,
  'JUGO HIT': 4000, QUATRO: 4000, 'AGUA NATURAL': 3000, SPEEDMAX: 4000,
  DORITOS: 4000, 'PAPAS RIZADAS': 4000, 'GALLETAS FESTIVAL': 2000,
});

// Solo diferencias tipográficas; no inferir marca, tamaño o presentación por prefijo.
export const priceProductKey = (value: unknown) => String(value ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[-_]/g, ' ').trim().replace(/\s+/g, ' ');

export interface RawProduct { id: string; data: Record<string, any>; fingerprint: string }
export interface PriceReview {
  id: string; name: string; previous: unknown; proposed?: number;
  status: 'recover' | 'keep' | 'review'; reason: string;
}

export function reviewPrices(products: RawProduct[]): PriceReview[] {
  const counts = new Map<string, number>();
  for (const p of products) {
    const key = getCanonicalProductName(p.data.nombre);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return products.map(({ id, data }) => {
    const key = priceProductKey(data.nombre);
    const proposed = Object.hasOwn(HISTORICAL_PRICES, key) ? HISTORICAL_PRICES[key] : undefined;
    const base = { id, name: String(data.nombre || '(sin nombre)'), previous: data.precio, proposed };
    if (isProductArchivedOrHidden(data)) return { ...base, status: 'review', reason: 'Archivado u oculto: conservar' };
    if (counts.get(getCanonicalProductName(data.nombre))! > 1) return { ...base, status: 'review', reason: 'Nombre repetido o alias: revisar documentos' };
    if (typeof data.precio === 'number' && Number.isFinite(data.precio) && data.precio > 0 ||
        typeof data.precio === 'string' && data.precio.trim() !== '' && Number.isFinite(Number(data.precio)) && Number(data.precio) > 0) {
      return { ...base, status: 'keep', reason: 'Precio positivo: conservar' };
    }
    if (data.precio !== 0 && data.precio !== '0') return { ...base, status: 'review', reason: 'Precio ausente o inválido: revisar' };
    if (!proposed) return { ...base, status: 'review', reason: 'Sin precio anterior comprobado para este nombre' };
    return { ...base, status: 'recover', reason: 'Recuperar precio cero desde GitHub' };
  });
}

/** Se invoca dentro de una transacción después de todas sus lecturas, antes de escribir. */
export function validateRecovery(original: RawProduct[], current: RawProduct[]) {
  const changes = reviewPrices(original).filter(row => row.status === 'recover');
  if (!changes.length) throw new Error('No hay precios cero recuperables.');
  for (const change of changes) {
    const before = original.find(p => p.id === change.id)!;
    const live = current.find(p => p.id === change.id);
    if (!live || live.fingerprint !== before.fingerprint) {
      throw new Error('El inventario cambió después del respaldo. Vuelve a consultar y descargar la copia.');
    }
  }
  return changes;
}
