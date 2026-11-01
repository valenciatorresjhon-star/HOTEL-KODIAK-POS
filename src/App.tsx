import React, { useState, useEffect, useMemo } from 'react';
import { 
  Home, 
  Bed, 
  Package, 
  Coins, 
  LayoutDashboard, 
  Users, 
  Calendar, 
  ShieldCheck, 
  Power,
  RefreshCw,
  AlertTriangle,
  CloudLightning,
  LogOut,
  UploadCloud,
  Bell
} from 'lucide-react';

import { Room, Client, Product, Sale, Expense, Shift, ShiftClosure, Reservation, FirebaseUser, INITIAL_ROOMS_DATA, INITIAL_PRODUCTS_DATA, OFFICIAL_ACTIVE_PRODUCT_NAMES, getEmployeeProfile, getEmployeeFullName, isProductVisible, isProductArchivedOrHidden, normalizeProductName, matchOfficialProduct, getCanonicalProductName } from './types';
import { 
  safeGetLocalStorage, 
  safeSetLocalStorage, 
  loadInitialRooms, 
  loadInitialProducts,
  formatCop
} from './utils/storage';

// Component views
import { ShiftLockScreen } from './components/ShiftLockScreen';
import { InicioView } from './components/InicioView';
import { HabitacionesView } from './components/HabitacionesView';
import { ProductosView } from './components/ProductosView';
import { CajaView } from './components/CajaView';
import { DashboardView } from './components/DashboardView';
import { ClientesView } from './components/ClientesView';
import { ReservasView } from './components/ReservasView';
import { CierreTurnoView } from './components/CierreTurnoView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AdminPasswordModal } from './components/AdminPasswordModal';
import hotelLogo from './assets/images/hotel_logo_1783287741164.jpg';
import { buildOfficialRoomsFromExisting, hydrateOfficialRoom, KODIAK_OFFICIAL_ROOMS } from './kodiakRules';

// Firebase Integrations
import { auth, isFirebaseConfigured } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { LoginView } from './components/LoginView';
import { OwnerMobileView } from './components/OwnerMobileView';
import { 
  subscribeToCollection,
  saveRoomToFirestore,
  saveClientToFirestore,
  saveProductToFirestore,
  deleteProductFromFirestore,
  saveSaleAndDecrementStock,
  saveExpenseToFirestore,
  saveShiftToFirestore,
  saveShiftClosureToFirestore,
  saveReservationToFirestore,
  migrateLocalStorageToFirestore,
  logoutUser,
  getUserProfile,
  saveSettingsToFirestore,
  loadHotelSettings,
  saveHotelSettings,
  DEFAULT_KODIAK_CONFIG
} from './services/firebaseService';

// Google Sheets Integration Services
import { syncClosureToGoogleSheets, updateClosureSyncStatus } from './services/googleSheetsService';

// Printer & Cash Drawer Integration Services
import { 
  printReceipt, 
  printShiftClosureReceipt, 
  openCashDrawer,
  getBrowserPrintWindow,
  setBrowserPrintWindow,
  printExpenseReceipt,
  getSettings
} from './services/printerService';

type TabType = 'inicio' | 'habitaciones' | 'productos' | 'caja' | 'dashboard' | 'clientes' | 'reservas' | 'cierre';

// --- ROOM PERSISTENCE HELPERS ---
// Estas funciones evitan que una habitación cambiada visualmente vuelva a un estado viejo al recargar.
// Guardan respaldo local inmediato y, cuando Firestore responde, mezclan siempre la versión más nueva.
function getAnyTimestampMs(value: any): number {
  try {
    if (!value) return 0;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    if (typeof value === 'number') return value;
    if (typeof value?.toDate === 'function') return value.toDate().getTime();
    if (typeof value?.seconds === 'number') return value.seconds * 1000;
    return 0;
  } catch {
    return 0;
  }
}

function getRoomUpdatedMs(room: any): number {
  return Math.max(
    getAnyTimestampMs(room?.updatedAt),
    getAnyTimestampMs(room?.lastSavedAt),
    getAnyTimestampMs(room?.updatedAtClient),
    getAnyTimestampMs(room?.createdAt)
  );
}

function sortRoomsNaturally(roomList: Room[]): Room[] {
  return [...(Array.isArray(roomList) ? roomList : [])].sort((a, b) => {
    return String(a?.nombre || '').localeCompare(String(b?.nombre || ''), undefined, {
      numeric: true,
      sensitivity: 'base'
    });
  });
}

function buildKodiakInitialRooms(): Room[] {
  const nowIso = new Date().toISOString();
  return KODIAK_OFFICIAL_ROOMS.map((room) => hydrateOfficialRoom({
    id: room.id,
    nombre: room.nombre,
    estado: 'disponible' as const,
    updatedAt: nowIso,
    lastSavedAt: nowIso
  } as Room, room));
}

function mergeFirestoreRoomsWithLocalBackup(firestoreRooms: Room[]): Room[] {
  const cloudRooms = Array.isArray(firestoreRooms) ? firestoreRooms : [];
  const localRooms = safeGetLocalStorage<Room[]>('hotel_rooms', []);

  if (!Array.isArray(localRooms) || localRooms.length === 0) {
    return cloudRooms;
  }

  const map = new Map<string, Room>();
  cloudRooms.forEach((room) => {
    if (room?.id) map.set(room.id, room);
  });

  localRooms.forEach((localRoom) => {
    if (!localRoom?.id) return;

    const cloudRoom = map.get(localRoom.id);
    if (!cloudRoom) {
      map.set(localRoom.id, localRoom);
      return;
    }

    const localMs = getRoomUpdatedMs(localRoom);
    const cloudMs = getRoomUpdatedMs(cloudRoom);

    if (localMs > cloudMs) {
      map.set(localRoom.id, { ...cloudRoom, ...localRoom });
    }
  });

  return buildOfficialRoomsFromExisting(Array.from(map.values()) as Room[]);
}

function persistRoomsLocalBackup(roomList: Room[]) {
  try {
    const sorted = sortRoomsNaturally(roomList);
    safeSetLocalStorage('hotel_rooms', sorted);
    safeSetLocalStorage('hotel_rooms_last_saved_at', new Date().toISOString());
  } catch (error) {
    console.warn('No se pudo guardar respaldo local de habitaciones:', error);
  }
}

function areObjectsDifferent(a: any, b: any): boolean {
  try {
    return JSON.stringify(a || null) !== JSON.stringify(b || null);
  } catch {
    return true;
  }
}

function forceArchiveProductForKodiak(product: any): Product {
  if (!product) return product;
  if (!isProductArchivedOrHidden(product)) return product as Product;

  const nowIso = new Date().toISOString();
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
    desactivadoAt: product?.desactivadoAt || product?.deletedAt || nowIso,
    deletedAt: product?.deletedAt || product?.desactivadoAt || nowIso,
    motivoDesactivacion: product?.motivoDesactivacion || 'Producto oculto/archivado por regla de catálogo Hotel Kodiak',
    updatedAt: product?.updatedAt || nowIso,
    clientUpdatedAt: product?.clientUpdatedAt || nowIso
  } as Product;
}

function normalizeProductsForKodiak(productList: Product[]): Product[] {
  const list = Array.isArray(productList) ? productList : [];
  const selected = new Map<string, Product>();
  for (const raw of list) {
    if (!raw) continue;
    const canonical = getCanonicalProductName(raw.nombre);
    if (!OFFICIAL_ACTIVE_PRODUCT_NAMES.includes(canonical as any)) continue;
    const item = { ...raw, nombre: canonical };
    const previous = selected.get(canonical);
    if (!previous) {
      selected.set(canonical, item);
      continue;
    }
    // Preferir documentos activos; luego el movimiento más reciente.
    const prevActive = isProductVisible(previous);
    const nowActive = isProductVisible(item);
    const prevMs = Date.parse(String((previous as any).clientUpdatedAt || previous.updatedAt || 0)) || 0;
    const nowMs = Date.parse(String((item as any).clientUpdatedAt || item.updatedAt || 0)) || 0;
    if ((nowActive && !prevActive) || (nowActive === prevActive && nowMs > prevMs)) {
      selected.set(canonical, item);
    }
  }
  return OFFICIAL_ACTIVE_PRODUCT_NAMES
    .map((name) => selected.get(name))
    .filter((item): item is Product => !!item)
    .map(forceArchiveProductForKodiak);
}

function getVisibleProductsForKodiak(productList: Product[]): Product[] {
  return normalizeProductsForKodiak(productList).filter(isProductVisible);
}

// --- SINGLE CASHBOX / ACTIVE SHIFT USER GUARD ---
function normalizeEmployeeMatchValue(value: any): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function getKnownEmployeeAlias(value: any): string {
  const normalized = normalizeEmployeeMatchValue(value);

  if (normalized.includes('alicia')) return 'alicia';
  if (normalized.includes('paola')) return 'paola';
  if (normalized.includes('mileidys') || normalized.includes('mileydi') || normalized.includes('maria-mileydi')) return 'mileidys';

  return '';
}

function getDisplayOperatorName(value: any): string {
  return getEmployeeFullName(value || 'Recepcionista');
}

function isSameActiveShiftOperator(activeShift: Shift | null, userProfile: FirebaseUser | null, firebaseUser: any): boolean {
  if (!activeShift || !userProfile) return false;

  const shiftValues = [
    (activeShift as any).empleada,
    (activeShift as any).employeeName,
    (activeShift as any).createdByEmail,
    (activeShift as any).createdBy,
    (activeShift as any).uid,
    (activeShift as any).userId
  ].filter(Boolean);

  const profileValues = [
    (userProfile as any).nombre,
    (userProfile as any).nombreCompleto,
    (userProfile as any).displayName,
    (userProfile as any).email,
    (userProfile as any).correo,
    (userProfile as any).uid,
    (userProfile as any).id,
    firebaseUser?.email,
    firebaseUser?.displayName,
    firebaseUser?.uid
  ].filter(Boolean);

  const shiftAliases = shiftValues.map(getKnownEmployeeAlias).filter(Boolean);
  const profileAliases = profileValues.map(getKnownEmployeeAlias).filter(Boolean);

  if (shiftAliases.length > 0 && profileAliases.length > 0) {
    return shiftAliases.some(alias => profileAliases.includes(alias));
  }

  const shiftKeys = shiftValues.map(normalizeEmployeeMatchValue).filter(Boolean);
  const profileKeys = profileValues.map(normalizeEmployeeMatchValue).filter(Boolean);

  return shiftKeys.some((shiftKey) =>
    profileKeys.some((profileKey) => {
      if (!shiftKey || !profileKey) return false;
      if (shiftKey === profileKey) return true;
      if (shiftKey.length >= 6 && profileKey.length >= 6) {
        return shiftKey.includes(profileKey) || profileKey.includes(shiftKey);
      }
      return false;
    })
  );
}


function isAdminAccessProfile(userProfile: FirebaseUser | null, firebaseUser: any): boolean {
  const role = normalizeEmployeeMatchValue((userProfile as any)?.rol || '');
  const email = normalizeEmployeeMatchValue(
    (userProfile as any)?.email ||
    (userProfile as any)?.correo ||
    firebaseUser?.email ||
    ''
  );
  const name = normalizeEmployeeMatchValue(
    (userProfile as any)?.nombre ||
    (userProfile as any)?.nombreCompleto ||
    firebaseUser?.displayName ||
    ''
  );

  return (
    role === 'admin' ||
    role === 'administrador' ||
    email === 'adminhotelkodiakcom' ||
    name.includes('administrador')
  );
}


// --- ALERTAS Y REPORTE DIARIO CENTRALIZADO ---
function getMoneySafe(value: any): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizePayment(method: any): string {
  return String(method || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function isCashLike(method: any): boolean {
  const value = normalizePayment(method);
  return value === 'efectivo' || value.includes('efectivo') || value === 'cash';
}

function isTransferLike(method: any): boolean {
  const value = normalizePayment(method);
  return value.includes('transferencia') || value.includes('transf') || value.includes('banco') || value.includes('nequi') || value.includes('daviplata');
}

function belongsToActiveShift(item: any, shiftId?: string): boolean {
  if (!shiftId) return false;
  return item?.shiftId === shiftId || item?.turnoId === shiftId || item?.turno === shiftId;
}

function isTodayColombiaFromAny(createdAtValue?: any, fechaValue?: string): boolean {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

  if (createdAtValue) {
    try {
      let d: Date | null = null;
      if (typeof createdAtValue?.toDate === 'function') d = createdAtValue.toDate();
      else if (typeof createdAtValue?.seconds === 'number') d = new Date(createdAtValue.seconds * 1000);
      else if (createdAtValue instanceof Date) d = createdAtValue;
      else if (typeof createdAtValue === 'string') d = new Date(createdAtValue);

      if (d && !Number.isNaN(d.getTime())) {
        const dateStr = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Bogota',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(d);
        if (dateStr === today) return true;
      }
    } catch {}
  }

  if (fechaValue) {
    const clean = String(fechaValue).trim();
    if (clean === today) return true;
    if (clean.includes('/')) {
      const parts = clean.split('/');
      if (parts.length === 3) {
        const dd = parts[0].padStart(2, '0');
        const mm = parts[1].padStart(2, '0');
        const yyyy = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
        return `${yyyy}-${mm}-${dd}` === today;
      }
    }
  }

  return false;
}

function getDateMsSafe(value: any): number {
  try {
    if (!value) return 0;
    if (typeof value?.toDate === 'function') return value.toDate().getTime();
    if (typeof value?.seconds === 'number') return value.seconds * 1000;
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  } catch {
    return 0;
  }
}

function computeKodiakReport(activeShift: Shift | null, sales: Sale[], expenses: Expense[], rooms: Room[], products: Product[], reservations: Reservation[]) {
  const activeShiftId = activeShift?.id;
  const validSales = (Array.isArray(sales) ? sales : []).filter((s: any) => s?.type !== 'stock_add' && s?.tipoMovimiento !== 'abastecimiento_inventario' && s?.tipoMovimiento !== 'creacion_producto' && s?.tipoMovimiento !== 'ajuste_inventario' && s?.anulada !== true);
  const validExpenses = Array.isArray(expenses) ? expenses : [];

  const reportSales = activeShiftId
    ? validSales.filter(s => belongsToActiveShift(s, activeShiftId))
    : validSales.filter(s => isTodayColombiaFromAny((s as any).createdAt, (s as any).fecha));

  const reportExpenses = activeShiftId
    ? validExpenses.filter(e => belongsToActiveShift(e, activeShiftId))
    : validExpenses.filter(e => isTodayColombiaFromAny((e as any).createdAt, (e as any).fecha));

  const ventasHabitaciones = reportSales.filter(s => s.tipoVenta === 'habitacion').reduce((sum, s) => sum + getMoneySafe(s.total), 0);
  const ventasProductos = reportSales.filter(s => s.tipoVenta === 'producto').reduce((sum, s) => sum + getMoneySafe(s.total), 0);
  const reservasAbonos = reportSales.filter(s => s.tipoVenta === 'reserva' || s.tipoVenta === 'abono_reserva' || s.tipoVenta === 'saldo_reserva').reduce((sum, s) => sum + getMoneySafe(s.total), 0);
  const horasExtra = reportSales.filter(s => (s as any).horasAdicionales || String(s.concepto || '').toLowerCase().includes('hora')).reduce((sum, s) => sum + getMoneySafe(s.total), 0);

  const efectivo = reportSales.filter(s => isCashLike(s.metodoPago)).reduce((sum, s) => sum + getMoneySafe(s.total), 0);
  const transferencias = reportSales.filter(s => isTransferLike(s.metodoPago)).reduce((sum, s) => sum + getMoneySafe(s.total), 0);
  const totalVentas = reportSales.reduce((sum, s) => sum + getMoneySafe(s.total), 0);

  const gastosEfectivo = reportExpenses.filter(e => isCashLike(e.metodoPago)).reduce((sum, e) => sum + getMoneySafe(e.valor), 0);
  const gastosTransferencia = reportExpenses.filter(e => isTransferLike(e.metodoPago)).reduce((sum, e) => sum + getMoneySafe(e.valor), 0);
  const totalGastos = reportExpenses.reduce((sum, e) => sum + getMoneySafe(e.valor), 0);

  const ocupadas = rooms.filter((r: any) => r.estado === 'ocupada' || r.status === 'occupied' || r.isOccupied === true || r.occupied === true).length;
  const disponibles = Math.max(0, rooms.length - ocupadas);
  const stockBajo = products.filter((p: any) => isProductVisible(p) && Number(p.stock || 0) <= Number(p.stockMinimo || 0)).length;
  const agotados = products.filter((p: any) => isProductVisible(p) && Number(p.stock || 0) <= 0).length;
  const reservasHoy = reservations.filter((r: any) => isTodayColombiaFromAny(r.createdAt, r.checkInDate)).length;

  return {
    scope: activeShiftId ? 'turno activo' : 'día',
    activeShiftId: activeShiftId || '',
    empleadoTurno: activeShift?.empleada || '',
    baseInicial: 0,
    ventasHabitaciones,
    ventasProductos,
    reservasAbonos,
    horasExtra,
    totalVentas,
    efectivo,
    transferencias,
    gastosEfectivo,
    gastosTransferencia,
    totalGastos,
    cajaEsperada: efectivo - gastosEfectivo,
    habitacionesOcupadas: ocupadas,
    habitacionesDisponibles: disponibles,
    productosStockBajo: stockBajo,
    productosAgotados: agotados,
    reservasHoy,
    movimientos: [...reportSales, ...reportExpenses].length,
    ventasDetalle: reportSales,
    gastosDetalle: reportExpenses
  };
}

function computeKodiakAlerts(activeShift: Shift | null, sales: Sale[], expenses: Expense[], rooms: Room[], products: Product[], reservations: Reservation[]) {
  const alerts: any[] = [];
  const now = new Date();

  (products || [])
    .filter(isProductVisible)
    .forEach((p: any) => {
      const stock = Number(p.stock || 0);
      const min = Number(p.stockMinimo || 0);
      if (stock <= 0) {
        alerts.push({
          id: `prod-agotado-${p.id}`,
          title: 'Producto agotado',
          message: `${p.nombre} está agotado. Stock actual: ${stock} un.`,
          severity: 'danger',
          category: 'inventario',
          actionTab: 'productos',
          sourceId: p.id,
          createdAt: now.toISOString()
        });
      } else if (stock <= min) {
        alerts.push({
          id: `prod-bajo-${p.id}`,
          title: 'Stock bajo',
          message: `${p.nombre} está en stock bajo. Quedan ${stock} un. / mínimo ${min}.`,
          severity: 'warning',
          category: 'inventario',
          actionTab: 'productos',
          sourceId: p.id,
          createdAt: now.toISOString()
        });
      }
    });

  if (activeShift?.createdAt) {
    const openedAt = getDateMsSafe(activeShift.createdAt);
    if (openedAt > 0) {
      const hoursOpen = Math.floor((Date.now() - openedAt) / (1000 * 60 * 60));
      if (hoursOpen >= 12) {
        alerts.push({
          id: `turno-largo-${activeShift.id}`,
          title: 'Turno lleva muchas horas abierto',
          message: `El turno de ${activeShift.empleada} lleva aproximadamente ${hoursOpen} horas abierto.`,
          severity: 'warning',
          category: 'turnos',
          actionTab: 'cierre',
          sourceId: activeShift.id,
          createdAt: now.toISOString()
        });
      }
    }
  }

  const shiftExpenses = activeShift?.id ? (expenses || []).filter(e => belongsToActiveShift(e, activeShift.id)) : [];
  shiftExpenses.forEach((e: any) => {
    if (getMoneySafe(e.valor) >= 100000) {
      alerts.push({
        id: `gasto-alto-${e.id}`,
        title: 'Gasto alto registrado',
        message: `${e.concepto || 'Gasto'} por ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(getMoneySafe(e.valor))}.`,
        severity: 'warning',
        category: 'caja',
        actionTab: 'caja',
        sourceId: e.id,
        createdAt: now.toISOString()
      });
    }
  });

  const reservasHoyPendientes = (reservations || []).filter((r: any) =>
    isTodayColombiaFromAny(r.createdAt, r.checkInDate) &&
    String(r.status || '').toLowerCase() !== 'cancelada' &&
    String(r.status || '').toLowerCase() !== 'cumplida'
  );

  if (reservasHoyPendientes.length > 0) {
    alerts.push({
      id: 'reservas-hoy',
      title: 'Reservas para hoy',
      message: `Hay ${reservasHoyPendientes.length} reserva(s) pendientes o confirmadas para hoy.`,
      severity: 'info',
      category: 'reservas',
      actionTab: 'reservas',
      createdAt: now.toISOString()
    });
  }

  const occupiedRooms = (rooms || []).filter((r: any) => r.estado === 'ocupada' || r.status === 'occupied' || r.isOccupied === true || r.occupied === true);
  occupiedRooms.forEach((r: any) => {
    const expectedMs = getDateMsSafe(r.expectedCheckOut || r.expectedCheckOutTime || r.checkOutTime);
    if (expectedMs > 0 && expectedMs < Date.now()) {
      alerts.push({
        id: `checkout-vencido-${r.id}`,
        title: 'Checkout vencido',
        message: `${r.nombre} tiene checkout vencido. Cliente: ${r.cliente || r.clientName || r.occupantName || 'sin dato'}.`,
        severity: 'danger',
        category: 'habitaciones',
        actionTab: 'habitaciones',
        sourceId: r.id,
        createdAt: now.toISOString()
      });
    }
  });

  const rank: Record<string, number> = { danger: 0, warning: 1, info: 2, success: 3 };
  return alerts.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
}

function getAlertClasses(severity: string): string {
  if (severity === 'danger') return 'border-red-500/30 bg-red-500/10 text-red-100';
  if (severity === 'warning') return 'border-amber-500/30 bg-amber-500/10 text-amber-100';
  if (severity === 'success') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100';
  return 'border-indigo-500/30 bg-indigo-500/10 text-indigo-100';
}

function getClosureDateMsForOpening(closure: any): number {
  return Math.max(
    getDateMsSafe(closure?.createdAt),
    getDateMsSafe(closure?.closedAt),
    getDateMsSafe(closure?.updatedAt),
    getDateMsSafe(closure?.fechaCierre)
  );
}

function getClosureNextShiftBase(_closure: any): number {
  // Política del hotel: cada turno comienza desde $0, independientemente
  // del dinero que figure en cierres anteriores. Nunca modificar ese historial.
  return 0;
}

function normalizeClosureForNextOpening(closure: ShiftClosure): ShiftClosure {
  const baseForNextShift = getClosureNextShiftBase(closure);
  return {
    ...(closure as any),
    baseParaSiguienteTurno: baseForNextShift,
    baseSugeridaSiguienteTurno: baseForNextShift,
    nextShiftBase: baseForNextShift,
    cierreDejaCajaParaProximoTurno: false
  } as ShiftClosure;
}

function getLatestClosureForOpening(closures: ShiftClosure[]): ShiftClosure | null {
  const fromState = Array.isArray(closures) ? closures : [];
  const fromLocal = safeGetLocalStorage<ShiftClosure[]>('hotel_shift_closures', []);
  const lastLocalSingle = safeGetLocalStorage<ShiftClosure | null>('hotel_last_shift_closure', null);

  const all = [
    ...fromState,
    ...(Array.isArray(fromLocal) ? fromLocal : []),
    ...(lastLocalSingle ? [lastLocalSingle] : [])
  ].filter(Boolean) as ShiftClosure[];

  if (all.length === 0) return null;

  const byId = new Map<string, ShiftClosure>();
  for (const closure of all) {
    const key = String(closure?.id || closure?.shiftId || Math.random());
    const current = byId.get(key);
    if (!current || getClosureDateMsForOpening(closure) >= getClosureDateMsForOpening(current)) {
      byId.set(key, closure);
    }
  }

  const sorted = Array.from(byId.values()).sort((a, b) => getClosureDateMsForOpening(b) - getClosureDateMsForOpening(a));
  // Usar el cierre más reciente, aunque su valor de entrega sea cero.
  const latest = sorted[0];
  return latest ? normalizeClosureForNextOpening(latest) : null;
}


export default function App() {
  const [hotelSettings, setHotelSettings] = useState<any>(() => {
    return safeGetLocalStorage('hotel_settings', DEFAULT_KODIAK_CONFIG);
  });

  // --- FIREBASE USER STATE ---
  const [firebaseUser, setFirebaseUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);

  // --- ONLINE STATUS ---
  const [onlineStatus, setOnlineStatus] = useState<'online' | 'offline' | 'syncing'>('online');
  const [lastSyncTime, setLastSyncTime] = useState<string>('');

  const updateSyncTimestamp = () => {
    setLastSyncTime(new Date().toLocaleTimeString());
  };

  // --- LOCAL DATA FOR MIGRATION DETECT ---
  const [, setHasLocalData] = useState<boolean>(false);
  const [migrationOpen, setMigrationOpen] = useState<boolean>(false);
  const [migrationLogs, setMigrationLogs] = useState<string[]>([]);
  const [migrating, setMigrating] = useState<boolean>(false);

  // --- STANDARD APPLICATION STATES ---
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [closureInProgress, setClosureInProgress] = useState<boolean>(() => {
    return safeGetLocalStorage<boolean>('hotel_closure_in_progress', false);
  });
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showLockShiftConfirm, setShowLockShiftConfirm] = useState(false);

  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [pendingAdminAction, setPendingAdminAction] = useState<(() => void) | null>(null);

  const [rooms, setRooms] = useState<Room[]>(() => {
    const cachedRooms = safeGetLocalStorage<Room[]>('hotel_rooms', []);
    return Array.isArray(cachedRooms) && cachedRooms.length > 0 ? buildOfficialRoomsFromExisting(cachedRooms) : [];
  });
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [closures, setClosures] = useState<ShiftClosure[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);

  const [activeTab, setActiveTab] = useState<TabType>('inicio');
  const [showNotifications, setShowNotifications] = useState<boolean>(false);

  const dailyReport = useMemo(() => {
    return computeKodiakReport(activeShift, sales, expenses, rooms, products, reservations);
  }, [activeShift, sales, expenses, rooms, products, reservations]);

  const systemAlerts = useMemo(() => {
    return computeKodiakAlerts(activeShift, sales, expenses, rooms, products, reservations);
  }, [activeShift, sales, expenses, rooms, products, reservations]);

  const lastClosureForOpening = useMemo(() => {
    return getLatestClosureForOpening(closures);
  }, [closures]);


  // Double-confirmation closure modals
  const [showFirstClosureConfirm, setShowFirstClosureConfirm] = useState<boolean>(false);
  const [showSecondClosureConfirm, setShowSecondClosureConfirm] = useState<boolean>(false);

  // --- ERROR DIAGNOSTICS FOR ADMIN ---
  interface CapturedError {
    message: string;
    file?: string;
    line?: number;
    col?: number;
    stack?: string;
    timestamp: string;
    action?: string;
  }
  const [diagnosticErrors, setDiagnosticErrors] = useState<CapturedError[]>([]);

  useEffect(() => {
    const parseStack = (stack?: string) => {
      if (!stack) return { file: 'Desconocido', func: 'Desconocido' };
      const lines = stack.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('react-dom') || line.includes('node_modules') || line.includes('console.error')) continue;
        const match = line.match(/at\s+([^\s(]+)\s+\(([^)]+)\)/) || line.match(/at\s+([^\s]+)/);
        if (match) {
          const func = match[1] || 'Acción';
          const fileWithCoords = match[2] || match[1];
          const fileParts = fileWithCoords.split('/');
          const file = fileParts[fileParts.length - 1] || fileWithCoords;
          return { file: file.replace(/\?.*$/, ''), func };
        }
      }
      return { file: 'Sistema', func: 'Ejecución' };
    };

    // Capture unhandled window exceptions
    const handleErrorEvent = (event: ErrorEvent) => {
      const msg = event.message || 'Error de ejecución no capturado';
      const file = event.filename ? event.filename.split('/').pop() : 'script.js';
      const line = event.lineno;
      setDiagnosticErrors(prev => {
        if (prev.length > 0 && prev[0].message === msg) return prev;
        return [
          {
            message: msg,
            file: `${file}:${line}`,
            timestamp: new Date().toLocaleTimeString(),
            action: 'window.onerror'
          },
          ...prev.slice(0, 19)
        ];
      });
    };

    // Capture unhandled promise rejections
    const handleRejectionEvent = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const msg = reason instanceof Error ? reason.message : String(reason);
      const stack = reason instanceof Error ? reason.stack : undefined;
      const parsed = parseStack(stack);
      setDiagnosticErrors(prev => {
        if (prev.length > 0 && prev[0].message === msg) return prev;
        return [
          {
            message: `Promesa rechazada: ${msg}`,
            file: parsed.file,
            timestamp: new Date().toLocaleTimeString(),
            action: parsed.func
          },
          ...prev.slice(0, 19)
        ];
      });
    };

    // Intercept console.error calls
    const originalConsoleError = console.error;
    console.error = (...args: any[]) => {
      originalConsoleError.apply(console, args);
      const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
      if (msg.includes('[vite]') || msg.includes('websocket') || msg.includes('HMR') || msg.includes('benign')) return;

      const stack = new Error().stack;
      const parsed = parseStack(stack);
      setDiagnosticErrors(prev => {
        if (prev.length > 0 && prev[0].message === msg) return prev;
        return [
          {
            message: msg,
            file: parsed.file,
            timestamp: new Date().toLocaleTimeString(),
            action: parsed.func
          },
          ...prev.slice(0, 19)
        ];
      });
    };

    window.addEventListener('error', handleErrorEvent);
    window.addEventListener('unhandledrejection', handleRejectionEvent);

    return () => {
      window.removeEventListener('error', handleErrorEvent);
      window.removeEventListener('unhandledrejection', handleRejectionEvent);
      console.error = originalConsoleError;
    };
  }, []);

  // Monitor connection status
  useEffect(() => {
    const updateOnlineStatus = () => {
      setOnlineStatus(navigator.onLine ? 'online' : 'offline');
    };
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();

    // Check if there is data in localStorage that could be migrated
    const localSales = localStorage.getItem('hotel_sales');
    if (localSales) {
      try {
        const parsed = JSON.parse(localSales);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setHasLocalData(true);
        }
      } catch (e) {}
    }

    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, []);

  // Listen to Firebase Auth state
  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setAuthLoading(false);
      return;
    }

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setAuthLoading(true);
      if (user) {
        setFirebaseUser(user);
        const profile = await getUserProfile(user.uid);
        setUserProfile(profile);
      } else {
        setFirebaseUser(null);
        setUserProfile(null);
      }
      setAuthLoading(false);
    });

    return () => unsubscribeAuth();
  }, []);

  // Subscribe to Firestore collections in Realtime when user logged in
  useEffect(() => {
    if (!userProfile) return;

    setOnlineStatus('syncing');

    // Rooms Real-time Sync
    const unsubRooms = subscribeToCollection<Room>('hotel_rooms', (items) => {
      updateSyncTimestamp();

      const cloudItems = Array.isArray(items) ? items : [];

      if (cloudItems.length === 0) {
        const cachedRooms = safeGetLocalStorage<Room[]>('hotel_rooms', []);

        if (Array.isArray(cachedRooms) && cachedRooms.length > 0) {
          const sortedCached = buildOfficialRoomsFromExisting(cachedRooms);
          setRooms(sortedCached);
          persistRoomsLocalBackup(sortedCached);

          // Si Firestore aparece vacío pero hay respaldo local, se reintenta subirlo.
          if (userProfile?.rol !== 'visor') {
            sortedCached.forEach((room) => {
              saveRoomToFirestore(room).catch((err) => {
                console.warn('No se pudo restaurar habitación local en Firestore:', room?.id, err);
              });
            });
          }
        } else {
          // Auto-seed rooms in firestore if completely empty
          const initial = buildKodiakInitialRooms();
          if (userProfile?.rol === 'admin') {
            initial.forEach((r) => {
              saveRoomToFirestore(r).catch((err) => {
                console.warn('No se pudo crear habitación inicial en Firestore:', r?.id, err);
              });
            });
          }
          setRooms(initial);
          persistRoomsLocalBackup(initial);
        }
      } else {
        // Mezclar Firestore con respaldo local: gana la versión con updatedAt más reciente.
        let currentRooms = mergeFirestoreRoomsWithLocalBackup(cloudItems);

        // Catálogo oficial Hotel Kodiak: se muestran solo 17 habitaciones oficiales.
        // No se borran documentos viejos ni históricos: las duplicadas simplemente no se usan en pantalla.
        currentRooms = buildOfficialRoomsFromExisting(currentRooms as Room[]);

        const sorted = buildOfficialRoomsFromExisting(currentRooms as Room[]);
        setRooms(sorted);
        persistRoomsLocalBackup(sorted);

        // Si el respaldo local tiene una habitación más reciente que la nube, reintentar subirla.
        if (userProfile?.rol !== 'visor') {
          const localRooms = safeGetLocalStorage<Room[]>('hotel_rooms', []);
          localRooms.forEach((localRoom) => {
            const cloudRoom = cloudItems.find((r) => r.id === localRoom.id);
            if (localRoom?.id && getRoomUpdatedMs(localRoom) > getRoomUpdatedMs(cloudRoom)) {
              saveRoomToFirestore(localRoom).catch((err) => {
                console.warn('No se pudo sincronizar habitación local más reciente:', localRoom?.id, err);
              });
            }
          });
        }
      }

      setOnlineStatus('online');
    });

    // Products Real-time Sync (Firebase es la ÚNICA FUENTE DE VERDAD)
    const unsubProducts = subscribeToCollection<Product>('hotel_products', (items) => {
      updateSyncTimestamp();
      const safeArr = normalizeProductsForKodiak(Array.isArray(items) ? items : []);
      const visibleArr = safeArr.filter(isProductVisible);
      console.log('[App hotel_products] recibidos:', safeArr.length, 'visibles:', visibleArr.length, visibleArr.map((p) => p.nombre));
      setProducts(visibleArr);
    });

    // Clients Real-time Sync
    const unsubClients = subscribeToCollection<Client>('hotel_clients', (items) => {
      updateSyncTimestamp();
      setClients(items);
    });

    // Sales Real-time Sync
    const unsubSales = subscribeToCollection<Sale>('hotel_sales', (items) => {
      updateSyncTimestamp();
      // Sort sales by newest first
      const sorted = [...items].sort((a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime());
      setSales(sorted);
    });

    // Expenses Real-time Sync
    const unsubExpenses = subscribeToCollection<Expense>('hotel_expenses', (items) => {
      updateSyncTimestamp();
      setExpenses(items);
    });

    // Shifts Real-time Sync
    const unsubShifts = subscribeToCollection<Shift>('hotel_shifts', (items) => {
      updateSyncTimestamp();
      setOnlineStatus('syncing');

      let hasLegacyBase = false;
      const sanitizedItems = (items || []).map((s) => {
        if (s.estado === 'abierto' && (s.baseInicial === 668500 || (s as any).baseConfirmadaApertura === 668500)) {
          hasLegacyBase = true;
          return {
            ...s,
            baseInicial: 0,
            baseConfirmadaApertura: 0,
            updatedAt: new Date().toISOString()
          };
        }
        return s;
      });

      if (hasLegacyBase) {
        sanitizedItems.forEach((s) => {
          if (s.estado === 'abierto') {
            saveShiftToFirestore(s).catch((err) => console.warn("Error guardando turno con base inicial 0:", err));
          }
        });
      }

      setShifts(sanitizedItems);
      // Elegir SIEMPRE el turno abierto más reciente. Firestore no garantiza el orden
      // de una colección sin orderBy y antes se tomaba el primer 'abierto', que podía
      // ser un turno viejo con una base histórica incorrecta.
      const openShifts = sanitizedItems
        .filter((s) => s.estado === 'abierto')
        .sort((a: any, b: any) => {
          const aMs = new Date(a?.clientUpdatedAt || a?.updatedAt || a?.createdAt || 0).getTime() || 0;
          const bMs = new Date(b?.clientUpdatedAt || b?.updatedAt || b?.createdAt || 0).getTime() || 0;
          return bMs - aMs;
        });
      if (openShifts.length > 1) {
        console.warn('[Hotel Kodiak] Hay varios turnos abiertos. Se usará el más reciente:', openShifts.map((s: any) => ({ id: s.id, baseInicial: s.baseInicial, createdAt: s.createdAt, updatedAt: s.updatedAt })));
      }
      const active = openShifts[0];
      if (active) {
        setActiveShift(active);
        // If closure is in progress, force closure view
        const inProgress = safeGetLocalStorage<boolean>('hotel_closure_in_progress', false);
        if (inProgress) {
          setActiveTab('cierre');
          setClosureInProgress(true);
        }
      } else {
        setActiveShift(null);
      }
      setOnlineStatus('online');
    });

    // Closures Real-time Sync
    const unsubClosures = subscribeToCollection<ShiftClosure>('hotel_shift_closures', (items) => {
      updateSyncTimestamp();
      const safeClosures = Array.isArray(items) ? items.map(normalizeClosureForNextOpening) : [];
      const sortedClosures = [...safeClosures].sort((a, b) => getClosureDateMsForOpening(b) - getClosureDateMsForOpening(a));
      setClosures(sortedClosures);

      const latestClosure = getLatestClosureForOpening(sortedClosures);
      if (latestClosure) {
        safeSetLocalStorage('hotel_last_shift_closure', latestClosure);
        safeSetLocalStorage('hotel_next_shift_base', 0);
      }
    });

    // Reservations Real-time Sync
    const unsubReservations = subscribeToCollection<Reservation>('hotel_reservations', (items) => {
      updateSyncTimestamp();
      setReservations(items);
    });

    // Settings Real-time Sync
    const unsubSettings = subscribeToCollection<any>('hotel_settings', (items) => {
      updateSyncTimestamp();
      const safeItems = Array.isArray(items) ? items : [items];
      const config = safeItems.find(item => item?.id === 'kodiak_config') || (safeItems.length > 0 && safeItems[0]?.hotelName ? safeItems[0] : null);
      if (config) {
        setHotelSettings(config);
        safeSetLocalStorage('hotel_settings', config);
      } else {
        const localCached = safeGetLocalStorage('hotel_settings', DEFAULT_KODIAK_CONFIG);
        setHotelSettings(localCached);
      }
    });

    return () => {
      unsubRooms();
      unsubProducts();
      unsubClients();
      unsubSales();
      unsubExpenses();
      unsubShifts();
      unsubClosures();
      unsubReservations();
      unsubSettings();
    };
  }, [userProfile]);

  // Limpiar únicamente la sugerencia de apertura, sin alterar datos de cierres.
  useEffect(() => {
    safeSetLocalStorage('hotel_next_shift_base', 0);
  }, []);

  // Global guards for closure in progress
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (closureInProgress) {
        const msg = 'Cierre de caja en proceso. Debe completarlo para continuar.';
        e.preventDefault();
        e.returnValue = msg;
        return msg;
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (closureInProgress && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [closureInProgress]);

  const requireAdminPassword = (action: () => void) => {
    setPendingAdminAction(() => action);
    setAdminModalOpen(true);
  };

  const confirmAdminPassword = (password: string): boolean => {
    if (password !== '4321') {
      return false;
    }
    setAdminModalOpen(false);
    if (typeof pendingAdminAction === 'function') {
      pendingAdminAction();
    }
    setPendingAdminAction(null);
    return true;
  };

  // Unified tab change helper with safety checks
  const handleTabChange = (targetTab: TabType) => {
    if (closureInProgress) {
      window.alert('Cierre de turno en proceso. Debe completarlo para continuar.');
      return;
    }

    if (targetTab === 'dashboard') {
      requireAdminPassword(() => {
        setActiveTab('dashboard');
      });
      return;
    }

    if (targetTab === 'cierre') {
      if (userProfile?.rol === 'visor') {
        window.alert('Su rol de visor/propietario no tiene permiso para acceder al módulo de cierre.');
        return;
      }
      if (!activeShift) {
        window.alert('No hay ningún turno abierto actualmente para realizar el cierre.');
        return;
      }
      console.log("CLICK EN CIERRE");
      console.log("rol actual:", userProfile?.rol);
      console.log("turno activo:", activeShift);
      console.log("vista actual antes:", activeTab);

      setShowFirstClosureConfirm(true);
      return;
    }

    setActiveTab(targetTab);
  };

  // Update handlers pushing directly to Firebase
  const handleOpenShift = async (newShift: Shift) => {
    setOnlineStatus('syncing');
    // Segunda protección en el guardado: ninguna apertura nueva hereda efectivo.
    // No se modifican turnos existentes ni cierres históricos.
    const shiftWithZeroBase: Shift = {
      ...newShift,
      baseInicial: 0,
      baseConfirmadaApertura: 0,
      diferenciaBaseVsCierreAnterior: 0,
      aperturaConDiferencia: false
    };
    await saveShiftToFirestore(shiftWithZeroBase);
    setActiveShift(shiftWithZeroBase);
    setActiveTab('inicio');
    setOnlineStatus('online');
  };

  const handleUpdateRooms = (updatedRooms: Room[]) => {
    setOnlineStatus('syncing');

    const safeArr = buildOfficialRoomsFromExisting(Array.isArray(updatedRooms) ? updatedRooms : []);
    const nowIso = new Date().toISOString();

    // 1. Guardar inmediatamente en pantalla y respaldo local.
    // Esto evita que al cerrar y volver a entrar se pierda el cambio visual.
    const roomsWithTimestamp = safeArr.map((room) => {
      const previous = rooms.find((ex) => ex.id === room.id);
      const changed = areObjectsDifferent(previous, room);

      if (changed) {
        return {
          ...room,
          updatedAt: nowIso,
          lastSavedAt: nowIso,
          updatedBy: auth?.currentUser?.uid || userProfile?.uid || 'system'
        } as Room;
      }

      return room;
    });

    const sortedRooms = sortRoomsNaturally(roomsWithTimestamp);
    setRooms(sortedRooms);
    persistRoomsLocalBackup(sortedRooms);

    // 2. Subir solamente las habitaciones que cambiaron.
    const changedRooms = sortedRooms.filter((room) => {
      const previous = rooms.find((ex) => ex.id === room.id);
      return areObjectsDifferent(previous, room);
    });

    if (changedRooms.length === 0) {
      setOnlineStatus('online');
      return;
    }

    Promise.allSettled(changedRooms.map((room) => saveRoomToFirestore(room)))
      .then((results) => {
        const failed = results.filter((result) => result.status === 'rejected');

        if (failed.length > 0) {
          console.warn('Algunas habitaciones no se pudieron guardar en Firestore. Quedaron en respaldo local:', failed);
          setOnlineStatus(navigator.onLine ? 'syncing' : 'offline');
          return;
        }

        console.log(`Habitaciones guardadas correctamente en Firestore: ${changedRooms.length}`);
        setOnlineStatus('online');
      })
      .catch((error) => {
        console.error('Error guardando habitaciones en Firestore. Se conserva respaldo local:', error);
        setOnlineStatus(navigator.onLine ? 'syncing' : 'offline');
      });
  };

  const handleUpdateClients = (updatedClients: Client[]) => {
    setOnlineStatus('syncing');
    const safeArr = Array.isArray(updatedClients) ? updatedClients : [];
    safeArr.forEach((c) => {
      const existing = clients.find((ex) => ex.id === c.id);
      if (JSON.stringify(existing) !== JSON.stringify(c)) {
        saveClientToFirestore(c);
      }
    });
    setOnlineStatus('online');
  };

  const handleUpdateProducts = async (updatedProducts: Product[]) => {
    setOnlineStatus('syncing');
    const safeArr = normalizeProductsForKodiak(Array.isArray(updatedProducts) ? updatedProducts : []);
    const visibleArr = safeArr.filter(isProductVisible);

    console.log("[handleUpdateProducts] Actualizando productos:", safeArr.length, "Visibles:", visibleArr.length);

    // Actualización inmediata en pantalla y respaldo local.
    // Esto evita que productos archivados como PAPEL sigan visibles mientras Firebase responde.
    setProducts(visibleArr);
    safeSetLocalStorage('hotel_products', safeArr);

    try {
      // Evitar reescribir el stock de los otros 26 productos con una copia
      // anterior cuando se edita o abastece solamente uno.
      const changed = safeArr.filter((p) => {
        const original = products.find((old) => old.id === p.id);
        if (!original) return true;
        return ['nombre','precio','stock','stockMinimo','categoria','activo','archivado','oculto']
          .some((key) => (p as any)[key] !== (original as any)[key]);
      });
      await Promise.all(changed.map((p) => saveProductToFirestore(p)));
    } catch (err) {
      console.error("[handleUpdateProducts] Error al guardar productos:", err);
      throw err;
    } finally {
      setOnlineStatus('online');
    }
  };

  const handleUpdateReservations = (updatedReservations: Reservation[]) => {
    setOnlineStatus('syncing');
    const safeArr = Array.isArray(updatedReservations) ? updatedReservations : [];
    safeArr.forEach((r) => {
      const existing = reservations.find((ex) => ex.id === r.id);
      if (JSON.stringify(existing) !== JSON.stringify(r)) {
        saveReservationToFirestore(r);
      }
    });
    setOnlineStatus('online');
  };

  const handleAddSale = async (newSale: Sale) => {
    setOnlineStatus('syncing');

    // Ensure the employee name stored is the full name if we can match it
    if (newSale.empleada) {
      newSale.empleada = getEmployeeFullName(newSale.empleada);
    } else if (activeShift?.empleada) {
      newSale.empleada = getEmployeeFullName(activeShift.empleada);
    }
    if (newSale.employeeName) {
      newSale.employeeName = getEmployeeFullName(newSale.employeeName);
    }

    const isInventoryStockMovement =
      newSale.metodoPago === 'N/A' ||
      (newSale.type || '').startsWith('stock_') ||
      (newSale.tipoVenta === 'producto' && Number(newSale.total || 0) <= 0) ||
      newSale.tipoMovimiento === 'abastecimiento_inventario' ||
      newSale.tipoMovimiento === 'entrada_inventario' ||
      (newSale as any).inventoryMovementType === 'entrada' ||
      (newSale as any).motivoInventario;

    // Una venta de productos debe guardar simultáneamente el ingreso
    // y el descuento de inventario en Firestore. Las entradas de stock
    // son solo Kardex y no descuentan existencias.
    const productId = String(
      (newSale as any).productoFirestoreId || newSale.productoId || ''
    ).trim();
    const productToDecrement =
      !isInventoryStockMovement && newSale.tipoVenta === 'producto'
        ? { id: productId, qty: Number(newSale.cantidad || 0) }
        : undefined;

    const initialPrintWindow = getBrowserPrintWindow();

    try {
      const stockFinal = await saveSaleAndDecrementStock(newSale, productToDecrement);

      if (productToDecrement) {
        // Actualización inmediata en pantalla después de confirmar la transacción.
        setSales((prev) => [newSale, ...prev.filter((sale) => sale.id !== newSale.id)]);
        if (typeof stockFinal === 'number') {
          setProducts((prev) => prev.map((product: any) => {
            const id = String(product.firestoreId || product.documentId || product.docId || product.id);
            if (id !== productId && String(product.id) !== productId) return product;
            return {
              ...product,
              stock: stockFinal,
              estado: stockFinal === 0 ? 'Agotado' :
                stockFinal <= Number(product.stockMinimo || 0) ? 'Bajo stock' : 'Disponible'
            };
          }));
        }
      }
      setOnlineStatus('online');

      if (productToDecrement) {
        // ProductosView gestiona su comprobante y cajón una sola vez,
        // después de confirmar que la venta y el stock quedaron guardados.
        return;
      }

      if (isInventoryStockMovement) {
        // Abastecer inventario solo guarda trazabilidad. No imprime, no abre cajón.
        return;
      }

      // --- INTEGRATED PRINTER & DRAWER LOGIC AFTER SUCCESSFUL SALE ---
      const autoPrint = hotelSettings?.autoPrintEnabled ?? true;
      const autoOpen = hotelSettings?.autoOpenDrawer ?? true;
      const cashOnly = hotelSettings?.openDrawerCashOnly ?? true;

      // Check if cash drawer should open
      const isCashMovement = newSale.metodoPago === 'Efectivo' && newSale.total > 0;
      const triggerDrawer = autoOpen && (!cashOnly || isCashMovement) && isCashMovement;

      if (triggerDrawer) {
        try {
          await openCashDrawer();
        } catch (err: any) {
          console.error("Fallo apertura cajón:", err);
        }
      }

      // Check if receipt should print
      let shouldPrint = false;
      if (autoPrint) {
        if (newSale.tipoVenta === 'producto') {
          shouldPrint = hotelSettings?.printOnSale ?? true;
        } else if (newSale.tipoVenta === 'habitacion') {
          const isExtraHours = (newSale.horasAdicionales && newSale.horasAdicionales > 0) || 
                                (newSale.concepto && newSale.concepto.includes("Horas Extras"));
          if (isExtraHours) {
            shouldPrint = hotelSettings?.printOnExtraHours ?? true;
          } else {
            shouldPrint = hotelSettings?.printOnRoomCharge ?? true;
          }
        } else if (newSale.tipoVenta === 'reserva' || newSale.tipoVenta === 'abono_reserva' || newSale.tipoVenta === 'saldo_reserva') {
          shouldPrint = true; // Always print reservations / deposits if printer is enabled
        }
      }

      if (shouldPrint) {
        try {
          const empresaReciboNombre = String(
            (newSale as any).empresaNombre ||
            (newSale as any).empresa ||
            (newSale as any).razonSocial ||
            (newSale as any).empresaFacturacion ||
            (newSale as any).companyName ||
            ''
          ).trim().toUpperCase();

          const empresaReciboNit = String(
            (newSale as any).empresaNit ||
            (newSale as any).nitEmpresa ||
            (newSale as any).nitFacturacion ||
            (newSale as any).companyNit ||
            (newSale as any).clientNit ||
            (newSale as any).nit ||
            ''
          ).trim();

          const facturarEmpresaRecibo = Boolean(
            empresaReciboNombre ||
            empresaReciboNit ||
            (newSale as any).facturarEmpresa ||
            (newSale as any).esEmpresa
          );

          const receiptData = {
            id: newSale.id,
            fecha: newSale.fecha,
            hora: newSale.hora,
            employeeName: newSale.empleada || activeShift?.empleada || 'Recepcionista',
            empleada: newSale.empleada || activeShift?.empleada || 'Recepcionista',
            turno: activeShift?.id ? `Turno #${activeShift.id.slice(-4).toUpperCase()}` : 'N/A',

            cliente: newSale.clienteNombre || 'Cliente General',
            clienteNombre: newSale.clienteNombre || 'Cliente General',
            documento: newSale.clienteCedula || '',
            clienteCedula: newSale.clienteCedula || '',

            metodoPago: newSale.metodoPago,
            metodo: newSale.metodoPago,
            total: newSale.total,
            valor: newSale.total,

            tipoVenta: newSale.tipoVenta,
            tipo: newSale.tipoVenta,

            facturarEmpresa: facturarEmpresaRecibo,
            esEmpresa: facturarEmpresaRecibo,

            empresa: empresaReciboNombre,
            empresaNombre: empresaReciboNombre,
            razonSocial: empresaReciboNombre,
            empresaFacturacion: empresaReciboNombre,
            companyName: empresaReciboNombre,

            nitEmpresa: empresaReciboNit,
            empresaNit: empresaReciboNit,
            nitFacturacion: empresaReciboNit,
            companyNit: empresaReciboNit,
            clientNit: empresaReciboNit,

            conceptos: [
              {
                cantidad: newSale.cantidad || 1,
                descripcion: newSale.concepto || 'Venta general',
                precio: newSale.total
              }
            ],

            habitacion: newSale.habitacionNombre || '',
            habitacionNombre: newSale.habitacionNombre || '',
            horasAdicionales: newSale.horasAdicionales || 0,

            observaciones: facturarEmpresaRecibo
              ? `FACTURAR A EMPRESA | Empresa: ${empresaReciboNombre} | NIT Empresa: ${empresaReciboNit}`
              : ((newSale as any).observaciones || '')
          };

          console.log('[APP RECIBO EMPRESA/NIT]', {
            empresaReciboNombre,
            empresaReciboNit,
            facturarEmpresaRecibo,
            newSale,
            receiptData
          });
          await printReceipt(receiptData);
        } catch (err: any) {
          console.error("Fallo impresión recibo de venta:", err);
        }
      }
    } catch (error) {
      setOnlineStatus('online');
      throw error;
    } finally {
      // Clean up pre-opened window if not consumed by printReceipt
      const currentPrintWindow = getBrowserPrintWindow();
      if (currentPrintWindow && currentPrintWindow === initialPrintWindow) {
        currentPrintWindow.close();
        setBrowserPrintWindow(null);
      }
    }
  };

  const handleAddExpense = async (newExpense: Expense) => {
    setOnlineStatus('syncing');

    // Ensure the employee name stored is the full name if we can match it
    if (newExpense.empleada) {
      newExpense.empleada = getEmployeeFullName(newExpense.empleada);
    } else if (activeShift?.empleada) {
      newExpense.empleada = getEmployeeFullName(activeShift.empleada);
    }

    const initialPrintWindow = getBrowserPrintWindow();

    try {
      // 1. Save expense to Firestore
      await saveExpenseToFirestore(newExpense);
      setOnlineStatus('online');

      // 2. Trigger receipt printing
      try {
        await printExpenseReceipt(newExpense, initialPrintWindow);
      } catch (err: any) {
        console.error("Fallo impresión recibo de egreso:", err);
      }

      // --- INTEGRATED DRAWER LOGIC AFTER EGRESO ---
      const autoOpen = hotelSettings?.autoOpenDrawer ?? true;
      if (autoOpen && newExpense.metodoPago === 'Efectivo' && newExpense.valor > 0) {
        try {
          await openCashDrawer(
            'expense',
            newExpense.id,
            newExpense.valor,
            newExpense.metodoPago,
            newExpense.empleada,
            newExpense.createdBy || ''
          );
        } catch (err: any) {
          console.error("Fallo apertura cajón por egreso:", err);
        }
      }
    } finally {
      // Clean up pre-opened window if not consumed
      const currentPrintWindow = getBrowserPrintWindow();
      if (currentPrintWindow && currentPrintWindow === initialPrintWindow) {
        currentPrintWindow.close();
        setBrowserPrintWindow(null);
      }
    }
  };

  // Perform permanent shift closure
  const handleConfirmClosure = async (closure: ShiftClosure) => {
    setOnlineStatus('syncing');
    setClosureInProgress(true);

    // Conservar el efectivo declarado en el cierre como dato histórico.
    // El turno siguiente NO recibe ese monto como base contable.
    (closure as any).baseParaSiguienteTurno = 0;
    (closure as any).baseSugeridaSiguienteTurno = 0;
    (closure as any).nextShiftBase = 0;
    (closure as any).cierreDejaCajaParaProximoTurno = false;

    safeSetLocalStorage('hotel_last_shift_closure', closure);
    safeSetLocalStorage('hotel_next_shift_base', 0);
    setClosures((prev) => [normalizeClosureForNextOpening(closure), ...prev.filter((item) => item.id !== closure.id)]);

    try {
      const isEmergency = !!(closure as any).cierreEmergencia;

      // 1. Save closure details to Firestore (or local storage fallback) if not already saved by the emergency handler
      if (!isEmergency) {
        if (isFirebaseConfigured) {
          try {
            await saveShiftClosureToFirestore(closure);
          } catch (fErr: any) {
            console.warn("Fallo guardado de cierre en Firestore, respaldando localmente:", fErr);
            // Local storage fallback
            const list = safeGetLocalStorage<ShiftClosure[]>('hotel_shift_closures', []);
            list.unshift(closure);
            safeSetLocalStorage('hotel_shift_closures', list);
          }
        } else {
          const list = safeGetLocalStorage<ShiftClosure[]>('hotel_shift_closures', []);
          list.unshift(closure);
          safeSetLocalStorage('hotel_shift_closures', list);
        }
      }

      // Trigger Google Sheets automatic sync if enabled
      if (hotelSettings?.googleSheetsEnabled) {
        setTimeout(async () => {
          try {
            const syncResult = await syncClosureToGoogleSheets(closure, hotelSettings);
            if (syncResult.success) {
              await updateClosureSyncStatus(closure.id, 'synced');
            } else {
              await updateClosureSyncStatus(closure.id, 'failed', syncResult.error);
            }
          } catch (err: any) {
            console.error("Fallo sincronización automática con Google Sheets:", err);
            await updateClosureSyncStatus(closure.id, 'failed', err?.message || String(err));
          }
        }, 500);
      }

      // 2. Mark active shift as closed if not already closed by the emergency handler
      if (activeShift) {
        const closedShift = { ...activeShift, estado: 'cerrado' as const };
        setActiveShift(null); // Decouple immediately!
        
        if (!isEmergency) {
          if (isFirebaseConfigured) {
            try {
              await saveShiftToFirestore(closedShift);
            } catch (fErr: any) {
              console.warn("Fallo guardado de turno cerrado en Firestore, respaldando localmente:", fErr);
              // Local storage fallback
              const list = safeGetLocalStorage<Shift[]>('hotel_shifts', []);
              const idx = list.findIndex(s => s.id === closedShift.id);
              if (idx >= 0) {
                list[idx] = closedShift;
              } else {
                list.push(closedShift);
              }
              safeSetLocalStorage('hotel_shifts', list);
            }
          } else {
            const list = safeGetLocalStorage<Shift[]>('hotel_shifts', []);
            const idx = list.findIndex(s => s.id === closedShift.id);
            if (idx >= 0) {
              list[idx] = closedShift;
            } else {
              list.push(closedShift);
            }
            safeSetLocalStorage('hotel_shifts', list);
          }
        }
      } else {
        setActiveShift(null);
      }

      // 3. Reset local progress states and transition to lock screen
      safeSetLocalStorage('hotel_closure_in_progress', false);
      
      // Comprehensive state and cache cleanup to prevent active shift leakage
      setActiveShift(null);
      setClosureInProgress(false);

      localStorage.removeItem("activeShift");
      localStorage.removeItem("currentShift");
      localStorage.removeItem("hotel_active_shift");
      localStorage.removeItem("hotel_closure_in_progress");

      sessionStorage.removeItem("activeShift");
      sessionStorage.removeItem("currentShift");

      setActiveTab('inicio');
      setOnlineStatus('online');

      alert("Cierre de turno registrado correctamente. Ahora debe abrir un nuevo turno para continuar operando.");

      // 4. Try printing and opening cash drawer COMPLETELY asynchronously and safely
      setTimeout(() => {
        if ((closure as any).cierreEmergencia) {
          console.log("Cierre de emergencia activo: omitiendo impresión automática y apertura de cajón.");
          return;
        }
        const performAsyncPostClose = async () => {
          try {
            const settings = getSettings();
            
            // In browser mode, we do NOT auto-print/auto-open cash drawer during shift close to avoid any blocking/hanging
            if (settings.printerType === 'browser') {
              console.log("Modo browser activo: no se realiza apertura de cajón ni impresión automática de cierre para evitar bloqueos.");
              return;
            }

            const autoPrint = settings.autoPrintEnabled ?? true;
            const autoOpen = settings.autoOpenDrawer ?? true;

            if (autoOpen) {
              try {
                await openCashDrawer();
              } catch (drawerErr) {
                console.warn("No se pudo abrir el cajón automáticamente tras el cierre:", drawerErr);
              }
            }

            if (autoPrint) {
              try {
                await printShiftClosureReceipt(closure, null);
              } catch (printErr) {
                console.warn("No se pudo imprimir el comprobante automáticamente tras el cierre:", printErr);
              }
            }
          } catch (err) {
            console.warn("Error en proceso post-cierre asíncrono:", err);
          }
        };
        performAsyncPostClose();
      }, 200);

    } catch (error: any) {
      console.error("ERROR REAL AL CONSOLIDAR CIERRE:", error);
      alert("Ocurrió un error inesperado al cerrar el turno: " + (error.message || String(error)));
    } finally {
      setClosureInProgress(false);
    }
  };

  // Temporarily lock shift (back to lock screen)
  const handleForceLockShift = () => {
    setShowLockShiftConfirm(true);
  };

  const handleConfirmLockShift = () => {
    setShowLockShiftConfirm(false);
    setActiveShift(null);
  };

  // Firebase Log Out
  const handleFirebaseLogout = () => {
    setShowLogoutConfirm(true);
  };

  const handleConfirmLogout = async () => {
    setShowLogoutConfirm(false);
    try {
      await logoutUser();
    } catch (err) {
      console.warn("Advertencia al desconectar usuario de Firebase:", err);
    }
    // Clean all session & local state so view routes to LoginView immediately
    setFirebaseUser(null);
    setUserProfile(null);
    setActiveShift(null);
    setClosureInProgress(false);
    safeSetLocalStorage('hotel_closure_in_progress', false);
    localStorage.removeItem('hotel_closure_in_progress');
    localStorage.removeItem('activeShift');
    localStorage.removeItem('currentShift');
    localStorage.removeItem('hotel_active_shift');
    sessionStorage.removeItem('activeShift');
    sessionStorage.removeItem('currentShift');
    setActiveTab('inicio');
  };

  useEffect(() => {
    (window as any).cerrarSesion = handleConfirmLogout;
    if (typeof window !== 'undefined' && window.location.search.toLowerCase().includes('logout')) {
      handleConfirmLogout().then(() => {
        try {
          window.history.replaceState({}, '', window.location.pathname);
        } catch {}
      });
    }
    return () => {
      delete (window as any).cerrarSesion;
    };
  }, []);

  // Global Confirmation Modals for Logout and Shift Lock
  const renderGlobalModals = () => (
    <>
      {/* Modal Confirmación Cerrar Sesión */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md overflow-hidden p-6 shadow-2xl flex flex-col space-y-4">
            <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
              <div className="bg-red-500/10 p-2.5 rounded-2xl text-red-400 border border-red-500/20">
                <LogOut className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-wider">
                  Cerrar Sesión
                </h3>
                <p className="text-[11px] text-slate-400">Hotel Kodiak POS</p>
              </div>
            </div>
            
            <p className="text-slate-300 text-xs leading-relaxed">
              ¿Desea cerrar la sesión de su cuenta y desconectar este dispositivo del sistema?
            </p>

            {closureInProgress && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-[11px] text-amber-300">
                Aviso: Se cancelará el proceso de cierre de turno en pantalla.
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="py-2.5 px-4.5 border border-slate-800 hover:bg-slate-800 rounded-xl text-slate-300 text-xs font-bold transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmLogout}
                className="py-2.5 px-5 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-red-900/20 flex items-center gap-2 cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
                <span>Sí, Cerrar Sesión</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmación Bloqueo de Turno */}
      {showLockShiftConfirm && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md overflow-hidden p-6 shadow-2xl flex flex-col space-y-4">
            <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
              <div className="bg-amber-500/10 p-2.5 rounded-2xl text-amber-400 border border-amber-500/20">
                <Power className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-wider">
                  Bloquear Pantalla
                </h3>
                <p className="text-[11px] text-slate-400">Protección del POS</p>
              </div>
            </div>
            
            <p className="text-slate-300 text-xs leading-relaxed">
              ¿Está seguro de salir a la pantalla de bloqueo? El turno actual continuará abierto en segundo plano.
            </p>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowLockShiftConfirm(false)}
                className="py-2.5 px-4.5 border border-slate-800 hover:bg-slate-800 rounded-xl text-slate-300 text-xs font-bold transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmLockShift}
                className="py-2.5 px-5 bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-amber-900/20 flex items-center gap-2 cursor-pointer"
              >
                <Power className="h-4 w-4" />
                <span>Bloquear Pantalla</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  // Execute storage migration
  const handleExecuteMigration = async () => {
    setMigrating(true);
    setMigrationLogs(['Iniciando migración de datos locales a Firestore...']);
    
    const result = await migrateLocalStorageToFirestore((msg) => {
      setMigrationLogs(prev => [...prev, msg]);
    });

    if (result.success) {
      setHasLocalData(false);
      localStorage.removeItem('hotel_sales'); // Clear to prevent nagging
      setMigrationLogs(prev => [...prev, `¡ÉXITO! Se migraron ${result.count} registros totales a Firestore.`]);
    }
    setMigrating(false);
  };

  // --- RENDERING ROUTER ---

  // 1. Loading Authentication Profile State
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <RefreshCw className="h-8 w-8 text-emerald-400 animate-spin" />
          <p className="text-sm font-bold text-slate-300 uppercase tracking-widest">Sincronizando Hotel Kodiak POS...</p>
          <span className="text-xs text-slate-500">Conectando con la base de datos Firestore...</span>
        </div>
      </div>
    );
  }

  // 2. Unauthenticated: Render Auth Login
  if (!firebaseUser || !userProfile) {
    return <LoginView onLoginSuccess={(u, p) => {
      setFirebaseUser(u);
      setUserProfile(p);
    }} />;
  }

  // 3. Authenticated as Viewer (Visor - Propietario Mobile View)
  if (userProfile.rol === 'visor') {
    return (
      <>
        <OwnerMobileView
          rooms={rooms}
          clients={clients}
          products={products}
          sales={sales}
          expenses={expenses}
          shifts={shifts}
          closures={closures}
          reservations={reservations}
          userProfile={userProfile}
          onlineStatus={onlineStatus}
          onLogout={handleFirebaseLogout}
          hotelSettings={hotelSettings}
          systemAlerts={systemAlerts}
          dailyReport={dailyReport}
        />
        {renderGlobalModals()}
      </>
    );
  }

  // 4. Authenticated as Receptionist / Admin but Turn is Closed (Lock screen)
  if (!activeShift) {
    return (
      <ErrorBoundary fallbackMessage="Error en la pantalla de autenticación y apertura de turnos.">
        <div className="min-h-screen bg-slate-950 flex flex-col">
          {/* Shift lock screen header with logout options */}
          <div className="bg-slate-900 border-b border-slate-800/80 px-6 py-3.5 flex justify-between items-center relative z-20">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Dispositivo conectado en la nube</span>
            </div>
            <button
              onClick={handleFirebaseLogout}
              className="text-xs font-black text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Cerrar sesión de la cuenta"
            >
              <LogOut className="h-4 w-4" />
              <span>Cerrar Sesión</span>
            </button>
          </div>
          
          <div className="flex-1 flex flex-col justify-center">
            <ShiftLockScreen onOpenShift={handleOpenShift} lastClosure={lastClosureForOpening} />
          </div>
        </div>
        {renderGlobalModals()}
      </ErrorBoundary>
    );
  }


  // 5. Single cashbox guard:
  // Si ya hay un turno abierto por una empleada, otra cuenta operativa no puede entrar al POS.
  // El propietario/visor ya fue enviado arriba a OwnerMobileView y solo observa.
  const currentUserIsShiftOperator = isSameActiveShiftOperator(activeShift, userProfile, firebaseUser);
  const currentUserIsAdmin = isAdminAccessProfile(userProfile, firebaseUser);

  if (activeShift && !currentUserIsAdmin && (userProfile as any).rol !== 'visor' && !currentUserIsShiftOperator) {
    const operatorName = getDisplayOperatorName(activeShift.empleada);
    const currentUserName = getDisplayOperatorName((userProfile as any)?.nombre || (userProfile as any)?.email || firebaseUser?.email || 'esta cuenta');

    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl border border-amber-500/30 bg-amber-500/10 flex items-center justify-center text-amber-400">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-lg font-black text-white uppercase tracking-tight">Caja única activa</h1>
              <p className="text-xs text-slate-400">Hotel Kodiak POS protege la caja física.</p>
            </div>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3">
            <p className="text-sm text-slate-300 leading-relaxed">
              Actualmente existe un turno abierto por:
            </p>
            <p className="text-base font-black text-emerald-400">{operatorName}</p>
            <div className="border-t border-slate-800 pt-3 text-xs text-slate-400 leading-relaxed">
              Usted inició sesión como <strong className="text-white">{currentUserName}</strong>. Para evitar doble caja, doble base inicial o movimientos mezclados, esta cuenta no puede operar hasta que se cierre el turno actual.
            </div>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-3 text-xs text-amber-200 leading-relaxed">
            El administrador puede entrar en cualquier momento. El propietario/visor entra solo para consultar. Las recepcionistas deben esperar a que se cierre el turno actual.
          </div>

          <button
            type="button"
            onClick={handleFirebaseLogout}
            className="w-full py-3 rounded-2xl bg-red-600 hover:bg-red-500 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
            Cerrar esta sesión
          </button>
        </div>
        {renderGlobalModals()}
      </div>
    );
  }

  // 6. Full PC View (Admin / Recepcionista operating active shift)
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col pb-24 selection:bg-emerald-500/20 font-sans">
      
      {/* Top bar header */}
      <header className="sticky top-0 z-40 bg-slate-900/80 backdrop-blur-md border-b border-slate-900/90 px-4 sm:px-6 py-3 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 border border-slate-800 bg-slate-950 rounded-xl flex items-center justify-center overflow-hidden">
            <img 
              src={hotelLogo} 
              alt="Hotel Kodiak Logo" 
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-extrabold text-white tracking-tight uppercase">HOTEL KODIAK POS</h1>
              <span className={`w-2 h-2 rounded-full ${
                onlineStatus === 'online' ? 'bg-emerald-500' :
                onlineStatus === 'syncing' ? 'bg-amber-500 animate-spin' : 'bg-red-500'
              }`} />
            </div>
            <div className="flex flex-col text-left">
              <span className="text-[9px] text-slate-500 uppercase font-black tracking-wider block">
                Atendido por:
              </span>
              <span className="text-xs font-bold text-emerald-400 block transition-all leading-tight">
                {getEmployeeProfile(activeShift.empleada)?.nombreCompleto || activeShift.empleada}
              </span>
              <span className="text-[9px] text-slate-400 block font-medium">
                {getEmployeeProfile(activeShift.empleada)?.rol === 'recepcionista' ? 'Recepcionista' : (userProfile?.rol === 'admin' ? 'Administradora' : 'Recepcionista')}
                {getEmployeeProfile(activeShift.empleada) && ` • Nacimiento: ${getEmployeeProfile(activeShift.empleada)?.fechaNacimientoTexto}`}
              </span>
            </div>
          </div>
        </div>

        {/* Quick action buttons & locks */}
        <div className="flex items-center gap-3">
          {onlineStatus === 'offline' && (
            <span className="text-[9px] bg-red-500/15 text-red-400 border border-red-500/20 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wide flex items-center gap-1">
              <CloudLightning className="h-3 w-3" />
              <span>Modo Offline</span>
            </span>
          )}


          <div className="relative">
            <button
              type="button"
              onClick={() => setShowNotifications((prev) => !prev)}
              className="relative p-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 hover:text-amber-300 hover:border-amber-500/40 transition-colors"
              title="Notificaciones del sistema"
            >
              <Bell className="h-4.5 w-4.5" />
              {systemAlerts.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[9px] font-black flex items-center justify-center border border-slate-950">
                  {systemAlerts.length > 9 ? '9+' : systemAlerts.length}
                </span>
              )}
            </button>

            {showNotifications && (
              <div className="absolute right-0 top-12 z-50 w-80 max-w-[calc(100vw-2rem)] bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-amber-400" />
                    <span className="text-xs font-black uppercase tracking-widest text-white">Notificaciones</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-bold">{systemAlerts.length} activa(s)</span>
                </div>

                <div className="max-h-96 overflow-y-auto p-2 space-y-2">
                  {systemAlerts.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-slate-400 text-center">
                      Sin novedades importantes por ahora.
                    </div>
                  ) : (
                    systemAlerts.slice(0, 8).map((alert: any) => (
                      <button
                        key={alert.id}
                        type="button"
                        onClick={() => {
                          setShowNotifications(false);
                          if (alert.actionTab) handleTabChange(alert.actionTab as TabType);
                        }}
                        className={`w-full text-left rounded-xl border p-3 text-xs ${getAlertClasses(alert.severity)}`}
                      >
                        <div className="font-black uppercase tracking-wide">{alert.title}</div>
                        <div className="text-[11px] opacity-90 mt-1 leading-snug">{alert.message}</div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wide flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Turno Abierto</span>
          </span>
          
          <button
            onClick={handleForceLockShift}
            className="p-2 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-amber-400 transition-colors cursor-pointer"
            title="Bloquear pantalla temporalmente"
          >
            <Power className="h-4.5 w-4.5" />
          </button>

          <button
            onClick={handleFirebaseLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 rounded-xl text-red-400 hover:text-red-300 text-xs font-bold transition-all cursor-pointer shadow-sm"
            title="Cerrar sesión de la cuenta"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Cerrar Sesión</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-4 sm:p-6 max-w-7xl mx-auto w-full">
        {/* Banner Sincronización */}
        {isFirebaseConfigured ? (
          <div className="mb-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl px-4 py-2.5 flex items-center justify-between text-xs animate-fade-in">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-extrabold text-emerald-400">Firebase conectado. Sincronización en tiempo real activa.</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">Último cambio: {lastSyncTime || 'Sincronizado'}</span>
          </div>
        ) : (
          <div className="mb-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl px-4 py-2.5 flex items-center justify-between text-xs animate-fade-in">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              <span className="font-extrabold text-amber-400">Modo local activo. Los datos no se sincronizan con el celular del propietario.</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">Persistencia Local</span>
          </div>
        )}

        <ErrorBoundary fallbackMessage={`Error en la vista: ${activeTab.toUpperCase()}. Por favor, reinicie el módulo.`}>
          
          {activeTab === 'inicio' && (
            <InicioView
              activeShift={activeShift}
              rooms={rooms}
              clients={clients}
              products={products}
              reservations={reservations}
              onTriggerLogOut={handleForceLockShift}
              onLogout={handleFirebaseLogout}
            />
          )}

          {activeTab === 'habitaciones' && (
            <HabitacionesView
              activeShift={activeShift}
              rooms={rooms}
              clients={clients}
              onUpdateRooms={handleUpdateRooms}
              onUpdateClients={handleUpdateClients}
              onAddSale={handleAddSale}
              userProfile={userProfile}
              hotelSettings={hotelSettings}
            />
          )}

          {activeTab === 'productos' && (
            <ProductosView
              activeShift={activeShift}
              products={products}
              sales={sales}
              onUpdateProducts={handleUpdateProducts}
              onAddSale={handleAddSale}
              userProfile={userProfile}
              hotelSettings={hotelSettings}
            />
          )}

          {activeTab === 'caja' && (
            <CajaView
              activeShift={activeShift}
              sales={sales}
              expenses={expenses}
              onAddExpense={handleAddExpense}
              userProfile={userProfile}
            />
          )}

          {activeTab === 'dashboard' && (
            <ErrorBoundary fallbackMessage="Error cargando Dashboard. El resto del sistema sigue disponible.">
              <DashboardView
                sales={sales}
                expenses={expenses}
                closures={closures}
                onRestoreState={handleRestoreState => {
                  // Allows local overrides if needed, but Firestore is the primary source
                  window.alert('Restauración local deshabilitada. Los datos se gestionan de forma centralizada en Firestore.');
                }}
                userProfile={userProfile}
                onlineStatus={onlineStatus}
                lastSyncTime={lastSyncTime}
                roomsCount={rooms.length}
                productsCount={products.filter(isProductVisible).length}
                hotelSettings={hotelSettings}
                onUpdateSettings={saveSettingsToFirestore}
              />
            </ErrorBoundary>
          )}

          {activeTab === 'clientes' && (
            <ClientesView
              clients={clients}
              onUpdateClients={handleUpdateClients}
            />
          )}

          {activeTab === 'reservas' && (
            <ReservasView
              reservations={reservations}
              rooms={rooms}
              clients={clients}
              onUpdateClients={handleUpdateClients}
              onUpdateReservations={handleUpdateReservations}
            />
          )}

          {activeTab === 'cierre' && (
            <CierreTurnoView
              activeShift={activeShift!}
              sales={sales}
              expenses={expenses}
              products={products}
              onConfirmClosure={handleConfirmClosure}
              closureInProgress={closureInProgress}
              userProfile={userProfile}
            />
          )}

        </ErrorBoundary>
      </main>

      {/* Bottom Fixed Navigation Menu */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900 border-t border-slate-900 shadow-2xl pb-safe">
        <div className="max-w-4xl mx-auto grid grid-cols-8 gap-0.5 px-1 py-1 sm:py-1.5">
          
          <button
            onClick={() => handleTabChange('inicio')}
            className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition-all ${
              activeTab === 'inicio' ? 'bg-slate-950 text-emerald-400 font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Home className="h-4 w-4" />
            <span className="text-[8px] sm:text-[9px] mt-1 truncate">Inicio</span>
          </button>

          <button
            onClick={() => handleTabChange('habitaciones')}
            className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition-all ${
              activeTab === 'habitaciones' ? 'bg-slate-950 text-emerald-400 font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Bed className="h-4 w-4" />
            <span className="text-[8px] sm:text-[9px] mt-1 truncate">Habitac.</span>
          </button>

          <button
            onClick={() => handleTabChange('productos')}
            className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition-all ${
              activeTab === 'productos' ? 'bg-slate-950 text-emerald-400 font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Package className="h-4 w-4" />
            <span className="text-[8px] sm:text-[9px] mt-1 truncate">Prod.</span>
          </button>

          <button
            onClick={() => handleTabChange('caja')}
            className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition-all ${
              activeTab === 'caja' ? 'bg-slate-950 text-emerald-400 font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Coins className="h-4 w-4" />
            <span className="text-[8px] sm:text-[9px] mt-1 truncate">Caja</span>
          </button>

          <button
            onClick={() => handleTabChange('dashboard')}
            className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition-all ${
              activeTab === 'dashboard' ? 'bg-slate-950 text-emerald-400 font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            <LayoutDashboard className="h-4 w-4" />
            <span className="text-[8px] sm:text-[9px] mt-1 truncate">Dashb.</span>
          </button>

          <button
            onClick={() => handleTabChange('clientes')}
            className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition-all ${
              activeTab === 'clientes' ? 'bg-slate-950 text-emerald-400 font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Users className="h-4 w-4" />
            <span className="text-[8px] sm:text-[9px] mt-1 truncate">Client.</span>
          </button>

          <button
            onClick={() => handleTabChange('reservas')}
            className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition-all ${
              activeTab === 'reservas' ? 'bg-slate-950 text-emerald-400 font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Calendar className="h-4 w-4" />
            <span className="text-[8px] sm:text-[9px] mt-1 truncate">Reserv.</span>
          </button>

          <button
            onClick={() => handleTabChange('cierre')}
            className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition-all ${
              activeTab === 'cierre' ? 'bg-slate-950 text-red-400 font-bold' : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            <ShieldCheck className="h-4 w-4" />
            <span className="text-[8px] sm:text-[9px] mt-1 truncate">Cierre</span>
          </button>

        </div>
      </nav>

      {/* LocalStorage Data Cloud Migration Modal */}
      {migrationOpen && (
        <div className="fixed inset-0 z-55 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg overflow-hidden p-6 shadow-2xl flex flex-col space-y-4">
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                <UploadCloud className="h-5 w-5 text-indigo-400 animate-pulse" />
                <span>Migración de Datos Locales a Firestore</span>
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Esto transferirá todo su historial local de ventas, clientes, reservas, habitaciones y gastos a la base de datos en la nube.
              </p>
            </div>

            {/* Logs Visualizer */}
            <div className="flex-1 min-h-[180px] bg-slate-950 rounded-xl p-4.5 border border-slate-850 font-mono text-[11px] text-indigo-200 overflow-y-auto space-y-1 select-all">
              {migrationLogs.map((log, idx) => (
                <div key={idx} className={log.startsWith('¡') || log.startsWith('Error') ? 'font-bold text-white' : ''}>
                  {log}
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3.5 pt-1.5">
              <button
                type="button"
                disabled={migrating}
                onClick={() => setMigrationOpen(false)}
                className="py-2 px-4.5 border border-slate-800 hover:bg-slate-800 rounded-xl text-slate-300 text-xs font-bold transition-colors disabled:opacity-50"
              >
                Cerrar Ventana
              </button>
              <button
                type="button"
                disabled={migrating}
                onClick={handleExecuteMigration}
                className="py-2 px-5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
              >
                {migrating ? 'Migrando...' : 'Iniciar Migración Segura'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Administrative Password Modal */}
      <AdminPasswordModal
        open={adminModalOpen}
        title="Validación administrativa"
        message="Ingrese la contraseña administrativa para continuar."
        onConfirm={confirmAdminPassword}
        onCancel={() => {
          setAdminModalOpen(false);
          setPendingAdminAction(null);
        }}
      />

      {/* Beautiful Custom Double Confirmation Modals for Cierre */}
      {showFirstClosureConfirm && (
        <div className="fixed inset-0 z-55 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md overflow-hidden p-6 shadow-2xl flex flex-col space-y-4">
            <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
              <div className="bg-yellow-500/10 p-2 rounded-xl text-yellow-500">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <h3 className="text-sm font-black text-white uppercase tracking-wider">
                Confirmación de Cierre
              </h3>
            </div>
            
            <p className="text-slate-300 text-xs leading-relaxed">
              ¿Está seguro de iniciar el cierre de turno?
            </p>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowFirstClosureConfirm(false)}
                className="py-2.5 px-4.5 border border-slate-800 hover:bg-slate-800 rounded-xl text-slate-300 text-xs font-bold transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowFirstClosureConfirm(false);
                  setShowSecondClosureConfirm(true);
                }}
                className="py-2.5 px-5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold transition-all"
              >
                Sí, continuar
              </button>
            </div>
          </div>
        </div>
      )}

      {showSecondClosureConfirm && (
        <div className="fixed inset-0 z-55 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md overflow-hidden p-6 shadow-2xl flex flex-col space-y-4">
            <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
              <div className="bg-red-500/10 p-2 rounded-xl text-red-500">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <h3 className="text-sm font-black text-white uppercase tracking-wider">
                Advertencia de Bloqueo
              </h3>
            </div>
            
            <p className="text-slate-300 text-xs leading-relaxed">
              Una vez iniciado el cierre de turno, no podrá salir hasta completarlo. ¿Desea continuar?
            </p>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowSecondClosureConfirm(false)}
                className="py-2.5 px-4.5 border border-slate-800 hover:bg-slate-800 rounded-xl text-slate-300 text-xs font-bold transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSecondClosureConfirm(false);
                  setClosureInProgress(true);
                  safeSetLocalStorage('hotel_closure_in_progress', true);
                  setActiveTab('cierre');
                  console.log("Abriendo módulo cierre");
                }}
                className="py-2.5 px-5 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white rounded-xl text-xs font-bold transition-all"
              >
                Sí, iniciar cierre
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tarjeta de Diagnóstico de Errores para Administrador */}
      {diagnosticErrors.length > 0 && (userProfile?.rol === 'admin' || !isFirebaseConfigured) && (
        <div className="fixed bottom-20 left-4 z-[9999] max-w-sm w-[calc(100vw-32px)] bg-slate-900 border-2 border-red-500/50 rounded-2xl p-4 shadow-2xl animate-in slide-in-from-bottom duration-300 text-left">
          <div className="flex items-center justify-between border-b border-slate-850 pb-2 mb-3">
            <div className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="h-4 w-4 animate-pulse" />
              <span className="font-bold text-[11px] uppercase tracking-wider">Tarjeta de Diagnóstico ({diagnosticErrors.length})</span>
            </div>
            <button
              onClick={() => setDiagnosticErrors([])}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-lg text-[9px] font-bold transition-all"
            >
              Limpiar logs
            </button>
          </div>
          <div className="max-h-40 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
            {diagnosticErrors.map((err, idx) => (
              <div key={idx} className="bg-slate-950 p-2 rounded-xl border border-slate-850/60 text-[10px] space-y-1 font-mono">
                <div className="flex justify-between text-slate-500 text-[8px]">
                  <span>{err.timestamp}</span>
                  <span className="text-amber-500 font-bold truncate max-w-[150px]">{err.file} ({err.action})</span>
                </div>
                <p className="text-red-300 break-words leading-relaxed select-all">{err.message}</p>
              </div>
            ))}
          </div>
          <p className="text-[8px] text-slate-500 mt-2 text-center">
            Este panel solo es visible para Administradores y ayuda a diagnosticar errores.
          </p>
        </div>
      )}

      {/* Global Modals for Logout and Shift Lock */}
      {renderGlobalModals()}
    </div>
  );
}