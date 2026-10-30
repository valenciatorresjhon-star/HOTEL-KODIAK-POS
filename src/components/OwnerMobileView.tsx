import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  TrendingUp, 
  Coins, 
  CreditCard, 
  Bed, 
  Package, 
  ArrowUpRight, 
  AlertCircle, 
  Calendar, 
  LogOut, 
  RefreshCw, 
  Activity, 
  Clock, 
  Users, 
  User,
  CheckCircle,
  FileText,
  X,
  Eye,
  DollarSign,
  Search,
  ChevronRight,
  Filter,
  TrendingDown,
  Info,
  Printer,
  Share2,
  FileSpreadsheet
} from 'lucide-react';
import { Room, Client, Product, Sale, Expense, Shift, ShiftClosure, Reservation, FirebaseUser, isProductVisible } from '../types';
import { formatCop, formatSafeDate, getTodayColombia } from '../utils/storage';
import { isFirebaseConfigured, db, auth } from '../firebase';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import hotelLogo from '../assets/images/hotel_logo_1783287741164.jpg';
import { 
  getSettings, 
  openBrowserPrintWindow, 
  setBrowserPrintWindow, 
  printShiftClosureReceipt 
} from '../services/printerService';

// Helper function to robustly map names and emails to full names
export function getEmployeeFullName(nameOrEmail: any) {
  const value = String(nameOrEmail || "").toLowerCase();

  if (value.includes("alicia")) return "Luz Alicia Serna Gómez";
  if (value.includes("paola")) return "Jenny Paola Lozano Alfonso";
  if (value.includes("mileidys") || value.includes("mileydi")) return "María Mileydi Moreno";

  return nameOrEmail || "Sin dato";
}

// Helper to robustly get the Date object of a closure
export function getClosureDate(closure: any): Date | null {
  const value = closure.closedAt || closure.createdAt || closure.fecha;

  if (!value) return null;

  if (typeof value.toDate === 'function') return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  if (typeof value === "string") return new Date(value);
  if (value instanceof Date) return value;

  return null;
}

export function formatClosureDateOnly(date: Date | null): string {
  if (!date) return 'Sin fecha';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export function formatClosureTimeOnly(date: Date | null): string {
  if (!date) return 'Sin hora';
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'p. m.' : 'a. m.';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${hours}:${minutes} ${ampm}`;
}

export function getClosureStatusBadge(diff: number) {
  if (diff === 0) {
    return (
      <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
        Exacto
      </span>
    );
  } else if (diff < 0) {
    return (
      <span className="text-[10px] bg-rose-500/10 border border-rose-500/20 text-rose-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
        Faltante
      </span>
    );
  } else {
    return (
      <span className="text-[10px] bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
        Sobrante
      </span>
    );
  }
}

// Helper function to robustly parse Colombia-formatted date and time
export function parseColombiaDateTime(fechaStr?: string, horaStr?: string): Date | null {
  if (!fechaStr || !horaStr) return null;
  try {
    const parts = fechaStr.split('/');
    if (parts.length !== 3) return null;
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // 0-based
    const year = parseInt(parts[2], 10);

    const timeMatch = horaStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
    if (!timeMatch) return null;
    let hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    const ampm = timeMatch[3];

    if (ampm) {
      if (ampm.toUpperCase() === 'PM' && hours < 12) hours += 12;
      if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;
    }

    const d = new Date(year, month, day, hours, minutes, 0);
    return isNaN(d.getTime()) ? null : d;
  } catch (e) {
    return null;
  }
}

// Helper utility to safely check if a date is today
export function isToday(createdAtValue?: any, fechaValue?: string): boolean {
  const todayColombia = getTodayColombia(); // Format: "YYYY-MM-DD"
  
  if (createdAtValue) {
    let date: Date | null = null;
    if (typeof createdAtValue.toDate === 'function') {
      date = createdAtValue.toDate();
    } else if (createdAtValue instanceof Date) {
      date = createdAtValue;
    } else if (typeof createdAtValue === 'object' && typeof createdAtValue.seconds === 'number') {
      date = new Date(createdAtValue.seconds * 1000);
    } else if (typeof createdAtValue === 'string') {
      date = new Date(createdAtValue);
    }

    if (date && !isNaN(date.getTime())) {
      const dateStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Bogota",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(date);
      
      if (dateStr === todayColombia) {
        return true;
      }
    }
  }

  if (fechaValue) {
    const cleanedFecha = fechaValue.trim();
    if (cleanedFecha === todayColombia) {
      return true;
    }

    if (cleanedFecha.includes('/')) {
      const parts = cleanedFecha.split('/');
      if (parts.length === 3) {
        let d = parts[0].padStart(2, '0');
        let m = parts[1].padStart(2, '0');
        let y = parts[2];
        if (y.length === 2) y = '20' + y;
        const reformatted = `${y}-${m}-${d}`;
        if (reformatted === todayColombia) {
          return true;
        }
      }
    }
    
    const localDate = new Date().toLocaleDateString('es-CO');
    if (cleanedFecha === localDate) {
      return true;
    }
  }

  return false;
}

// Helper utility to extract numeric milliseconds for safe date sorting
export function getTimestampMs(createdAtValue?: any, fallbackDateStr?: string): number {
  if (createdAtValue) {
    if (typeof createdAtValue.toDate === 'function') {
      return createdAtValue.toDate().getTime();
    }
    if (createdAtValue instanceof Date) {
      return createdAtValue.getTime();
    }
    if (typeof createdAtValue === 'object' && typeof createdAtValue.seconds === 'number') {
      return createdAtValue.seconds * 1000;
    }
    if (typeof createdAtValue === 'string') {
      const parsed = new Date(createdAtValue).getTime();
      if (!isNaN(parsed)) return parsed;
    }
  }
  if (fallbackDateStr) {
    const parsed = new Date(fallbackDateStr).getTime();
    if (!isNaN(parsed)) return parsed;
  }
  return 0;
}

function normalizeOwnerPaymentMethod(method: any): string {
  return String(method || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isOwnerCashPayment(method: any): boolean {
  const value = normalizeOwnerPaymentMethod(method);
  return value === 'efectivo' || value.includes('efectivo') || value === 'cash';
}

function isOwnerTransferPayment(method: any): boolean {
  const value = normalizeOwnerPaymentMethod(method);
  return value.includes('transferencia') || value.includes('transf') || value.includes('banco') || value.includes('nequi') || value.includes('daviplata');
}

function getMoneyValue(value: any): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function belongsToShift(item: any, shiftId?: string): boolean {
  if (!shiftId) return false;
  return item?.shiftId === shiftId || item?.turnoId === shiftId || item?.turno === shiftId;
}

function getComparableMsForInventory(value: any): number {
  if (!value) return 0;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value === 'number') return value;
  if (typeof value?.toDate === 'function') {
    try { return value.toDate().getTime(); } catch { return 0; }
  }
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  return 0;
}

function getProductStockNumber(product: any): number {
  const value = product?.stockActual ?? product?.stock ?? 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getProductMinStockNumber(product: any): number {
  const value = product?.minStock ?? product?.stockMinimo ?? 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}


// =========================================================
// CIERRES: DESGLOSE OPERATIVO LIVIANO PARA CELULAR VISOR
// =========================================================
function normalizeClosureText(value: any): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getClosureSaleAmount(item: any): number {
  return getMoneyValue(item?.total ?? item?.valor ?? item?.amount ?? item?.monto ?? 0);
}

function getClosureSaleType(item: any): 'habitacion' | 'producto' | 'reserva' | 'liberacion' | 'otro' {
  const haystack = normalizeClosureText([
    item?.tipoVenta,
    item?.type,
    item?.category,
    item?.concepto,
    item?.concept,
    item?.productoNombre,
    item?.productName,
    item?.habitacionNombre,
    item?.roomName,
  ].filter(Boolean).join(' '));

  if (haystack.includes('liberacion')) return 'liberacion';
  if (haystack.includes('reserva') || item?.reservaId) return 'reserva';
  if (haystack.includes('producto') || item?.productoId || item?.productId || item?.productoNombre || item?.productName) return 'producto';
  if (haystack.includes('habitacion') || haystack.includes('hospedaje') || haystack.includes('alojamiento') || item?.habitacionId || item?.habitacionNombre || item?.roomId || item?.roomName) return 'habitacion';
  return 'otro';
}

function isRoomStayMovement(item: any): boolean {
  const type = getClosureSaleType(item);
  if (type !== 'habitacion') return false;

  const text = normalizeClosureText(`${item?.concepto || item?.concept || ''} ${item?.tipoVenta || ''} ${item?.type || ''}`);
  // Horas extra y liberaciones se muestran aparte; no son una nueva ocupación de habitación.
  if (text.includes('hora extra') || text.includes('horas extra') || text.includes('adicional') || text.includes('liberacion')) {
    return false;
  }
  return true;
}

function normalizeClosureSaleDetail(item: any) {
  const tipo = getClosureSaleType(item);
  const roomName = item?.habitacionNombre || item?.roomName || item?.room || item?.habitacion || '';
  const productName = item?.productoNombre || item?.productName || item?.producto || '';
  const concept = item?.concepto || item?.concept || (tipo === 'producto' ? productName : roomName) || 'Movimiento';

  return {
    id: item?.id || `${tipo}-${item?.hora || ''}-${concept}`,
    hora: item?.hora || item?.time || '',
    fecha: item?.fecha || item?.date || '',
    tipo,
    concepto: concept,
    metodoPago: item?.metodoPago || item?.paymentMethod || item?.metodo || 'N/A',
    total: getClosureSaleAmount(item),
    clienteNombre: item?.clienteNombre || item?.clientName || item?.cliente || '',
    clienteCedula: item?.clienteCedula || item?.clientId || item?.clientDocument || '',
    habitacionNombre: roomName,
    productoNombre: productName,
    cantidad: Number(item?.cantidad ?? item?.quantity ?? item?.cantidadVendida ?? 0) || 0,
    numeroPersonas: Number(item?.numeroPersonas ?? 0) || 0,
    acompanantes: Array.isArray(item?.acompanantes) ? item.acompanantes : []
  };
}

function normalizeClosureExpenseDetail(item: any) {
  return {
    id: item?.id || `gasto-${item?.hora || ''}-${item?.concepto || item?.concept || ''}`,
    hora: item?.hora || item?.time || '',
    concepto: item?.concepto || item?.concept || 'Gasto registrado',
    categoria: item?.categoria || item?.category || 'Gasto',
    metodoPago: item?.metodoPago || item?.paymentMethod || 'N/A',
    valor: getMoneyValue(item?.valor ?? item?.total ?? item?.amount ?? 0),
    empleada: item?.empleada || item?.employeeName || ''
  };
}

function buildClosureOperationalBreakdown(closure: any, allSales: Sale[], allExpenses: Expense[]) {
  if (!closure) {
    return {
      ventas: [], gastos: [], habitaciones: [], productos: [], reservas: [], otros: [], horasExtrasOLiberaciones: [],
      habitacionesUnicas: [], totalHabitaciones: 0, totalProductos: 0, totalReservas: 0, totalOtros: 0, totalGastos: 0,
      habitacionesUsadas: 0, habitacionesDistintas: 0, productosCantidad: 0, source: 'none'
    };
  }

  const closureShiftId = closure?.shiftId || closure?.turnoId || closure?.turno || '';
  const storedSales = Array.isArray(closure?.detalleVentas) ? closure.detalleVentas : [];
  const storedExpenses = Array.isArray(closure?.detalleGastos) ? closure.detalleGastos : [];

  const sourceSales = storedSales.length > 0
    ? storedSales
    : (Array.isArray(allSales) ? allSales.filter((sale: any) => belongsToShift(sale, closureShiftId)) : []);

  const sourceExpenses = storedExpenses.length > 0
    ? storedExpenses
    : (Array.isArray(allExpenses) ? allExpenses.filter((expense: any) => belongsToShift(expense, closureShiftId)) : []);

  const ventas = sourceSales
    .filter((item: any) => item?.type !== 'stock_add' && item?.tipoMovimiento !== 'abastecimiento_inventario')
    .map(normalizeClosureSaleDetail);

  const gastos = sourceExpenses.map(normalizeClosureExpenseDetail);
  const habitaciones = ventas.filter(isRoomStayMovement);
  const productos = ventas.filter((item) => item.tipo === 'producto');
  const reservas = ventas.filter((item) => item.tipo === 'reserva');
  const horasExtrasOLiberaciones = ventas.filter((item) => {
    const text = normalizeClosureText(`${item.concepto} ${item.tipo}`);
    return item.tipo === 'liberacion' || text.includes('hora extra') || text.includes('horas extra') || text.includes('adicional');
  });
  const otros = ventas.filter((item) => !habitaciones.includes(item) && !productos.includes(item) && !reservas.includes(item) && !horasExtrasOLiberaciones.includes(item));

  const uniqueRoomsMap = new Map<string, any>();
  habitaciones.forEach((item) => {
    const key = String(item.habitacionNombre || item.concepto || 'Sin habitación').trim();
    if (!uniqueRoomsMap.has(key)) uniqueRoomsMap.set(key, item);
  });

  return {
    ventas,
    gastos,
    habitaciones,
    productos,
    reservas,
    otros,
    horasExtrasOLiberaciones,
    habitacionesUnicas: Array.from(uniqueRoomsMap.values()),
    totalHabitaciones: habitaciones.reduce((sum, item) => sum + item.total, 0),
    totalProductos: productos.reduce((sum, item) => sum + item.total, 0),
    totalReservas: reservas.reduce((sum, item) => sum + item.total, 0),
    totalOtros: [...otros, ...horasExtrasOLiberaciones].reduce((sum, item) => sum + item.total, 0),
    totalGastos: gastos.reduce((sum, item) => sum + item.valor, 0),
    habitacionesUsadas: habitaciones.length,
    habitacionesDistintas: uniqueRoomsMap.size,
    productosCantidad: productos.reduce((sum, item) => sum + (Number(item.cantidad) || 1), 0),
    source: storedSales.length > 0 ? 'cierre' : 'movimientos'
  };
}


function getOwnerAlertClasses(severity: string): string {
  if (severity === 'danger') return 'border-red-500/30 bg-red-500/10 text-red-100';
  if (severity === 'warning') return 'border-amber-500/30 bg-amber-500/10 text-amber-100';
  if (severity === 'success') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100';
  return 'border-indigo-500/30 bg-indigo-500/10 text-indigo-100';
}


interface OwnerMobileViewProps {
  rooms: Room[];
  clients: Client[];
  products: Product[];
  sales: Sale[];
  expenses: Expense[];
  shifts: Shift[];
  closures: ShiftClosure[];
  reservations: Reservation[];
  userProfile: FirebaseUser;
  onLogout: () => void;
  onlineStatus: 'online' | 'offline' | 'syncing';
  hotelSettings?: any;
  systemAlerts?: any[];
  dailyReport?: any;
}

export function OwnerMobileView({
  rooms,
  clients,
  products,
  sales,
  expenses,
  shifts,
  closures,
  reservations,
  userProfile,
  onLogout,
  onlineStatus,
  hotelSettings,
  systemAlerts = [],
  dailyReport
}: OwnerMobileViewProps) {
  const [activeTab, setActiveTab] = useState<'resumen' | 'habitaciones' | 'ventas' | 'inventario' | 'reservas' | 'cierres'>('resumen');
  const [showDebug, setShowDebug] = useState<boolean>(true);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [latestNotification, setLatestNotification] = useState<string | null>(null);

  const prevStocksRef = useRef<Record<string, number>>({});
  const isFirstLoadRef = useRef<boolean>(true);

  // --- STATE FOR RESERVAS TAB ---
  const [searchReserva, setSearchReserva] = useState<string>('');
  const [filterReserva, setFilterReserva] = useState<'Hoy' | 'Mañana' | 'Esta semana' | 'Este mes' | 'Todas' | 'Pendientes' | 'Confirmadas' | 'Pagadas' | 'Canceladas'>('Todas');
  const [selectedReserva, setSelectedReserva] = useState<Reservation | null>(null);

  // --- STATE FOR CIERRES TAB ---
  const [closureFilter, setClosureFilter] = useState<'hoy' | 'esta_semana' | 'este_mes' | 'todo' | 'rango_personalizado'>('todo');
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [searchClosureQuery, setSearchClosureQuery] = useState<string>('');
  const [shiftClosures, setShiftClosures] = useState<ShiftClosure[]>([]);
  const [closuresLoading, setClosuresLoading] = useState<boolean>(false);
  const [selectedClosure, setSelectedClosure] = useState<ShiftClosure | null>(null);

  // Inventario visible para celular:
  // 1) Usa los productos recibidos por Firebase.
  // 2) Si el documento del producto llega atrasado en el celular, toma el último stockNuevo
  //    guardado en los movimientos de inventario/ventas, para que el visor no se quede pegado.
  const liveInventoryProducts = useMemo(() => {
    const latestStockByProduct = new Map<string, { stock: number; ms: number }>();

    (Array.isArray(sales) ? sales : []).forEach((movement: any) => {
      const productId = String(
        movement?.productId ||
        movement?.productoId ||
        movement?.productoID ||
        ''
      );
      if (!productId) return;

      const stockNuevoRaw = movement?.stockNuevo ?? movement?.newStock ?? movement?.stockActualDespues;
      const stockNuevo = Number(stockNuevoRaw);
      if (!Number.isFinite(stockNuevo)) return;

      const isInventoryMovement =
        movement?.type === 'stock_add' ||
        movement?.tipoMovimiento === 'abastecimiento_inventario' ||
        movement?.tipoMovimiento === 'entrada_inventario' ||
        movement?.inventoryMovementType === 'entrada' ||
        movement?.motivoInventario ||
        movement?.stockAnterior !== undefined;

      if (!isInventoryMovement) return;

      const ms = Math.max(
        getComparableMsForInventory(movement?.updatedAt),
        getComparableMsForInventory(movement?.createdAt),
        getComparableMsForInventory(movement?.fecha)
      );

      const current = latestStockByProduct.get(productId);
      if (!current || ms >= current.ms) {
        latestStockByProduct.set(productId, { stock: stockNuevo, ms });
      }
    });

    return (Array.isArray(products) ? products : [])
      .filter(isProductVisible)
      .map((product: any) => {
      const productId = String(product?.id || product?.firestoreId || '');
      const latest = productId ? latestStockByProduct.get(productId) : undefined;

      if (!latest) {
        return {
          ...product,
          stock: getProductStockNumber(product),
          stockMinimo: getProductMinStockNumber(product)
        };
      }

      const productMs = Math.max(
        getComparableMsForInventory(product?.updatedAt),
        getComparableMsForInventory(product?.clientUpdatedAt),
        getComparableMsForInventory(product?.lastMovementAt),
        getComparableMsForInventory(product?.createdAt)
      );

      if (latest.ms >= productMs || getProductStockNumber(product) !== latest.stock) {
        return {
          ...product,
          stock: latest.stock,
          stockActual: latest.stock,
          stockMinimo: getProductMinStockNumber(product),
          estado: latest.stock <= 0
            ? 'Agotado'
            : latest.stock <= getProductMinStockNumber(product)
              ? 'Bajo stock'
              : 'Disponible'
        };
      }

      return {
        ...product,
        stock: getProductStockNumber(product),
        stockMinimo: getProductMinStockNumber(product)
      };
    });
  }, [products, sales]);

  // Helper to determine if a closure is within the active date filter
  const isClosureInFilterRange = (closure: any, filter: string) => {
    const closureDate = getClosureDate(closure);
    if (!closureDate) return false;

    const now = new Date();
    
    const getStartOfDay = (d: Date) => {
      const r = new Date(d);
      r.setHours(0, 0, 0, 0);
      return r;
    };
    const getEndOfDay = (d: Date) => {
      const r = new Date(d);
      r.setHours(23, 59, 59, 999);
      return r;
    };

    switch (filter) {
      case 'hoy': {
        const start = getStartOfDay(now);
        const end = getEndOfDay(now);
        return closureDate >= start && closureDate <= end;
      }
      case 'esta_semana': {
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(now);
        monday.setDate(diff);
        const start = getStartOfDay(monday);
        const end = getEndOfDay(now);
        return closureDate >= start && closureDate <= end;
      }
      case 'este_mes': {
        const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        const end = getEndOfDay(now);
        return closureDate >= start && closureDate <= end;
      }
      case 'todo':
        return true;
      case 'rango_personalizado': {
        let start = new Date(0); // far past
        let end = new Date(3000, 0, 1); // far future
        if (customStartDate) {
          const parts = customStartDate.split('-');
          start = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 0, 0, 0, 0);
        }
        if (customEndDate) {
          const parts = customEndDate.split('-');
          end = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 23, 59, 59, 999);
        }
        return closureDate >= start && closureDate <= end;
      }
      default:
        return true;
    }
  };

  // Fetch closures from Firestore
  useEffect(() => {
    if (activeTab !== 'cierres') return;
    if (!isFirebaseConfigured || !db) {
      setShiftClosures(closures || []);
      return;
    }

    let isMounted = true;
    setClosuresLoading(true);

    const loadData = async () => {
      const colRef = collection(db, 'hotel_shift_closures');
      try {
        const snap = await getDocs(colRef);
        if (!isMounted) return;

        const items: ShiftClosure[] = [];
        snap.forEach((docSnap) => {
          items.push({ id: docSnap.id, ...(docSnap.data() as any) });
        });

        // Sort desc by getClosureDate
        items.sort((a, b) => {
          const dateA = getClosureDate(a);
          const dateB = getClosureDate(b);
          if (!dateA && !dateB) return 0;
          if (!dateA) return 1;
          if (!dateB) return -1;
          return dateB.getTime() - dateA.getTime();
        });

        setShiftClosures(items);
      } catch (err) {
        console.error("Error fetching hotel_shift_closures:", err);
        if (isMounted) {
          setShiftClosures(closures || []);
        }
      } finally {
        if (isMounted) setClosuresLoading(false);
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, [activeTab, closures]);

  // --- FILTERED RESERVATIONS (IN-MEMORY FOR REAL-TIME SYNC) ---
  const filteredReservations = useMemo(() => {
    const safeReservations = Array.isArray(reservations) ? reservations : [];
    return safeReservations.filter((res) => {
      // 1. Text Search Filter
      if (searchReserva.trim() !== '') {
        const q = searchReserva.toLowerCase();
        const matchName = res.clientName?.toLowerCase().includes(q);
        const matchCedula = res.clientId?.toLowerCase().includes(q) || res.clientDocument?.toLowerCase().includes(q);
        const matchCel = res.clientPhone?.toLowerCase().includes(q);
        const matchRoom = res.roomName?.toLowerCase().includes(q);
        const matchState = res.status?.toLowerCase().includes(q);

        if (!matchName && !matchCedula && !matchCel && !matchRoom && !matchState) {
          return false;
        }
      }

      // 2. Date/Tab Filter
      const now = new Date();
      const getStartOfDay = (d: Date) => {
        const r = new Date(d);
        r.setHours(0, 0, 0, 0);
        return r;
      };
      
      const checkInDateObj = new Date(res.checkInDate + 'T00:00:00');

      switch (filterReserva) {
        case 'Hoy': {
          const todayStr = now.toLocaleDateString('en-CA'); // YYYY-MM-DD
          return res.checkInDate === todayStr;
        }
        case 'Mañana': {
          const tomorrow = new Date(now);
          tomorrow.setDate(tomorrow.getDate() + 1);
          const tomorrowStr = tomorrow.toLocaleDateString('en-CA');
          return res.checkInDate === tomorrowStr;
        }
        case 'Esta semana': {
          const startOfWeek = getStartOfDay(now);
          const day = startOfWeek.getDay();
          const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
          startOfWeek.setDate(diff);
          const endOfWeek = new Date(startOfWeek);
          endOfWeek.setDate(endOfWeek.getDate() + 6);
          endOfWeek.setHours(23, 59, 59, 999);

          return checkInDateObj >= startOfWeek && checkInDateObj <= endOfWeek;
        }
        case 'Este mes': {
          const currentMonth = now.getMonth();
          const currentYear = now.getFullYear();
          return checkInDateObj.getMonth() === currentMonth && checkInDateObj.getFullYear() === currentYear;
        }
        case 'Pendientes':
          return res.status === 'Pendiente';
        case 'Confirmadas':
          return res.status === 'Confirmada';
        case 'Pagadas':
          return res.paymentStatus === 'Pagado';
        case 'Canceladas':
          return res.status === 'Cancelada';
        case 'Todas':
        default:
          return true;
      }
    });
  }, [reservations, searchReserva, filterReserva]);

  // --- FILTERED CIERRES ---
  const filteredClosures = useMemo(() => {
    const listToFilter = shiftClosures;

    return listToFilter.filter((closure) => {
      // 1. Text Search Filter (on Employee Name, Date, status, observations)
      if (searchClosureQuery.trim() !== '') {
        const q = searchClosureQuery.toLowerCase();
        
        const dateObj = getClosureDate(closure);
        const fechaOnly = dateObj ? formatClosureDateOnly(dateObj).toLowerCase() : '';
        const timeOnly = dateObj ? formatClosureTimeOnly(dateObj).toLowerCase() : '';
        
        const cerro = getEmployeeFullName(closure.empleadaEntrega || (closure as any).employeeName || (closure as any).createdByEmail).toLowerCase();
        const recibe = getEmployeeFullName(closure.empleadoRecibe || (closure as any).receiverEmployeeName).toLowerCase();
        const obs = (closure.observaciones || '').toLowerCase();
        const diff = String((closure as any).diferencia ?? closure.diferenciaCaja ?? (closure as any).cashDifference ?? '');
        
        const matchesText = 
          cerro.includes(q) || 
          recibe.includes(q) || 
          fechaOnly.includes(q) || 
          timeOnly.includes(q) || 
          obs.includes(q) || 
          diff.includes(q);

        if (!matchesText) return false;
      }

      // 2. Date Range Filter
      return isClosureInFilterRange(closure, closureFilter);
    });
  }, [shiftClosures, searchClosureQuery, closureFilter, customStartDate, customEndDate]);

  // --- CALCULATE CLOSURES KPI SUMMARY ---
  const closuresSummary = useMemo(() => {
    let totalIngresos = 0;
    let totalEfectivo = 0;
    let totalTransferencia = 0;
    let totalGastos = 0;
    let totalNomina = 0;
    let totalHabitacionesOcupadas = 0;
    let totalProductosVendidos = 0;
    let cantidadCierres = filteredClosures.length;
    let diferenciasCajaAcumuladas = 0;

    filteredClosures.forEach((c) => {
      const totalSales = c.totalVentas !== undefined ? c.totalVentas : ((c as any).totalSales || 0);
      const totalCash = c.ventasEfectivo !== undefined ? c.ventasEfectivo : ((c as any).totalCash || 0);
      const totalTransfer = c.ventasTransferencia !== undefined ? c.ventasTransferencia : ((c as any).totalTransfer || 0);
      const expenses = (c.gastosEfectivo !== undefined && c.gastosTransferencia !== undefined)
        ? (c.gastosEfectivo + c.gastosTransferencia)
        : ((c as any).totalExpenses || 0);
      const payroll = c.nomina !== undefined ? c.nomina : ((c as any).payrollAmount || 0);
      const diff = c.diferenciaCaja !== undefined ? c.diferenciaCaja : ((c as any).cashDifference || 0);

      let roomsCount = 0;
      if ((c as any).roomsOccupiedCount !== undefined) {
        roomsCount = Number((c as any).roomsOccupiedCount) || 0;
      } else if ((c as any).roomsList) {
        roomsCount = Array.isArray((c as any).roomsList) ? (c as any).roomsList.length : 0;
      }

      let prodsCount = 0;
      if ((c as any).productsSoldCount !== undefined) {
        prodsCount = Number((c as any).productsSoldCount) || 0;
      } else if ((c as any).productsList) {
        prodsCount = Array.isArray((c as any).productsList) ? (c as any).productsList.reduce((sum: number, p: any) => sum + (p.cantidad || 0), 0) : 0;
      }

      totalIngresos += totalSales;
      totalEfectivo += totalCash;
      totalTransferencia += totalTransfer;
      totalGastos += expenses;
      totalNomina += payroll;
      totalHabitacionesOcupadas += roomsCount;
      totalProductosVendidos += prodsCount;
      diferenciasCajaAcumuladas += diff;
    });

    const gananciaNetaEstimada = totalIngresos - totalGastos - totalNomina;

    return {
      totalIngresos,
      totalEfectivo,
      totalTransferencia,
      totalGastos,
      totalNomina,
      gananciaNetaEstimada,
      totalHabitacionesOcupadas,
      totalProductosVendidos,
      cantidadCierres,
      diferenciasCajaAcumuladas,
    };
  }, [filteredClosures]);

  const handleExportToExcel = () => {
    try {
      if (filteredClosures.length === 0) {
        alert("No hay cierres para exportar en el filtro actual.");
        return;
      }

      const rows = filteredClosures.map((closure) => {
        const dateObj = getClosureDate(closure);
        const fecha = dateObj ? formatClosureDateOnly(dateObj) : (closure.fechaCierre || (closure as any).fecha || "Sin fecha");
        const hora = dateObj ? formatClosureTimeOnly(dateObj) : (closure.horaCierre || (closure as any).hora || "Sin hora");
        
        const cerro = getEmployeeFullName(closure.empleadaEntrega || (closure as any).closedBy || (closure as any).employeeName || (closure as any).createdByEmail);
        const recibe = getEmployeeFullName(closure.empleadoRecibe || (closure as any).handedTo || (closure as any).receiverEmployeeName);
        
        const cashSales = Number(closure.ventasEfectivo ?? (closure as any).totalCash ?? 0);
        const transferSales = Number(closure.ventasTransferencia ?? (closure as any).totalTransfer ?? 0);
        const totalSales = Number(closure.totalVentas ?? (closure as any).totalSales ?? (cashSales + transferSales));
        
        const cashExpenses = Number(closure.gastosEfectivo ?? (closure as any).egresosEfectivo ?? 0);
        const transferExpenses = Number(closure.gastosTransferencia ?? (closure as any).egresosTransferencia ?? 0);
        const totalExpenses = Number(cashExpenses + transferExpenses || (closure as any).totalExpenses || 0);
        
        const payroll = Number(closure.nomina ?? (closure as any).payrollAmount ?? 0);
        
        const esperado = Number(closure.totalEsperadoEfectivo ?? (closure as any).expectedCash ?? 0);
        const contado = Number(closure.dineroFisicoContado ?? (closure as any).physicalCash ?? 0);
        const diff = Number(closure.diferenciaCaja ?? (closure as any).cashDifference ?? (contado - esperado));
        const estado = diff === 0 ? "Exacto" : diff < 0 ? "Faltante" : "Sobrante";

        return {
          "ID Cierre": closure.id || "",
          "Fecha": fecha,
          "Hora": hora,
          "Cerró": cerro,
          "Recibió": recibe,
          "Base Inicial": Number(closure.baseInicial || 0),
          "Ventas Efectivo": cashSales,
          "Ventas Transferencia": transferSales,
          "Ventas Totales": totalSales,
          "Egresos Efectivo": cashExpenses,
          "Egresos Transferencia": transferExpenses,
          "Egresos Totales": totalExpenses,
          "Nómina Descontada": payroll,
          "Efectivo Esperado": esperado,
          "Dinero Contado": contado,
          "Diferencia": diff,
          "Estado": estado,
          "Observaciones / Novedades": closure.observaciones || "Sin novedades"
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Cierres Filtrados");
      
      XLSX.writeFile(workbook, `Cierres_Filtrados_Kodiak_${getTodayColombia()}.xlsx`);
    } catch (err: any) {
      console.error("Error al exportar a Excel:", err);
      alert("Error al exportar a Excel: " + err.message);
    }
  };

  const handleShareReport = async () => {
    try {
      if (filteredClosures.length === 0) {
        alert("No hay cierres para compartir en el filtro actual.");
        return;
      }

      const text = `*REPORTE DE CIERRES - HOTEL KODIAK*\n` +
        `Filtro activo: ${closureFilter.toUpperCase()}\n` +
        `Cierres en reporte: ${closuresSummary.cantidadCierres}\n` +
        `----------------------------------------\n` +
        `*Resumen Financiero:*\n` +
        `- Total Ventas: ${formatCop(closuresSummary.totalIngresos)}\n` +
        `- Ventas Efectivo: ${formatCop(closuresSummary.totalEfectivo)}\n` +
        `- Ventas Transferencia: ${formatCop(closuresSummary.totalTransferencia)}\n` +
        `- Gastos Totales: ${formatCop(closuresSummary.totalGastos)}\n` +
        `- Nómina/Pagos: ${formatCop(closuresSummary.totalNomina)}\n` +
        `- Diferencia Acumulada: ${closuresSummary.diferenciasCajaAcumuladas >= 0 ? '+' : ''}${formatCop(closuresSummary.diferenciasCajaAcumuladas)}\n` +
        `- *Ganancia Neta Est.: ${formatCop(closuresSummary.gananciaNetaEstimada)}*\n` +
        `----------------------------------------\n` +
        `Generado por Kodiak Propietario el ${new Date().toLocaleDateString('es-CO')} a las ${new Date().toLocaleTimeString('es-CO')}.`;

      if (navigator.share) {
        await navigator.share({
          title: 'Reporte de Cierres - Hotel Kodiak',
          text: text
        });
      } else {
        await navigator.clipboard.writeText(text);
        alert("Copiado al portapapeles. Puede pegarlo y compartirlo por WhatsApp.");
      }
    } catch (err: any) {
      console.error("Error al compartir reporte:", err);
      try {
        await navigator.clipboard.writeText(`REPORTE DE CIERRES - HOTEL KODIAK`);
        alert("Copiado al portapapeles.");
      } catch (e) {
        alert("No se pudo compartir ni copiar el reporte.");
      }
    }
  };

  // Monitor stock level changes in real-time to alert when entering low stock
  useEffect(() => {
    if (liveInventoryProducts.length === 0) return;

    const currentStocks: Record<string, number> = {};
    const newlyLowProducts: string[] = [];

    liveInventoryProducts.forEach(p => {
      const stockVal = getProductStockNumber(p);
      const minVal = getProductMinStockNumber(p);
      const isLow = stockVal <= minVal;
      
      currentStocks[p.id] = stockVal;

      if (!isFirstLoadRef.current) {
        const prevStock = prevStocksRef.current[p.id];
        if (prevStock !== undefined) {
          const prevMin = getProductMinStockNumber(p);
          const wasLow = prevStock <= prevMin;
          if (!wasLow && isLow) {
            newlyLowProducts.push(p.nombre);
          }
        }
      }
    });

    prevStocksRef.current = currentStocks;
    isFirstLoadRef.current = false;

    if (newlyLowProducts.length > 0) {
      const names = newlyLowProducts.join(', ');
      setLatestNotification(`⚠️ Alerta: El producto "${names}" ha entrado en stock bajo.`);
      
      // Attempt to play a double-beep audio alert
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          const audioCtx = new AudioContextClass();
          const playBeep = () => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.12);
          };
          playBeep();
          setTimeout(playBeep, 180);
        }
      } catch (e) {
        console.warn('Audio alert blocked or not supported:', e);
      }
    }
  }, [liveInventoryProducts]);

  // Keep the active room detail modal up to date in real-time
  const activeRoomDetail = useMemo(() => {
    if (!selectedRoom) return null;
    return rooms.find(r => r.id === selectedRoom.id) || selectedRoom;
  }, [selectedRoom, rooms]);

  // Find all movements associated with the active room detail
  const activeRoomMovements = useMemo(() => {
    if (!activeRoomDetail) return [];
    
    // 1. Find all sales associated with this room
    const associatedSales = sales
      .filter(s => s.habitacionId === activeRoomDetail.id || s.habitacionNombre === activeRoomDetail.nombre)
      .map(s => ({
        id: s.id,
        tipo: 'venta' as const,
        concepto: s.concepto,
        total: s.total,
        fecha: s.fecha,
        hora: s.hora,
        empleada: s.empleada,
        metodoPago: s.metodoPago,
        tipoVenta: s.tipoVenta,
        createdAt: s.createdAt
      }));

    // 2. Find all reservations associated with this room
    const associatedReservations = reservations
      .filter(r => r.roomId === activeRoomDetail.id || r.roomName === activeRoomDetail.nombre)
      .map(r => ({
        id: r.id,
        tipo: 'reserva' as const,
        concepto: `Reserva registrada para ${r.clientName}`,
        total: r.amountPaid,
        fecha: r.checkInDate,
        hora: r.checkInTime,
        empleada: 'Sistema',
        metodoPago: 'Efectivo' as const,
        tipoVenta: 'reserva' as const,
        createdAt: r.createdAt
      }));

    return [...associatedSales, ...associatedReservations]
      .sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt));
  }, [activeRoomDetail, sales, reservations]);

  // Filter only transactions for today (using Colombia/local timezone based on 2026-07-04)
  const todayStr = new Date().toISOString().substring(0, 10);

  const stats = useMemo(() => {
    // La vista del propietario debe usar el mismo criterio que CajaView:
    // si hay turno abierto, TODO se filtra por activeShift.id.
    // Solo si no hay turno abierto se usa el resumen del día como respaldo.
    const activeShift = shifts.find(s => s.estado === 'abierto');
    const activeShiftId = activeShift?.id;

    const validSales = (Array.isArray(sales) ? sales : []).filter(s => s.type !== 'stock_add');
    const validExpenses = Array.isArray(expenses) ? expenses : [];

    const salesToday = activeShiftId
      ? validSales.filter(s => belongsToShift(s, activeShiftId))
      : validSales.filter(s => isToday(s.createdAt, s.fecha));

    const expensesToday = activeShiftId
      ? validExpenses.filter(e => belongsToShift(e, activeShiftId))
      : validExpenses.filter(e => (e.createdAt || e.fecha) ? isToday(e.createdAt, e.fecha) : false);

    const closuresToday = (Array.isArray(closures) ? closures : []).filter(c => isToday(c.createdAt, c.fechaCierre));

    const totalVentasHabitacion = salesToday
      .filter(s => s.tipoVenta === 'habitacion')
      .reduce((acc, curr) => acc + getMoneyValue(curr.total), 0);

    const totalVentasProductos = salesToday
      .filter(s => s.tipoVenta === 'producto')
      .reduce((acc, curr) => acc + getMoneyValue(curr.total), 0);

    const totalReservasAbonos = salesToday
      .filter(s => s.tipoVenta === 'reserva' || s.tipoVenta === 'abono_reserva' || s.tipoVenta === 'saldo_reserva')
      .reduce((acc, curr) => acc + getMoneyValue(curr.total), 0);

    const ingresosTotales = salesToday.reduce((acc, curr) => acc + getMoneyValue(curr.total), 0);

    const ingresosEfectivo = salesToday
      .filter(s => isOwnerCashPayment(s.metodoPago))
      .reduce((acc, curr) => acc + getMoneyValue(curr.total), 0);

    const ingresosTransferencia = salesToday
      .filter(s => isOwnerTransferPayment(s.metodoPago))
      .reduce((acc, curr) => acc + getMoneyValue(curr.total), 0);

    const gastosEfectivo = expensesToday
      .filter(e => isOwnerCashPayment(e.metodoPago))
      .reduce((acc, curr) => acc + getMoneyValue(curr.valor), 0);

    const gastosTransferencia = expensesToday
      .filter(e => isOwnerTransferPayment(e.metodoPago))
      .reduce((acc, curr) => acc + getMoneyValue(curr.valor), 0);

    const totalGastos = expensesToday.reduce((acc, curr) => acc + getMoneyValue(curr.valor), 0);
    const gananciaNeta = ingresosTotales - totalGastos;
    const baseInicialActiva = activeShift?.baseInicial === 668500 ? 0 : getMoneyValue(activeShift?.baseInicial);
    const cajaFisicaEsperada = baseInicialActiva + ingresosEfectivo - gastosEfectivo;

    // Room stats
    const totalRooms = rooms.length;
    const occupiedRooms = rooms.filter(r => r.estado === 'ocupada').length;
    const availableRooms = totalRooms - occupiedRooms;

    // Low stock alert products
    const lowStockAlerts = liveInventoryProducts.filter(p => {
      const stockVal = getProductStockNumber(p);
      const minVal = getProductMinStockNumber(p);
      return stockVal <= minVal;
    });

    // Reservations for today
    const reservationsToday = reservations.filter(r => isToday(r.createdAt, r.checkInDate));

    // Latest Closure
    const lastClosure = closures.length > 0 
      ? closures.reduce((prev, current) => {
          return new Date(prev.createdAt) > new Date(current.createdAt) ? prev : current;
        })
      : null;

    return {
      ingresosTotales,
      ingresosEfectivo,
      ingresosTransferencia,
      gastosEfectivo,
      gastosTransferencia,
      cajaFisicaEsperada,
      totalVentasHabitacion,
      totalVentasProductos,
      totalReservasAbonos,
      totalGastos,
      gananciaNeta,
      occupiedRooms,
      availableRooms,
      lowStockAlerts,
      reservationsToday,
      activeShift,
      lastClosure,
      salesToday,
      expensesToday,
      closuresToday,
      scopeLabel: activeShiftId ? 'turno activo' : 'día'
    };
  }, [rooms, liveInventoryProducts, sales, expenses, shifts, closures, reservations]);


  const selectedClosureBreakdown = useMemo(() => {
    return buildClosureOperationalBreakdown(selectedClosure, sales, expenses);
  }, [selectedClosure, sales, expenses]);

  const visibleAlerts = Array.isArray(systemAlerts) ? systemAlerts : [];
  const report = dailyReport || stats;


  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans pb-20 select-none">
      
      {/* Floating Low Stock Alert Notification Banner */}
      {latestNotification && (
        <div className="fixed top-4 left-4 right-4 z-50 bg-red-600 border border-red-500 rounded-2xl p-4 shadow-2xl flex items-start justify-between gap-3 animate-slide-in">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="h-5 w-5 text-white shrink-0 mt-0.5 animate-bounce" />
            <div>
              <p className="text-xs font-black text-white uppercase tracking-wider">Aviso de Inventario</p>
              <p className="text-xs font-bold text-red-100 mt-0.5">{latestNotification}</p>
            </div>
          </div>
          <button 
            onClick={() => setLatestNotification(null)}
            className="text-red-200 hover:text-white p-1 rounded-lg transition-colors bg-red-700/50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Mobile Sticky Header */}
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl border border-slate-800 bg-slate-950 flex items-center justify-center overflow-hidden">
            <img 
              src={hotelLogo} 
              alt="Hotel Kodiak Logo" 
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight uppercase">Kodiak Propietario</h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${
                onlineStatus === 'online' ? 'bg-emerald-500 animate-pulse' : 
                onlineStatus === 'syncing' ? 'bg-amber-500 animate-spin' : 'bg-red-500'
              }`} />
              <span className="text-[10px] text-slate-400 capitalize">
                {onlineStatus === 'online' ? 'En Vivo' : onlineStatus === 'syncing' ? 'Sincronizando' : 'Sin Conexión'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowDebug(prev => !prev)}
            title="Panel de Diagnóstico"
            className={`p-2 rounded-xl transition-colors ${showDebug ? 'text-emerald-400 bg-slate-800' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}
          >
            <Activity className="h-4.5 w-4.5" />
          </button>

          <div className="text-right">
            <span className="text-[10px] font-bold text-slate-300 block max-w-[80px] truncate">
              {userProfile.nombre}
            </span>
            <span className="text-[8px] bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 px-1.5 py-0.5 rounded-full uppercase tracking-wider font-extrabold">
              {userProfile.rol}
            </span>
          </div>
          <button 
            onClick={onLogout}
            title="Cerrar sesión"
            className="flex items-center gap-1 px-2.5 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 rounded-xl text-red-400 hover:text-red-300 text-xs font-bold transition-all cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
            <span className="text-[11px]">Salir</span>
          </button>
        </div>
      </header>

      {/* Main Area */}
      <main className="flex-1 p-5 overflow-y-auto space-y-6">
        
        {/* Banner Sincronización */}
        {isFirebaseConfigured ? (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4.5 relative overflow-hidden shadow-xl space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs text-emerald-400 font-extrabold uppercase tracking-widest">Sincronización Activa</span>
            </div>
            <p className="text-sm font-bold text-white leading-normal mt-1">
              “Firebase conectado. Sincronización en tiempo real activa.”
            </p>
            <p className="text-[10px] text-slate-400">Su dispositivo está conectado a la nube y recibe actualizaciones al instante.</p>
          </div>
        ) : (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4.5 relative overflow-hidden shadow-xl space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
              <span className="text-xs text-amber-400 font-extrabold uppercase tracking-widest">Monitoreo Limitado</span>
            </div>
            <p className="text-sm font-bold text-white leading-normal mt-1">
              “Modo local activo. Este dispositivo no está sincronizado con Firebase.”
            </p>
            <p className="text-[10px] text-slate-400">La persistencia es estrictamente local en este navegador.</p>
          </div>
        )}

        {/* Alertas reales del propietario */}
        {visibleAlerts.length > 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-400" />
                <span className="text-xs font-black uppercase tracking-widest text-white">Alertas del hotel</span>
              </div>
              <span className="text-[10px] text-slate-400 font-bold">{visibleAlerts.length} activa(s)</span>
            </div>
            <div className="space-y-2">
              {visibleAlerts.slice(0, 6).map((alert: any) => (
                <div key={alert.id} className={`rounded-xl border p-3 ${getOwnerAlertClasses(alert.severity)}`}>
                  <div className="text-[11px] font-black uppercase tracking-wide">{alert.title}</div>
                  <div className="text-[10px] opacity-90 leading-snug mt-1">{alert.message}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reporte rápido del día / turno */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3">
            <span className="text-[9px] text-slate-500 uppercase font-bold">Caja esperada</span>
            <strong className="block text-sm text-emerald-400 font-black mt-1">{formatCop(report.cajaEsperada || report.cajaFisicaEsperada || 0)}</strong>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3">
            <span className="text-[9px] text-slate-500 uppercase font-bold">Total ventas</span>
            <strong className="block text-sm text-white font-black mt-1">{formatCop(report.totalVentas || report.ingresosTotales || 0)}</strong>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3">
            <span className="text-[9px] text-slate-500 uppercase font-bold">Efectivo</span>
            <strong className="block text-sm text-emerald-400 font-black mt-1">{formatCop(report.ingresosEfectivo || report.ventasEfectivo || stats.ingresosEfectivo || 0)}</strong>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3">
            <span className="text-[9px] text-slate-500 uppercase font-bold">Transferencias</span>
            <strong className="block text-sm text-indigo-400 font-black mt-1">{formatCop(report.ingresosTransferencia || report.ventasTransferencia || stats.ingresosTransferencia || 0)}</strong>
          </div>
        </div>

        {/* Panel de Diagnóstico */}
        {showDebug && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4.5 space-y-3 shadow-xl animate-fade-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-emerald-400" />
                <span className="text-xs font-extrabold uppercase tracking-widest text-slate-300">Diagnóstico en Tiempo Real</span>
              </div>
              <button 
                onClick={() => setShowDebug(false)}
                className="text-[9px] text-slate-500 hover:text-slate-300 font-bold border border-slate-800 px-2 py-0.5 rounded-lg transition-colors"
              >
                Ocultar
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
              <div className="bg-slate-950 p-2 rounded-xl border border-slate-800/60">
                <span className="text-slate-500 block text-[8px] uppercase font-bold">Firebase Conectado</span>
                <span className={`font-bold ${isFirebaseConfigured ? 'text-emerald-400' : 'text-amber-500'}`}>
                  {isFirebaseConfigured ? 'SÍ' : 'NO'}
                </span>
              </div>
              <div className="bg-slate-950 p-2 rounded-xl border border-slate-800/60">
                <span className="text-slate-500 block text-[8px] uppercase font-bold">Proyecto ID</span>
                <span className="text-white truncate block">
                  {((import.meta as any).env)?.VITE_FIREBASE_PROJECT_ID || 'hotel-kodiak-pos'}
                </span>
              </div>
              <div className="bg-slate-950 p-2 rounded-xl border border-slate-800/60">
                <span className="text-slate-500 block text-[8px] uppercase font-bold">Usuario / Rol</span>
                <span className="text-indigo-400 truncate block">
                  {userProfile.nombre} ({userProfile.rol})
                </span>
              </div>
              <div className="bg-slate-950 p-2 rounded-xl border border-slate-800/60">
                <span className="text-slate-500 block text-[8px] uppercase font-bold">Último Sync</span>
                <span className="text-amber-400 block font-bold">
                  {new Date().toLocaleTimeString('es-CO')}
                </span>
              </div>
              <div className="bg-slate-950 p-2 rounded-xl border border-slate-800/60">
                <span className="text-slate-500 block text-[8px] uppercase font-bold">Ventas/Cobros Recibidos</span>
                <span className="text-emerald-400 block font-bold">{sales.length} docs</span>
              </div>
              <div className="bg-slate-950 p-2 rounded-xl border border-slate-800/60">
                <span className="text-slate-500 block text-[8px] uppercase font-bold">Habitaciones Recibidas</span>
                <span className="text-white block font-bold">{rooms.length} docs</span>
              </div>
              <div className="bg-slate-950 p-2 rounded-xl border border-slate-800/60 col-span-2">
                <span className="text-slate-500 block text-[8px] uppercase font-bold">Movimientos del Turno (Filtrados)</span>
                <span className="text-white block font-semibold">
                  Cobros: {stats.salesToday.length} | Gastos: {stats.expensesToday.length} | Cierres: {stats.closuresToday.length}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Tab Resumen */}
        {activeTab === 'resumen' && (
          <div className="space-y-6 animate-fade-in">
            {/* KPI Cards Grid */}
            <div className="grid grid-cols-2 gap-3.5">
              
              {/* 1. Ingresos del Turno */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Ingresos del Turno</span>
                  <div className="p-1.5 bg-emerald-500/10 rounded-lg text-emerald-400">
                    <TrendingUp className="h-4 w-4" />
                  </div>
                </div>
                <div>
                  <h3 className="text-base font-black text-emerald-400 font-mono">{formatCop(stats.ingresosTotales)}</h3>
                  <p className="text-[9px] text-slate-500">Total del turno activo</p>
                </div>
              </div>

              {/* 2. Efectivo del turno */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Efectivo</span>
                  <div className="p-1.5 bg-emerald-500/10 rounded-lg text-emerald-400">
                    <Coins className="h-4 w-4" />
                  </div>
                </div>
                <div>
                  <h3 className="text-base font-black text-emerald-400 font-mono">{formatCop(stats.ingresosEfectivo)}</h3>
                  <p className="text-[9px] text-slate-500">Ventas pagadas en efectivo</p>
                </div>
              </div>

              {/* 3. Transferencias */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Transferencias</span>
                  <div className="p-1.5 bg-indigo-500/10 rounded-lg text-indigo-400">
                    <CreditCard className="h-4 w-4" />
                  </div>
                </div>
                <div>
                  <h3 className="text-base font-black text-indigo-400 font-mono">{formatCop(stats.ingresosTransferencia)}</h3>
                  <p className="text-[9px] text-slate-500">Pagos no efectivos</p>
                </div>
              </div>

              {/* 4. Gastos */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Gastos</span>
                  <div className="p-1.5 bg-red-500/10 rounded-lg text-red-400">
                    <AlertCircle className="h-4 w-4" />
                  </div>
                </div>
                <div>
                  <h3 className="text-base font-black text-red-400 font-mono">{formatCop(stats.totalGastos)}</h3>
                  <p className="text-[9px] text-slate-500">Egresos registrados</p>
                </div>
              </div>

              {/* 5. Habitaciones Ocupadas */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Hab. Ocupadas</span>
                  <div className="p-1.5 bg-amber-500/10 rounded-lg text-amber-400">
                    <Bed className="h-4 w-4" />
                  </div>
                </div>
                <div>
                  <h3 className="text-base font-black text-amber-400 font-mono">{stats.occupiedRooms}</h3>
                  <p className="text-[9px] text-slate-500">Habitaciones ocupadas</p>
                </div>
              </div>

              {/* 6. Habitaciones Disponibles */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Hab. Disponibles</span>
                  <div className="p-1.5 bg-emerald-500/10 rounded-lg text-emerald-400">
                    <Bed className="h-4 w-4" />
                  </div>
                </div>
                <div>
                  <h3 className="text-base font-black text-emerald-400 font-mono">{stats.availableRooms}</h3>
                  <p className="text-[9px] text-slate-500">Listas para rentar</p>
                </div>
              </div>

              {/* 7. Reservas de Hoy */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Reservas Hoy</span>
                  <div className="p-1.5 bg-indigo-500/10 rounded-lg text-indigo-400">
                    <Calendar className="h-4 w-4" />
                  </div>
                </div>
                <div>
                  <h3 className="text-base font-black text-indigo-300 font-mono">{stats.reservationsToday.length}</h3>
                  <p className="text-[9px] text-slate-500">Check-in para hoy</p>
                </div>
              </div>

              {/* 8. Stock Bajo */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Stock Bajo</span>
                  <div className={`p-1.5 rounded-lg ${stats.lowStockAlerts.length > 0 ? 'bg-red-500/15 text-red-400' : 'bg-slate-800 text-slate-400'}`}>
                    <Package className="h-4 w-4" />
                  </div>
                </div>
                <div>
                  <h3 className={`text-base font-black font-mono ${stats.lowStockAlerts.length > 0 ? 'text-red-400' : 'text-slate-300'}`}>
                    {stats.lowStockAlerts.length}
                  </h3>
                  <p className="text-[9px] text-slate-500">Productos con alerta</p>
                </div>
              </div>

              {/* 9. Últimos Movimientos */}
              <div 
                onClick={() => setActiveTab('ventas')}
                className="bg-gradient-to-r from-slate-900 to-indigo-950/80 border border-indigo-500/15 hover:border-indigo-500/30 rounded-2xl p-4 space-y-1.5 col-span-2 cursor-pointer active:scale-[0.99] transition-all shadow-lg"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-indigo-400 animate-pulse" />
                    <span className="text-[10px] font-black text-indigo-300 uppercase tracking-wider">Últimos Movimientos</span>
                  </div>
                  <span className="text-[9px] font-extrabold text-indigo-400 uppercase tracking-widest flex items-center gap-1 bg-indigo-500/10 border border-indigo-500/25 px-2.5 py-0.5 rounded-full">
                    Ver Registro <ArrowUpRight className="h-3 w-3" />
                  </span>
                </div>
                <div>
                  <p className="text-[11px] text-slate-300 font-medium">
                    {stats.salesToday.length + stats.expensesToday.length + stats.closuresToday.length > 0 
                      ? `En el turno actual se registran ${stats.salesToday.length + stats.expensesToday.length + stats.closuresToday.length} movimientos en tiempo real. Toque aquí para ver el detalle.`
                      : "No se registran movimientos para el día de hoy aún. Toque aquí para abrir el historial."
                    }
                  </p>
                </div>
              </div>

            </div>

            {/* Categorías de Ingresos */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4.5 space-y-3.5">
              <h3 className="text-xs font-black text-white uppercase tracking-wider">Detalle de Ingresos del Turno</h3>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs border-b border-slate-800 pb-2">
                  <span className="text-slate-400">Hospedajes / Habitaciones</span>
                  <span className="font-bold text-white font-mono">{formatCop(stats.totalVentasHabitacion)}</span>
                </div>
                <div className="flex items-center justify-between text-xs border-b border-slate-800 pb-2">
                  <span className="text-slate-400">Ventas Productos</span>
                  <span className="font-bold text-white font-mono">{formatCop(stats.totalVentasProductos)}</span>
                </div>
                <div className="flex items-center justify-between text-xs pb-1">
                  <span className="text-slate-400">Reservas / Abonos</span>
                  <span className="font-bold text-white font-mono">{formatCop(stats.totalReservasAbonos)}</span>
                </div>
              </div>
            </div>

            {/* Alerta de Stock */}
            {stats.lowStockAlerts.length > 0 && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4.5 space-y-2.5">
                <div className="flex items-center gap-2 text-amber-500">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <h4 className="text-xs font-black uppercase tracking-wider">Alerta: Bajo Stock de Productos</h4>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-amber-200">
                  {stats.lowStockAlerts.map(p => (
                    <div key={p.id} className="bg-slate-950/45 p-2 rounded-xl flex justify-between items-center">
                      <span className="truncate max-w-[80px] font-bold">{p.nombre}</span>
                      <span className="font-mono bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-extrabold">{p.stock} un.</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Turno Activo */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4.5 space-y-3">
              <h3 className="text-xs font-black text-white uppercase tracking-wider">Turno Actual en Recepción</h3>
              {stats.activeShift ? (
                <div className="bg-emerald-950/20 border border-emerald-900/45 p-3 rounded-xl space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                      Estado: Abierto
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {stats.activeShift.horaApertura}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs pt-1">
                    <span className="text-slate-400">Atendido por:</span>
                    <span className="font-bold text-white flex items-center gap-1">
                      <User className="h-3.5 w-3.5 text-emerald-400" />
                      {getEmployeeFullName(stats.activeShift.empleada)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Caja Base Inicial:</span>
                    <span className="font-bold text-white font-mono">{formatCop(stats.activeShift.baseInicial === 668500 ? 0 : stats.activeShift.baseInicial)}</span>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-red-950/20 border border-red-900/40 rounded-xl text-center">
                  <p className="text-xs text-red-400 font-bold">No hay ningún turno abierto actualmente.</p>
                  <p className="text-[10px] text-slate-500 mt-1">La recepcionista debe abrir turno en el computador.</p>
                </div>
              )}
            </div>

            {/* Último Cierre de Turno */}
            {stats.lastClosure && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4.5 space-y-3">
                <h3 className="text-xs font-black text-white uppercase tracking-wider">Último Cierre Registrado</h3>
                <div className="bg-slate-950/60 border border-slate-800 p-3.5 rounded-xl space-y-2">
                  <div className="flex justify-between text-[10px] text-slate-500 border-b border-slate-800 pb-1.5 mb-2">
                    <span>Cierre: {stats.lastClosure.fechaCierre}</span>
                    <span>Hora: {stats.lastClosure.horaCierre}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Entrega / Recibe:</span>
                    <span className="font-semibold text-white">
                      {getEmployeeFullName(stats.lastClosure.empleadaEntrega)} → {getEmployeeFullName(stats.lastClosure.empleadoRecibe)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Ventas Totales:</span>
                    <span className="font-black text-emerald-400 font-mono">{formatCop(stats.lastClosure.totalVentas)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Diferencia de Caja:</span>
                    <span className={`font-black font-mono ${stats.lastClosure.diferenciaCaja >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                      {stats.lastClosure.diferenciaCaja >= 0 ? '+' : ''}{formatCop(stats.lastClosure.diferenciaCaja)}
                    </span>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}

        {/* Tab Habitaciones */}
        {activeTab === 'habitaciones' && (
          <div className="space-y-4 animate-fade-in">
            <div className="flex justify-between items-center pb-1">
              <h3 className="text-xs font-black text-white uppercase tracking-wider">Monitor de Habitaciones ({rooms.length})</h3>
              <span className="text-[10px] bg-indigo-500/10 border border-indigo-500/25 px-2 py-0.5 rounded-full text-indigo-400 font-bold">
                Ocupadas: {stats.occupiedRooms}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {rooms.map(room => {
                const isRoomOccupied = 
                  room.estado === 'ocupada' || 
                  room.status === 'occupied' || 
                  room.isOccupied === true || 
                  room.occupied === true;
                return (
                  <div 
                    key={room.id}
                    onClick={() => setSelectedRoom(room)}
                    className={`cursor-pointer active:scale-[0.98] hover:border-indigo-500/40 transition-all border rounded-2xl p-3.5 space-y-2 relative overflow-hidden shadow-md ${
                      isRoomOccupied 
                        ? 'bg-amber-950/20 border-amber-900/60 text-amber-200' 
                        : 'bg-slate-900 border-slate-800 text-slate-300'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <span className="text-xs font-black text-white truncate max-w-[80px]">{room.nombre}</span>
                      <span className={`text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded font-extrabold ${
                        isRoomOccupied 
                          ? 'bg-amber-500/20 text-amber-400' 
                          : 'bg-slate-950 text-emerald-400 border border-emerald-500/25'
                      }`}>
                        {isRoomOccupied ? 'ocupada' : 'disponible'}
                      </span>
                    </div>

                    {isRoomOccupied ? (
                      <div className="space-y-1 text-[10px]">
                        <div className="flex justify-between text-amber-300/85">
                          <span>Huésped:</span>
                          <span className="font-bold truncate max-w-[50px]">{room.cliente || 'Anonimo'}</span>
                        </div>
                        <div className="flex justify-between text-amber-300/85">
                          <span>Ingreso:</span>
                          <span className="font-mono text-[9px]">{room.horaIngreso}</span>
                        </div>
                        <div className="flex justify-between text-amber-300/85">
                          <span>Valor:</span>
                          <span className="font-bold font-mono text-white">{formatCop(room.valorCobrado || 0)}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="py-2 flex items-center justify-center text-[10px] text-slate-500 italic">
                        Disponible para alquiler
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab Ventas */}
        {activeTab === 'ventas' && (
          <div className="space-y-4 animate-fade-in">
            <h3 className="text-xs font-black text-white uppercase tracking-wider">Últimos Movimientos del Día</h3>
            
            {/* Sales List */}
            <div className="space-y-2.5">
              {stats.salesToday.length === 0 && stats.expensesToday.length === 0 && stats.closuresToday.length === 0 ? (
                <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-2xl text-slate-500 text-xs italic">
                  No se registran movimientos para el día de hoy.
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Combina ventas, gastos y cierres de turno del dia */}
                  {[
                    ...stats.salesToday.map(s => ({ ...s, tipo: 'venta' as const })),
                    ...stats.expensesToday.map(e => ({ ...e, tipo: 'gasto' as const, total: e.valor })),
                    ...stats.closuresToday.map(c => ({
                      id: c.id,
                      tipo: 'cierre' as const,
                      concepto: `Cierre: ${c.empleadaEntrega} entregó a ${c.empleadoRecibe}`,
                      total: c.totalVentas,
                      hora: c.horaCierre,
                      empleada: c.empleadaEntrega,
                      metodoPago: 'Efectivo' as const,
                      createdAt: c.createdAt,
                      tipoVenta: 'Cierre' as any
                    }))
                  ]
                    .sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt))
                    .slice(0, 25)
                    .map((item, idx) => {
                      const isVenta = item.tipo === 'venta';
                      const isGasto = item.tipo === 'gasto';
                      const isCierre = item.tipo === 'cierre';
                      
                      const cardStyle = isVenta
                        ? 'bg-slate-900 border-slate-800'
                        : isGasto
                        ? 'bg-red-950/10 border-red-900/30'
                        : 'bg-indigo-950/20 border-indigo-900/30';
                        
                      const amountColor = isVenta
                        ? 'text-emerald-400'
                        : isGasto
                        ? 'text-red-400'
                        : 'text-indigo-400';
                        
                      const amountPrefix = isVenta ? '+' : isGasto ? '-' : '• ';
                      
                      const categoryLabel = isVenta
                        ? (item as any).tipoVenta
                        : isGasto
                        ? 'Gasto'
                        : 'Cierre';

                      return (
                        <div 
                          key={idx}
                          className={`p-3 rounded-xl border flex items-center justify-between ${cardStyle}`}
                        >
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[11px] font-bold text-white max-w-[170px] truncate">
                              {item.concepto}
                            </span>
                            <span className="text-[9px] text-slate-500 flex items-center gap-1">
                              <Clock className="h-2.5 w-2.5" />
                              {item.hora} • Por {item.empleada}
                            </span>
                            {!isCierre && (
                              <span className={`text-[8px] px-1.5 py-0.2 rounded w-fit capitalize font-extrabold ${
                                item.metodoPago === 'Efectivo' 
                                  ? 'bg-emerald-500/10 text-emerald-400' 
                                  : 'bg-indigo-500/10 text-indigo-400'
                              }`}>
                                {item.metodoPago}
                              </span>
                            )}
                          </div>
                          <div className="text-right flex flex-col items-end">
                            <span className={`text-xs font-black font-mono ${amountColor}`}>
                              {amountPrefix}{formatCop(item.total)}
                            </span>
                            <span className="text-[8px] bg-slate-950/80 px-1 py-0.5 rounded text-slate-400 font-bold uppercase mt-1">
                              {categoryLabel}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  }
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab Inventario */}
        {activeTab === 'inventario' && (
          <div className="space-y-4 animate-fade-in">
            <h3 className="text-xs font-black text-white uppercase tracking-wider">Control de Stock de Inventario ({liveInventoryProducts.length})</h3>

            <div className="space-y-2">
              {liveInventoryProducts.map(prod => (
                <div 
                  key={prod.id}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-black text-white">{prod.nombre}</span>
                    <span className="text-[10px] text-slate-500">{prod.categoria} • Min: {prod.stockMinimo} un.</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className="text-xs font-black text-slate-300 block font-mono">{formatCop(prod.precio)}</span>
                    </div>

                    <div className={`px-2 py-1 rounded-lg text-center min-w-[50px] ${
                      prod.stock === 0 
                        ? 'bg-red-500/10 text-red-400 border border-red-500/20' 
                        : prod.stock <= prod.stockMinimo 
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' 
                        : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/15'
                    }`}>
                      <span className="text-[11px] font-black font-mono">{prod.stock}</span>
                      <span className="text-[8px] block uppercase font-semibold">Stock</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab Reservas */}
        {activeTab === 'reservas' && (
          <div className="space-y-4 animate-fade-in pb-16">
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-black text-white uppercase tracking-wider">Historial de Reservas ({filteredReservations.length})</h3>
              <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded-full text-emerald-400 font-bold">
                Solo Lectura
              </span>
            </div>

            {/* Search Input */}
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
                <Search className="h-4 w-4" />
              </span>
              <input
                type="text"
                value={searchReserva}
                onChange={(e) => setSearchReserva(e.target.value)}
                placeholder="Buscar cliente, cédula, cel, hab, estado..."
                className="w-full text-xs bg-slate-900 border border-slate-800 text-white rounded-xl py-2.5 pl-9 pr-4 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50"
              />
              {searchReserva && (
                <button
                  onClick={() => setSearchReserva('')}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-500 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Dynamic Filter Buttons Bar */}
            <div className="flex overflow-x-auto gap-2 py-1 scrollbar-none shrink-0 -mx-5 px-5">
              {(['Todas', 'Hoy', 'Mañana', 'Esta semana', 'Este mes', 'Pendientes', 'Confirmadas', 'Pagadas', 'Canceladas'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilterReserva(f)}
                  className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-full shrink-0 border transition-all ${
                    filterReserva === f
                      ? 'bg-emerald-600 border-emerald-500 text-white shadow-md'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>

            {/* Reservations List */}
            <div className="space-y-2.5">
              {filteredReservations.length === 0 ? (
                <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-2xl text-slate-500 text-xs italic">
                  No se encontraron reservas con los filtros seleccionados.
                </div>
              ) : (
                filteredReservations.map((res) => {
                  const valorTotal = (res.amountPaid || 0) + (res.balance || 0);
                  
                  return (
                    <div
                      key={res.id}
                      onClick={() => setSelectedReserva(res)}
                      className="bg-slate-900 border border-slate-800 hover:border-slate-700/65 rounded-xl p-3.5 flex items-center justify-between cursor-pointer active:scale-[0.99] transition-all"
                    >
                      <div className="space-y-1 max-w-[70%]">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-white truncate block max-w-[150px]">{res.clientName}</span>
                          <span className="text-[8px] bg-slate-950 px-1.5 py-0.5 rounded text-slate-400 font-bold uppercase">
                            {res.roomName}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500">
                          In: <span className="text-slate-300 font-semibold">{res.checkInDate}</span> ({res.checkInTime})
                        </p>
                        <p className="text-[10px] text-slate-500">
                          Abono: <span className="text-emerald-400 font-bold">{formatCop(res.amountPaid || 0)}</span> • Saldo: <span className="text-rose-400 font-bold">{formatCop(res.balance || 0)}</span>
                        </p>
                      </div>

                      <div className="text-right flex flex-col items-end justify-between h-full gap-2">
                        <span className={`text-[8px] uppercase tracking-wider px-2 py-0.5 rounded-full font-extrabold ${
                          res.status === 'Confirmada' || res.status === 'Cumplida'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : res.status === 'Pendiente'
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : 'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}>
                          {res.status}
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] font-mono font-black text-white">{formatCop(valorTotal)}</span>
                          <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Tab Cierres */}
        {activeTab === 'cierres' && (
          <div className="space-y-4 animate-fade-in pb-16">
            <div className="flex justify-between items-center bg-slate-900/40 p-3 rounded-2xl border border-slate-800/60">
              <div>
                <h3 className="text-xs font-black text-white uppercase tracking-wider">Historial de Cierres</h3>
                <p className="text-[10px] text-slate-400">
                  Visualizando <b className="text-indigo-400 font-mono">{filteredClosures.length}</b> de <b className="text-slate-300 font-mono">{shiftClosures.length}</b> totales
                </p>
              </div>
              <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1 rounded-full text-emerald-400 font-bold uppercase tracking-wider">
                Hotel Kodiak POS
              </span>
            </div>

            {/* Export and Share Buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleExportToExcel}
                className="flex items-center justify-center gap-1.5 py-2.5 px-4 bg-emerald-600/10 hover:bg-emerald-600/15 border border-emerald-500/20 text-emerald-400 font-bold rounded-xl text-xs transition-all active:scale-[0.98]"
              >
                <FileSpreadsheet className="h-4 w-4" />
                <span>Exportar Excel</span>
              </button>
              <button
                onClick={handleShareReport}
                className="flex items-center justify-center gap-1.5 py-2.5 px-4 bg-indigo-600/10 hover:bg-indigo-600/15 border border-indigo-500/20 text-indigo-400 font-bold rounded-xl text-xs transition-all active:scale-[0.98]"
              >
                <Share2 className="h-4 w-4" />
                <span>Compartir reporte</span>
              </button>
            </div>

            {/* Selection of Closure Filter Range */}
            <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl space-y-3 shadow-md">
              <div className="flex flex-col gap-1">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Periodo de Consulta</span>
                <select
                  value={closureFilter}
                  onChange={(e) => {
                    setClosureFilter(e.target.value as any);
                  }}
                  className="w-full text-xs bg-slate-950 border border-slate-800 text-white rounded-xl p-2.5 font-bold focus:outline-none focus:border-indigo-500/50"
                >
                  <option value="todo">Ver Todo (Por Defecto)</option>
                  <option value="hoy">Hoy (Tiempo Real)</option>
                  <option value="esta_semana">Esta semana</option>
                  <option value="este_mes">Este mes</option>
                  <option value="rango_personalizado">Rango Personalizado</option>
                </select>
              </div>

              {closureFilter === 'rango_personalizado' && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] font-bold text-slate-400 uppercase">Inicio</span>
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      className="w-full text-[10px] bg-slate-950 border border-slate-800 text-white rounded-xl p-2 focus:outline-none focus:border-indigo-500/50"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] font-bold text-slate-400 uppercase">Fin</span>
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="w-full text-[10px] bg-slate-950 border border-slate-800 text-white rounded-xl p-2 focus:outline-none focus:border-indigo-500/50"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* KPI Summary Card according to filter */}
            {filteredClosures.length > 0 && (
              <div className="bg-gradient-to-br from-slate-900 to-indigo-950/30 border border-indigo-900/35 rounded-2xl p-4.5 space-y-3.5 shadow-xl">
                <div className="flex justify-between items-center border-b border-indigo-900/25 pb-2.5">
                  <span className="text-[10px] font-black text-indigo-300 uppercase tracking-wider">
                    Resumen del Periodo ({closuresSummary.cantidadCierres} cierres)
                  </span>
                  <span className={`text-[10px] font-mono font-black ${closuresSummary.gananciaNetaEstimada >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    Neta: {formatCop(closuresSummary.gananciaNetaEstimada)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-y-2.5 gap-x-4 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Total Ventas:</span>
                    <span className="font-bold text-white font-mono">{formatCop(closuresSummary.totalIngresos)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Efectivo:</span>
                    <span className="font-bold text-emerald-400 font-mono">{formatCop(closuresSummary.totalEfectivo)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Gastos:</span>
                    <span className="font-bold text-red-400 font-mono">{formatCop(closuresSummary.totalGastos)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Transferencias:</span>
                    <span className="font-bold text-indigo-400 font-mono">{formatCop(closuresSummary.totalTransferencia)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Nómina:</span>
                    <span className="font-bold text-amber-400 font-mono">{formatCop(closuresSummary.totalNomina)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Diferencias:</span>
                    <span className={`font-bold font-mono ${closuresSummary.diferenciasCajaAcumuladas >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {closuresSummary.diferenciasCajaAcumuladas >= 0 ? '+' : ''}{formatCop(closuresSummary.diferenciasCajaAcumuladas)}
                    </span>
                  </div>
                  <div className="flex justify-between col-span-2 border-t border-slate-800/40 pt-2 text-[10px] text-slate-400">
                    <span>Habitaciones Ocupadas: <b className="text-white font-mono">{closuresSummary.totalHabitacionesOcupadas}</b></span>
                    <span>Productos Vendidos: <b className="text-white font-mono">{closuresSummary.totalProductosVendidos}</b></span>
                  </div>
                </div>
              </div>
            )}

            {/* Search Input for closures */}
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
                <Search className="h-4 w-4" />
              </span>
              <input
                type="text"
                value={searchClosureQuery}
                onChange={(e) => setSearchClosureQuery(e.target.value)}
                placeholder="Buscar por empleada, observaciones, fecha..."
                className="w-full text-xs bg-slate-900 border border-slate-800 text-white rounded-xl py-2.5 pl-9 pr-4 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50"
              />
              {searchClosureQuery && (
                <button
                  onClick={() => setSearchClosureQuery('')}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-500 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Closures List */}
            <div className="space-y-3.5">
              {closuresLoading && filteredClosures.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 bg-slate-900 border border-slate-800 rounded-2xl">
                  <RefreshCw className="h-6 w-6 text-indigo-400 animate-spin" />
                  <span className="text-xs text-slate-400 font-bold">Cargando cierres de caja...</span>
                </div>
              ) : filteredClosures.length === 0 ? (
                <div className="p-6 text-center bg-slate-900/80 border border-slate-850 rounded-2xl text-slate-400 space-y-4">
                  <p className="text-xs font-semibold leading-relaxed">
                    No hay cierres para este filtro. Cambie a <b className="text-indigo-400 uppercase font-bold">Ver Todo</b> para ver cierres anteriores.
                  </p>
                  <button
                    onClick={() => {
                      setClosureFilter('todo');
                      setSearchClosureQuery('');
                      setCustomStartDate('');
                      setCustomEndDate('');
                    }}
                    className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-md active:scale-[0.97]"
                  >
                    <span>Ver todos los cierres</span>
                  </button>
                </div>
              ) : (
                filteredClosures.map((c) => {
                  const dateObj = getClosureDate(c);
                  const fecha = dateObj ? formatClosureDateOnly(dateObj) : (c.fechaCierre || (c as any).fecha || 'Sin fecha');
                  const hora = dateObj ? formatClosureTimeOnly(dateObj) : (c.horaCierre || (c as any).hora || 'Sin hora');
                  const cerro = getEmployeeFullName(c.empleadaEntrega || (c as any).employeeName || (c as any).createdByEmail);
                  const recibe = getEmployeeFullName(c.empleadoRecibe || (c as any).receiverEmployeeName);

                  const esperado = Number(c.totalEsperadoEfectivo ?? (c as any).expectedCash ?? 0);
                  const contado = Number(c.dineroFisicoContado ?? (c as any).physicalCash ?? 0);
                  const diff = Number(c.diferenciaCaja ?? (c as any).cashDifference ?? (contado - esperado));

                  return (
                    <div
                      key={c.id}
                      className="bg-slate-900 border border-slate-800 rounded-2xl p-4.5 space-y-3.5 shadow-md hover:border-slate-700 transition-colors animate-fade-in"
                    >
                      {/* Card Header: Date & Status */}
                      <div className="flex justify-between items-start">
                        <div className="space-y-0.5">
                          <span className="text-[10px] text-slate-400 font-mono font-medium block">
                            {fecha}
                          </span>
                          <span className="text-xs text-white font-bold block">
                            {hora}
                          </span>
                        </div>
                        {getClosureStatusBadge(diff)}
                      </div>

                      {/* Card Body: Employees */}
                      <div className="grid grid-cols-2 gap-3 py-2.5 border-y border-slate-800/60 text-[11px]">
                        <div>
                          <span className="text-[9px] text-slate-500 uppercase font-black tracking-wider block mb-0.5">Cerró</span>
                          <span className="text-slate-200 font-semibold truncate block" title={cerro}>
                            {cerro}
                          </span>
                        </div>
                        <div>
                          <span className="text-[9px] text-slate-500 uppercase font-black tracking-wider block mb-0.5">Recibió</span>
                          <span className="text-slate-200 font-semibold truncate block" title={recibe}>
                            {recibe}
                          </span>
                        </div>
                      </div>

                      {/* Card Body: Cash Metrics */}
                      <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                        <div className="bg-slate-950/45 rounded-lg p-2 border border-slate-900/30">
                          <span className="text-[8px] text-slate-500 font-black uppercase block mb-0.5">Esperado</span>
                          <span className="font-mono font-black text-slate-200">{formatCop(esperado)}</span>
                        </div>
                        <div className="bg-slate-950/45 rounded-lg p-2 border border-slate-900/30">
                          <span className="text-[8px] text-slate-500 font-black uppercase block mb-0.5">Contado</span>
                          <span className="font-mono font-black text-white">{formatCop(contado)}</span>
                        </div>
                        <div className={`rounded-lg p-2 border ${diff === 0 ? 'bg-emerald-950/10 border-emerald-900/20' : diff < 0 ? 'bg-rose-950/10 border-rose-900/20' : 'bg-amber-950/10 border-amber-900/20'}`}>
                          <span className="text-[8px] text-slate-500 font-black uppercase block mb-0.5">Diferencia</span>
                          <span className={`font-mono font-black ${diff === 0 ? 'text-emerald-400' : diff < 0 ? 'text-rose-400' : 'text-amber-400'}`}>
                            {diff > 0 ? '+' : ''}{formatCop(diff)}
                          </span>
                        </div>
                      </div>

                      {/* Card Footer: Detail Button */}
                      <div className="flex justify-end pt-1">
                        <button
                          onClick={() => setSelectedClosure(c)}
                          className="flex items-center gap-1.5 text-[11px] font-black text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/15 border border-indigo-500/20 px-3.5 py-1.5 rounded-xl transition-all"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>Ver detalle</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

      </main>

      {/* Touch-Friendly Bottom Tab Navigator */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900 border-t border-slate-800 flex overflow-x-auto scrollbar-none py-2.5 px-4 shadow-2xl justify-between items-center gap-1">
        <button
          onClick={() => setActiveTab('resumen')}
          className={`flex flex-col items-center justify-center gap-1.5 py-1 px-3 shrink-0 min-w-[72px] transition-colors ${
            activeTab === 'resumen' ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Activity className="h-5 w-5" />
          <span className="text-[9px] font-bold uppercase tracking-wider">Resumen</span>
        </button>

        <button
          onClick={() => setActiveTab('habitaciones')}
          className={`flex flex-col items-center justify-center gap-1.5 py-1 px-3 shrink-0 min-w-[72px] transition-colors ${
            activeTab === 'habitaciones' ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Bed className="h-5 w-5" />
          <span className="text-[9px] font-bold uppercase tracking-wider">Habitaciones</span>
        </button>

        <button
          onClick={() => setActiveTab('ventas')}
          className={`flex flex-col items-center justify-center gap-1.5 py-1 px-3 shrink-0 min-w-[72px] transition-colors ${
            activeTab === 'ventas' ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <TrendingUp className="h-5 w-5" />
          <span className="text-[9px] font-bold uppercase tracking-wider">Movimientos</span>
        </button>

        <button
          onClick={() => setActiveTab('inventario')}
          className={`flex flex-col items-center justify-center gap-1.5 py-1 px-3 shrink-0 min-w-[72px] transition-colors ${
            activeTab === 'inventario' ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Package className="h-5 w-5" />
          <span className="text-[9px] font-bold uppercase tracking-wider">Inventario</span>
        </button>

        <button
          onClick={() => setActiveTab('reservas')}
          className={`flex flex-col items-center justify-center gap-1.5 py-1 px-3 shrink-0 min-w-[72px] transition-colors ${
            activeTab === 'reservas' ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Calendar className="h-5 w-5" />
          <span className="text-[9px] font-bold uppercase tracking-wider">Reservas</span>
        </button>

        <button
          onClick={() => setActiveTab('cierres')}
          className={`flex flex-col items-center justify-center gap-1.5 py-1 px-3 shrink-0 min-w-[72px] transition-colors ${
            activeTab === 'cierres' ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileText className="h-5 w-5" />
          <span className="text-[9px] font-bold uppercase tracking-wider">Cierres</span>
        </button>
      </nav>

      {/* Detalle de Habitación Modal */}
      {activeRoomDetail && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md max-h-[85vh] overflow-y-auto flex flex-col shadow-2xl animate-scale-up">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-lg ${activeRoomDetail.estado === 'ocupada' ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                  <Bed className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white uppercase">{activeRoomDetail.nombre}</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Detalle en Tiempo Real</p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedRoom(null)}
                className="p-1.5 hover:bg-slate-850 rounded-xl text-slate-400 hover:text-white transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-5 space-y-5 flex-1">
              
              {/* Room State Info Card */}
              {(() => {
                const isActiveRoomOccupied = 
                  activeRoomDetail.estado === 'ocupada' || 
                  activeRoomDetail.status === 'occupied' || 
                  activeRoomDetail.isOccupied === true || 
                  activeRoomDetail.occupied === true;
                return (
                  <div className={`p-4 rounded-2xl border ${
                    isActiveRoomOccupied 
                      ? 'bg-amber-950/15 border-amber-500/20 text-amber-200' 
                      : 'bg-emerald-950/10 border-emerald-500/20 text-emerald-200'
                  }`}>
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Estado Actual</span>
                      <span className={`text-[9px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded ${
                        isActiveRoomOccupied ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'
                      }`}>
                        {isActiveRoomOccupied ? 'ocupada' : 'disponible'}
                      </span>
                    </div>

                    {isActiveRoomOccupied ? (
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Huésped:</span>
                          <span className="font-bold text-white">{activeRoomDetail.cliente || 'No especificado'}</span>
                        </div>
                        {activeRoomDetail.clienteDetails?.cedula && (
                          <div className="flex justify-between">
                            <span className="text-slate-400">Cédula:</span>
                            <span className="font-mono text-white">{activeRoomDetail.clienteDetails.cedula}</span>
                          </div>
                        )}
                        {activeRoomDetail.clienteDetails?.celular && (
                          <div className="flex justify-between">
                            <span className="text-slate-400">Celular:</span>
                            <span className="font-mono text-white">{activeRoomDetail.clienteDetails.celular}</span>
                          </div>
                        )}
                        {activeRoomDetail.vehiculo && (
                          <div className="flex justify-between">
                            <span className="text-slate-400">Vehículo / Placa:</span>
                            <span className="font-bold text-amber-300">{activeRoomDetail.vehiculo}</span>
                          </div>
                        )}
                        {activeRoomDetail.clienteDetails?.empresa && (
                          <div className="flex justify-between">
                            <span className="text-slate-400">Empresa:</span>
                            <span className="font-semibold text-slate-300">{activeRoomDetail.clienteDetails.empresa}</span>
                          </div>
                        )}
                        <div className="border-t border-slate-800/80 my-2 pt-2 space-y-2">
                          <div className="flex justify-between">
                            <span className="text-slate-400">Servicio de Alquiler:</span>
                            <span className="font-bold text-white uppercase">{(activeRoomDetail as any).tipoServicio || 'Hospedaje'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Método de Pago:</span>
                            <span className="font-bold text-indigo-400">{activeRoomDetail.metodoPago || 'Efectivo'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Registrado por:</span>
                            <span className="font-semibold text-slate-200">{activeRoomDetail.empleada || 'Recepcionista'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Hora de Ingreso:</span>
                            <span className="font-mono font-bold text-white">{activeRoomDetail.horaIngreso}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Valor Cobrado:</span>
                            <span className="font-bold font-mono text-emerald-400">{formatCop(activeRoomDetail.valorCobrado || 0)}</span>
                          </div>
                        </div>
                        {(activeRoomDetail as any).observaciones && (
                          <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 mt-2">
                            <span className="text-[9px] text-slate-500 block uppercase font-black">Observaciones</span>
                            <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed italic">"{(activeRoomDetail as any).observaciones}"</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400 italic text-center py-4">
                        Esta habitación no se encuentra ocupada. Está limpia y disponible para recibir nuevos huéspedes.
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* MOVIMIENTOS DE ESTA HABITACIÓN */}
              <div className="space-y-2.5">
                <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-wider flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5 text-indigo-400 animate-pulse" />
                  Movimientos de esta Habitación
                </h4>

                <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                  {activeRoomMovements.length === 0 ? (
                    <div className="p-4 text-center bg-slate-950 rounded-xl text-slate-600 text-[11px] italic">
                      No se registran movimientos ni consumos previos para esta habitación.
                    </div>
                  ) : (
                    activeRoomMovements.map((mov) => {
                      const isVenta = mov.tipo === 'venta';
                      const amountColor = mov.tipoVenta === 'reserva' ? 'text-indigo-400' : 'text-emerald-400';
                      return (
                        <div key={mov.id} className="bg-slate-950 border border-slate-800/80 p-3 rounded-xl flex justify-between items-center gap-2">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[11px] font-bold text-slate-200 line-clamp-1">{mov.concepto}</span>
                            <span className="text-[9px] text-slate-500">
                              {mov.fecha} {mov.hora} • Por {mov.empleada}
                            </span>
                            <span className="text-[8px] bg-slate-900 border border-slate-800/60 text-indigo-400 font-bold uppercase px-1.5 py-0.5 rounded w-fit">
                              {mov.metodoPago}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className={`text-xs font-black font-mono ${amountColor}`}>
                              +{formatCop(mov.total)}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

            </div>

            {/* Modal Footer (Read Only Warning) */}
            <div className="p-4 bg-slate-950 border-t border-slate-800 rounded-b-3xl text-center">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center justify-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                Rol Propietario / Visor (Sólo Lectura)
              </p>
            </div>

          </div>
        </div>
      )}

      {/* Detalle de Reserva Modal (Solo Lectura) */}
      {selectedReserva && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md max-h-[85vh] overflow-y-auto flex flex-col shadow-2xl animate-scale-up">
            
            {/* Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg">
                  <Calendar className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white uppercase">Reserva de Habitación</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Detalle Completo (Solo Lectura)</p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedReserva(null)}
                className="p-1.5 hover:bg-slate-850 rounded-xl text-slate-400 hover:text-white transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4 text-xs">
              
              {/* Client & Status info */}
              <div className="bg-slate-950/65 border border-slate-800 p-3.5 rounded-2xl space-y-2">
                <div className="flex justify-between items-center border-b border-slate-800 pb-2 mb-1">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Información del Cliente</span>
                  <span className={`text-[8px] uppercase tracking-wider px-2 py-0.5 rounded font-extrabold ${
                    selectedReserva.status === 'Confirmada' || selectedReserva.status === 'Cumplida'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : selectedReserva.status === 'Pendiente'
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      : 'bg-red-500/10 text-red-400 border border-red-500/20'
                  }`}>
                    {selectedReserva.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase font-bold">Huésped Principal</span>
                    <span className="font-bold text-white block truncate">{selectedReserva.clientName}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase font-bold">Cédula / Documento</span>
                    <span className="font-semibold text-slate-300 block">{selectedReserva.clientId || selectedReserva.clientDocument || 'No registrado'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase font-bold">Teléfono Celular</span>
                    <span className="font-semibold text-slate-300 block">{selectedReserva.clientPhone || 'No registrado'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase font-bold">Correo Electrónico</span>
                    <span className="font-semibold text-slate-300 block truncate">{selectedReserva.clientEmail || 'No registrado'}</span>
                  </div>
                </div>
              </div>

              {/* Reservation Dates & Room */}
              <div className="bg-slate-950/65 border border-slate-800 p-3.5 rounded-2xl space-y-2">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Hospedaje & Habitación</span>
                <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase font-bold">Habitación Reservada</span>
                    <span className="font-black text-emerald-400 block uppercase">{selectedReserva.roomName}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase font-bold">Estado de Pago</span>
                    <span className="font-bold text-white block uppercase">{selectedReserva.paymentStatus || 'Pendiente'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase font-bold">Fecha de Ingreso (In)</span>
                    <span className="font-semibold text-slate-200 block">{selectedReserva.checkInDate}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{selectedReserva.checkInTime}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase font-bold">Fecha de Salida (Out)</span>
                    <span className="font-semibold text-slate-200 block">{selectedReserva.checkOutDate}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{selectedReserva.checkOutTime}</span>
                  </div>
                </div>
              </div>

              {/* Financial calculations */}
              <div className="bg-slate-950/65 border border-slate-800 p-3.5 rounded-2xl space-y-2">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Consolidado de Cuenta</span>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-slate-900 border border-slate-800 p-2 rounded-xl">
                    <span className="text-slate-500 block text-[8px] uppercase font-bold">Abono Inicial</span>
                    <span className="font-black text-emerald-400 font-mono">{formatCop(selectedReserva.amountPaid || 0)}</span>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-2 rounded-xl">
                    <span className="text-slate-500 block text-[8px] uppercase font-bold">Saldo Pendiente</span>
                    <span className="font-black text-rose-400 font-mono">{formatCop(selectedReserva.balance || 0)}</span>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-2 rounded-xl">
                    <span className="text-slate-500 block text-[8px] uppercase font-bold">Valor Total</span>
                    <span className="font-black text-white font-mono">{formatCop((selectedReserva.amountPaid || 0) + (selectedReserva.balance || 0))}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-y-1 text-[10px] pt-1 text-slate-400">
                  <span>Método Pago Abono: <b className="text-white">{(selectedReserva as any).metodoPago || 'Efectivo'}</b></span>
                  <span>Ref. Transferencia: <b className="text-white">{(selectedReserva as any).referenciaTransferencia || 'No aplica'}</b></span>
                </div>
              </div>

              {/* Vehicle info */}
              <div className="bg-slate-950/65 border border-slate-800 p-3.5 rounded-2xl space-y-2">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Vehículo del Huésped</span>
                <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase font-bold">Tipo & Marca</span>
                    <span className="font-semibold text-slate-300 block">
                      {(selectedReserva as any).tipoVehiculo || 'No reg.'} • {(selectedReserva as any).marca || 'No reg.'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase font-bold">Placa & Color</span>
                    <span className="font-semibold text-slate-300 block">
                      {(selectedReserva as any).placa || 'No reg.'} • {(selectedReserva as any).color || 'No reg.'}
                    </span>
                  </div>
                  <div className="col-span-2 border-t border-slate-800/40 pt-1.5 mt-0.5">
                    <span className="text-slate-500 block text-[9px] uppercase font-bold">Observación del Vehículo</span>
                    <span className="text-slate-400 block italic">"{(selectedReserva as any).observacionVehiculo || 'Sin observaciones registradas.'}"</span>
                  </div>
                </div>
              </div>

              {/* General observations */}
              <div className="bg-slate-950/65 border border-slate-800 p-3.5 rounded-2xl space-y-1">
                <span className="text-slate-500 block text-[9px] uppercase font-bold">Observaciones Generales de la Reserva</span>
                <p className="text-slate-300 italic">"{selectedReserva.observations || 'Sin novedades ni observaciones especiales.'}"</p>
              </div>

              {/* Metadata log */}
              <div className="grid grid-cols-2 gap-2 text-[9px] text-slate-500 px-1 font-mono">
                <span>Registrado por: {(selectedReserva as any).empleada || 'Sistema (HK)'}</span>
                <span className="text-right">Creado: {selectedReserva.createdAt ? new Date(selectedReserva.createdAt).toLocaleDateString('es-CO') : 'No registrado'}</span>
              </div>

            </div>

            {/* Footer */}
            <div className="p-4 bg-slate-950 border-t border-slate-800 rounded-b-3xl text-center">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center justify-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Rol Propietario / Visor (Sólo Lectura)
              </p>
            </div>

          </div>
        </div>
      )}

      {/* Detalle de Cierre Modal (Solo Lectura) */}
      {selectedClosure && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md max-h-[85vh] overflow-y-auto flex flex-col shadow-2xl animate-scale-up">
            
            {/* Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white uppercase">Resumen de Cierre de Caja</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Detalle del Turno (Solo Lectura)</p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedClosure(null)}
                className="p-1.5 hover:bg-slate-850 rounded-xl text-slate-400 hover:text-white transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4 text-xs">
              
              {/* Handover & Receival log */}
              <div className="bg-slate-950/65 border border-slate-800 p-3.5 rounded-2xl space-y-2">
                <div className="flex justify-between items-center border-b border-slate-800 pb-1.5 mb-1 text-[10px] text-slate-400">
                  <span>Cierre: {selectedClosure.fechaCierre || (selectedClosure as any).fecha || 'Sin fecha'}</span>
                  <span>Hora: {selectedClosure.horaCierre || (selectedClosure as any).hora || 'Sin hora'}</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase font-bold">Empleada que entrega</span>
                    <span className="font-bold text-white block">
                      {getEmployeeFullName(selectedClosure.empleadaEntrega || (selectedClosure as any).closedBy || (selectedClosure as any).employeeName || (selectedClosure as any).createdByEmail)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase font-bold">Empleada que recibe</span>
                    <span className="font-bold text-white block">
                      {getEmployeeFullName(selectedClosure.empleadoRecibe || (selectedClosure as any).handedTo || (selectedClosure as any).receiverEmployeeName)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Financial breakdown */}
              <div className="bg-slate-950/65 border border-slate-800 p-3.5 rounded-2xl space-y-2.5">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Arqueo Financiero</span>
                <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                  <div className="border-b border-slate-800/50 pb-1.5">
                    <span className="text-slate-500 block text-[9px] uppercase font-bold">Caja Base Inicial</span>
                    <span className="font-bold text-slate-300 font-mono">{formatCop(selectedClosure.baseInicial || 0)}</span>
                  </div>
                  <div className="border-b border-slate-800/50 pb-1.5">
                    <span className="text-slate-500 block text-[9px] uppercase font-bold">Ventas Totales</span>
                    <span className="font-extrabold text-emerald-400 font-mono">{formatCop(selectedClosure.totalVentas !== undefined ? selectedClosure.totalVentas : ((selectedClosure as any).totalSales || 0))}</span>
                  </div>
                  <div className="border-b border-slate-800/50 pb-1.5">
                    <span className="text-slate-500 block text-[9px] uppercase font-bold">Ventas Efectivo</span>
                    <span className="font-semibold text-emerald-500/85 font-mono">{formatCop(selectedClosure.ventasEfectivo !== undefined ? selectedClosure.ventasEfectivo : ((selectedClosure as any).totalCash || 0))}</span>
                  </div>
                  <div className="border-b border-slate-800/50 pb-1.5">
                    <span className="text-slate-500 block text-[9px] uppercase font-bold">Ventas Transferencia</span>
                    <span className="font-semibold text-indigo-400 font-mono">{formatCop(selectedClosure.ventasTransferencia !== undefined ? selectedClosure.ventasTransferencia : ((selectedClosure as any).totalTransfer || 0))}</span>
                  </div>
                  <div className="border-b border-slate-800/50 pb-1.5">
                    <span className="text-slate-500 block text-[9px] uppercase font-bold">Gastos Efectivo</span>
                    <span className="font-bold text-red-400 font-mono">{formatCop(selectedClosure.gastosEfectivo !== undefined ? selectedClosure.gastosEfectivo : 0)}</span>
                  </div>
                  <div className="border-b border-slate-800/50 pb-1.5">
                    <span className="text-slate-500 block text-[9px] uppercase font-bold">Pago Nómina</span>
                    <span className="font-bold text-amber-400 font-mono">{formatCop(selectedClosure.nomina !== undefined ? selectedClosure.nomina : ((selectedClosure as any).payrollAmount || 0))}</span>
                  </div>
                </div>
              </div>


              {/* Liquidación de pago y caja dejada */}
              <div className="bg-emerald-500/5 border border-emerald-500/20 p-3.5 rounded-2xl space-y-2.5">
                <span className="text-[9px] font-black text-emerald-300 uppercase tracking-widest block mb-0.5">Liquidación del Turno</span>
                <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-[11px]">
                  <div><span className="text-slate-500 block uppercase font-bold">Caja antes de pago</span><strong className="text-slate-200 font-mono">{formatCop((selectedClosure as any).cajaAntesDePago ?? ((selectedClosure.baseInicial || 0) + (selectedClosure.ventasEfectivo || 0) - (selectedClosure.gastosEfectivo || 0)))}</strong></div>
                  <div><span className="text-slate-500 block uppercase font-bold">Pago base</span><strong className="text-amber-300 font-mono">{formatCop((selectedClosure as any).pagoBaseTurno ?? 0)}</strong></div>
                  <div><span className="text-slate-500 block uppercase font-bold">Comisión productos</span><strong className="text-emerald-400 font-mono">+{formatCop((selectedClosure as any).comisionProductos ?? 0)}</strong></div>
                  <div><span className="text-slate-500 block uppercase font-bold">Descuento inventario</span><strong className="text-red-400 font-mono">-{formatCop((selectedClosure as any).descuentoInventario ?? 0)}</strong></div>
                  <div><span className="text-slate-500 block uppercase font-bold">Pago autorizado retirado</span><strong className="text-white font-mono">{formatCop((selectedClosure as any).pagoAutorizadoRetirado ?? selectedClosure.nomina ?? 0)}</strong></div>
                  <div><span className="text-slate-500 block uppercase font-bold">Caja que debía quedar</span><strong className="text-emerald-300 font-mono">{formatCop((selectedClosure as any).cajaQueDebeQuedar ?? selectedClosure.totalEsperadoEfectivo ?? 0)}</strong></div>
                </div>
              </div>

              {/* Consolidated Caja results */}
              <div className="bg-slate-950/65 border border-slate-800 p-3.5 rounded-2xl space-y-2">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Resultados de Caja</span>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-slate-900 border border-slate-800 p-2 rounded-xl">
                    <span className="text-slate-500 block text-[8px] uppercase font-bold">Debe Quedar</span>
                    <span className="font-black text-slate-300 font-mono">{formatCop(selectedClosure.totalEsperadoEfectivo !== undefined ? selectedClosure.totalEsperadoEfectivo : ((selectedClosure as any).expectedCash || 0))}</span>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-2 rounded-xl">
                    <span className="text-slate-500 block text-[8px] uppercase font-bold">Dejó en Caja</span>
                    <span className="font-black text-white font-mono">{formatCop(selectedClosure.dineroFisicoContado !== undefined ? selectedClosure.dineroFisicoContado : ((selectedClosure as any).physicalCash || 0))}</span>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-2 rounded-xl">
                    <span className="text-slate-500 block text-[8px] uppercase font-bold">Diferencia</span>
                    <span className={`font-black font-mono ${(selectedClosure.diferenciaCaja !== undefined ? selectedClosure.diferenciaCaja : ((selectedClosure as any).cashDifference || 0)) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {(selectedClosure.diferenciaCaja !== undefined ? selectedClosure.diferenciaCaja : ((selectedClosure as any).cashDifference || 0)) >= 0 ? '+' : ''}
                      {formatCop(selectedClosure.diferenciaCaja !== undefined ? selectedClosure.diferenciaCaja : ((selectedClosure as any).cashDifference || 0))}
                    </span>
                  </div>
                </div>
              </div>

              {/* Operational breakdown: rooms, products and expenses */}
              <div className="bg-slate-950/65 border border-slate-800 p-3.5 rounded-2xl space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Desglose del Turno</span>
                  <span className="text-[8px] text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full uppercase font-bold">
                    {selectedClosureBreakdown.source === 'cierre' ? 'Guardado en cierre' : 'Reconstruido por turno'}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-slate-900 border border-slate-800 p-2 rounded-xl">
                    <span className="text-slate-500 block text-[8px] uppercase font-bold">Usos Hab.</span>
                    <span className="font-black text-emerald-400 font-mono">{selectedClosureBreakdown.habitacionesUsadas}</span>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-2 rounded-xl">
                    <span className="text-slate-500 block text-[8px] uppercase font-bold">Hab. Distintas</span>
                    <span className="font-black text-cyan-300 font-mono">{selectedClosureBreakdown.habitacionesDistintas}</span>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-2 rounded-xl">
                    <span className="text-slate-500 block text-[8px] uppercase font-bold">Prod. Vendidos</span>
                    <span className="font-black text-amber-300 font-mono">{selectedClosureBreakdown.productosCantidad}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="bg-slate-900/55 border border-slate-800 rounded-xl p-2">
                    <span className="text-slate-500 uppercase font-bold block">Hospedajes</span>
                    <span className="text-emerald-400 font-black font-mono">{formatCop(selectedClosureBreakdown.totalHabitaciones)}</span>
                  </div>
                  <div className="bg-slate-900/55 border border-slate-800 rounded-xl p-2">
                    <span className="text-slate-500 uppercase font-bold block">Productos</span>
                    <span className="text-amber-300 font-black font-mono">{formatCop(selectedClosureBreakdown.totalProductos)}</span>
                  </div>
                  <div className="bg-slate-900/55 border border-slate-800 rounded-xl p-2">
                    <span className="text-slate-500 uppercase font-bold block">Reservas / Abonos</span>
                    <span className="text-indigo-300 font-black font-mono">{formatCop(selectedClosureBreakdown.totalReservas)}</span>
                  </div>
                  <div className="bg-slate-900/55 border border-slate-800 rounded-xl p-2">
                    <span className="text-slate-500 uppercase font-bold block">Gastos</span>
                    <span className="text-rose-300 font-black font-mono">{formatCop(selectedClosureBreakdown.totalGastos)}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-slate-400 uppercase font-black tracking-wider">Habitaciones utilizadas</span>
                    <span className="text-[9px] text-slate-500">{selectedClosureBreakdown.habitaciones.length} registros</span>
                  </div>

                  {selectedClosureBreakdown.habitaciones.length === 0 ? (
                    <p className="text-[10px] text-slate-500 italic bg-slate-900/40 border border-slate-800 rounded-xl p-2">
                      Este cierre no tiene hospedajes detallados guardados. Si es un cierre antiguo, solo conservará los totales.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {selectedClosureBreakdown.habitaciones.map((item, idx) => (
                        <div key={item.id || idx} className="bg-slate-900/55 border border-slate-800 rounded-xl p-2.5 space-y-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <span className="font-black text-white block truncate">{item.habitacionNombre || item.concepto || 'Habitación'}</span>
                              <span className="text-[9px] text-slate-400 block truncate">{item.clienteNombre || 'Cliente sin nombre'}{item.clienteCedula ? ` • C.C. ${item.clienteCedula}` : ''}</span>
                            </div>
                            <span className="text-emerald-400 font-black font-mono shrink-0">{formatCop(item.total)}</span>
                          </div>
                          <div className="flex items-center justify-between text-[9px] text-slate-500">
                            <span>{item.hora || 'Sin hora'} • {item.metodoPago || 'N/A'}</span>
                            <span>{item.numeroPersonas ? `${item.numeroPersonas} pers.` : item.acompanantes?.length ? `${item.acompanantes.length + 1} pers.` : '1 pers.'}</span>
                          </div>
                          {item.acompanantes && item.acompanantes.length > 0 && (
                            <div className="text-[9px] text-slate-400 bg-slate-950/50 border border-slate-800 rounded-lg p-1.5">
                              <span className="font-bold text-slate-300">Acompañantes: </span>
                              {item.acompanantes.map((a: any) => a.nombre || a.cedula || 'Sin nombre').join(', ')}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {selectedClosureBreakdown.productos.length > 0 && (
                  <div className="space-y-2 pt-1 border-t border-slate-800/60">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-slate-400 uppercase font-black tracking-wider">Productos vendidos</span>
                      <span className="text-[9px] text-slate-500">{selectedClosureBreakdown.productos.length} movimientos</span>
                    </div>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {selectedClosureBreakdown.productos.map((item, idx) => (
                        <div key={item.id || idx} className="bg-slate-900/45 border border-slate-800 rounded-xl p-2 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="text-white font-bold block truncate">{item.productoNombre || item.concepto || 'Producto'}</span>
                            <span className="text-[9px] text-slate-500">{item.hora || 'Sin hora'} • Cant: {item.cantidad || 1} • {item.metodoPago}</span>
                          </div>
                          <span className="font-black text-amber-300 font-mono shrink-0">{formatCop(item.total)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedClosureBreakdown.gastos.length > 0 && (
                  <div className="space-y-2 pt-1 border-t border-slate-800/60">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-slate-400 uppercase font-black tracking-wider">Gastos registrados</span>
                      <span className="text-[9px] text-slate-500">{selectedClosureBreakdown.gastos.length} gastos</span>
                    </div>
                    <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                      {selectedClosureBreakdown.gastos.map((item, idx) => (
                        <div key={item.id || idx} className="bg-slate-900/45 border border-slate-800 rounded-xl p-2 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="text-white font-bold block truncate">{item.concepto}</span>
                            <span className="text-[9px] text-slate-500">{item.hora || 'Sin hora'} • {item.categoria} • {item.metodoPago}</span>
                          </div>
                          <span className="font-black text-rose-300 font-mono shrink-0">-{formatCop(item.valor)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Physical Inventory counts inside closure */}
              {selectedClosure.inventarioConteo && selectedClosure.inventarioConteo.length > 0 && (
                <div className="bg-slate-950/65 border border-slate-800 p-3.5 rounded-2xl space-y-2">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Novedades de Inventario</span>
                  <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                    {selectedClosure.inventarioConteo.map((item, idx) => {
                      const diff = item.conteoFisico - item.stockSistema;
                      return (
                        <div key={idx} className="bg-slate-900/50 p-2 rounded-xl border border-slate-800/45 flex justify-between items-center text-[11px]">
                          <div className="space-y-0.5 max-w-[65%]">
                            <span className="font-bold text-white block truncate">{item.nombre}</span>
                            <span className="text-[9px] text-slate-500 italic block">Obs: {item.observacion || 'Conteo conforme.'}</span>
                          </div>
                          <div className="text-right flex items-center gap-2">
                            <div className="text-[10px] text-slate-400">
                              <span>Sis: <b>{item.stockSistema}</b></span> • <span>Fís: <b>{item.conteoFisico}</b></span>
                            </div>
                            <span className={`px-1.5 py-0.5 rounded font-mono font-black text-[10px] ${
                              diff === 0 
                                ? 'bg-emerald-500/10 text-emerald-400' 
                                : diff < 0 
                                ? 'bg-red-500/10 text-red-400' 
                                : 'bg-blue-500/10 text-blue-400'
                            }`}>
                              {diff > 0 ? `+${diff}` : diff}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* General observations */}
              <div className="bg-slate-950/65 border border-slate-800 p-3.5 rounded-2xl space-y-1">
                <span className="text-slate-500 block text-[9px] uppercase font-bold">Observaciones Generales de la Entrega</span>
                <p className="text-slate-300 italic">"{selectedClosure.observaciones || 'Cierre de turno realizado sin novedades.'}"</p>
              </div>

              {/* Metadata ID block */}
              <div className="text-[8px] text-slate-500 font-mono text-center">
                ID Cierre: {selectedClosure.id}
              </div>

            </div>

            {/* Footer */}
            <div className="p-4 bg-slate-950 border-t border-slate-800 rounded-b-3xl space-y-3">
              <button
                onClick={async () => {
                  const settings = getSettings();
                  let printWin: Window | null = null;
                  if (settings.printerType === 'browser') {
                    try {
                      printWin = openBrowserPrintWindow();
                      if (printWin) {
                        setBrowserPrintWindow(printWin);
                      }
                    } catch (e) {
                      console.warn("Fallo al pre-abrir ventana para reimprimir:", e);
                    }
                  }
                  
                  try {
                    await printShiftClosureReceipt(selectedClosure, printWin);
                    alert("Comprobante enviado a la cola de impresión.");
                  } catch (err: any) {
                    console.error("Error al reimprimir comprobante:", err);
                    if (printWin) {
                      printWin.close();
                      setBrowserPrintWindow(null);
                    }
                    alert("No se pudo imprimir el comprobante: " + (err.message || String(err)));
                  }
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl transition-colors text-xs"
              >
                <Printer className="h-4 w-4" />
                <span>Reimprimir comprobante de cierre</span>
              </button>

              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 pt-1">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                Rol Propietario / Visor (Sólo Lectura)
              </p>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}