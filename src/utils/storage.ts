import { Room, Client, Product, Sale, Expense, Shift, ShiftClosure, Reservation, SystemSettings, INITIAL_ROOMS_DATA, INITIAL_PRODUCTS_DATA, getCanonicalProductName } from '../types';

export const safeGetLocalStorage = <T>(key: string, defaultValue: T): T => {
  try {
    const item = localStorage.getItem(key);
    if (!item) return defaultValue;
    return JSON.parse(item) as T;
  } catch (e) {
    console.error(`Error reading key "${key}" from localStorage:`, e);
    return defaultValue;
  }
};

export const safeSetLocalStorage = <T>(key: string, value: T): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(`Error writing key "${key}" to localStorage:`, e);
  }
};

export const loadInitialRooms = (): Room[] => {
  const stored = safeGetLocalStorage<Room[]>('hotel_rooms', []);
  
  if (stored.length === 0) {
    const initial = INITIAL_ROOMS_DATA.map((name, idx) => ({
      id: name.toLowerCase().includes('apartamento') ? 'room-apt' : `room-${name.replace(/\D/g, '') || (idx + 1)}`,
      nombre: name,
      estado: 'disponible' as const,
    }));
    const sorted = initial.sort((a, b) => a.nombre.localeCompare(b.nombre, undefined, { numeric: true, sensitivity: 'base' }));
    safeSetLocalStorage('hotel_rooms', sorted);
    return sorted;
  }

  // Auto-heal missing rooms locally
  let updated = false;
  const current = [...stored];
  INITIAL_ROOMS_DATA.forEach((name, idx) => {
    if (!current.some(r => r.nombre === name)) {
      const cleanId = name.toLowerCase().includes('apartamento') ? 'room-apt' : `room-${name.replace(/\D/g, '') || (idx + 1)}`;
      const idExists = current.some(r => r.id === cleanId);
      current.push({
        id: idExists ? `${cleanId}-${Date.now()}` : cleanId,
        nombre: name,
        estado: 'disponible' as const,
      });
      updated = true;
    }
  });

  const sorted = current.sort((a, b) => a.nombre.localeCompare(b.nombre, undefined, { numeric: true, sensitivity: 'base' }));
  if (updated) {
    safeSetLocalStorage('hotel_rooms', sorted);
  }
  return sorted;
};

export const loadInitialProducts = (): Product[] => {
  const stored = safeGetLocalStorage<Product[]>('hotel_products', []);
  if (stored.length > 0) {
    let hasChanges = false;
    const map = new Map<string, Product>();

    for (const item of stored) {
      if (!item) continue;
      const canonical = getCanonicalProductName(item.nombre || (item as any).name);
      if (!canonical) continue;
      const existing = map.get(canonical);
      const itemStock = typeof item.stock === 'number' ? item.stock : 0;

      if (!existing) {
        map.set(canonical, {
          ...item,
          nombre: canonical,
          stock: itemStock,
          activo: item.activo !== false,
          archivado: item.archivado === true
        });
      } else {
        // Preservar stock real / mayor stock
        if (itemStock > existing.stock) {
          map.set(canonical, {
            ...existing,
            stock: itemStock,
            updatedAt: item.updatedAt || existing.updatedAt
          });
          hasChanges = true;
        }
      }
    }

    // Asegurar que los 11 productos base existan si no están presentes, sin sobreescribir existencias
    for (const initP of INITIAL_PRODUCTS_DATA) {
      const canonical = getCanonicalProductName(initP.nombre);
      if (!map.has(canonical)) {
        map.set(canonical, { ...initP });
        hasChanges = true;
      }
    }

    const result = Array.from(map.values());
    if (hasChanges) {
      safeSetLocalStorage('hotel_products', result);
    }
    return result;
  }

  safeSetLocalStorage('hotel_products', INITIAL_PRODUCTS_DATA);
  return INITIAL_PRODUCTS_DATA;
};

// Formatting helpers
export const formatCop = (amount: number): string => {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
};

export const formatSafeDate = (rawDateStr: string | undefined | null | number): string => {
  if (!rawDateStr) return 'Fecha no registrada';
  try {
    const parsed = new Date(rawDateStr);
    if (isNaN(parsed.getTime())) {
      return String(rawDateStr);
    }
    return parsed.toLocaleDateString('es-CO') + ', ' + parsed.toLocaleTimeString('es-CO', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch (e) {
    return String(rawDateStr);
  }
};

export const isInvalidValue = (value: any): boolean => {
  return (
    value === undefined ||
    value === null ||
    String(value).trim() === '' ||
    String(value).trim() === '-'
  );
};

export const getTodayColombia = (): string => {
  const now = new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
};

export function parseColombiaDateTime(fechaStr?: string, horaStr?: string): Date | null {
  if (!fechaStr || !horaStr) return null;
  try {
    let day = 0, month = 0, year = 0;
    const cleanFecha = fechaStr.trim();
    if (cleanFecha.includes('/')) {
      const parts = cleanFecha.split('/');
      if (parts.length === 3) {
        day = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10) - 1; // 0-based
        year = parseInt(parts[2], 10);
      }
    } else if (cleanFecha.includes('-')) {
      const parts = cleanFecha.split('-');
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          year = parseInt(parts[0], 10);
          month = parseInt(parts[1], 10) - 1;
          day = parseInt(parts[2], 10);
        } else {
          day = parseInt(parts[0], 10);
          month = parseInt(parts[1], 10) - 1;
          year = parseInt(parts[2], 10);
        }
      }
    }
    
    if (year === 0 || day === 0) return null;

    const timeMatch = horaStr.match(/(\d+):(\d+)(?::\d+)?\s*(AM|PM|a\.\s*m\.|p\.\s*m\.|am|pm|a\s*m|p\s*m)?/i);
    if (!timeMatch) return null;
    let hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    const ampm = timeMatch[3];

    if (ampm) {
      const isPm = ampm.toLowerCase().includes('p');
      const isAm = ampm.toLowerCase().includes('a');
      if (isPm && hours < 12) hours += 12;
      if (isAm && hours === 12) hours = 0;
    }

    const d = new Date(year, month, day, hours, minutes, 0);
    return isNaN(d.getTime()) ? null : d;
  } catch (e) {
    return null;
  }
}

