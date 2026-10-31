export type RoomStatus = 'disponible' | 'ocupada';
export type PaymentMethod = 'Efectivo' | 'Transferencia';
export type VehicleType = 'Moto' | 'Carro' | 'No tiene';
export type ReservationStatus = 'Pendiente' | 'Confirmada' | 'Cumplida' | 'Cancelada';

export interface CompanionGuest {
  id: string;
  nombre: string;
  cedula: string;
  celular?: string;
  parentesco?: string;
  observacion?: string;
  tarifaAdicional?: number;
}


export interface Room {
  id: string;
  nombre: string;
  estado: RoomStatus;
  concepto?: string;
  valorCobrado?: number;
  metodoPago?: PaymentMethod;
  horaIngreso?: string;
  fechaIngreso?: string;
  salidaProgramada?: string;
  tiempoRestante?: string;
  empleada?: string;
  cliente?: string; // Nombre del cliente
  vehiculo?: string; // Placa o descripción
  ventaId?: string;
  clienteDetails?: Client;
  acompanantes?: CompanionGuest[];
  numeroPersonas?: number;
  acompanantesTexto?: string;

  // Compatibility fields for release feature
  firestoreId?: string;
  documentId?: string;
  docId?: string;
  status?: string;
  isOccupied?: boolean;
  occupantName?: string;
  clientName?: string;
  clientId?: string;
  clientDocument?: string;
  clientPhone?: string;
  clientEmail?: string;
  vehiclePlate?: string;
  vehicleType?: string;
  checkInTime?: any;
  checkOutTime?: any;
  currentStayId?: string | null;
  currentSaleId?: string | null;
  occupied?: boolean;
  paymentStatus?: string;
  updatedAt?: any;
  updatedBy?: string;
  updatedByName?: string;
  observations?: string;
  expectedCheckOut?: any;
  camas?: number;
  capacidadMaxima?: number;
  servicioHabitacion?: 'Aire' | 'Ventilador';
  fueraServicio?: boolean;
  observacionesHabitacion?: string;
  tarifaTipo?: 'apartamento' | 'aire' | 'ventilador';
  tarifaBase?: number;
  cargoAcompanantes?: number;
  diasPagados?: number;
  nochesPagadas?: number;
  fechaSalidaProgramada?: string;
  checkoutDateTime?: string;
  descuentoEstadiaLarga?: number;
  subtotalSinDescuento?: number;
  totalConDescuento?: number;
}

export interface Client {
  id: string;
  nombre: string;
  cedula: string;
  celular: string;
  correo: string;
  direccion: string;
  esEmpresa: boolean;
  empresa?: string;
  nit?: string;
  empresaNombre?: string;
  empresaNit?: string;
  nitEmpresa?: string;
  tipoVehiculo: VehicleType;
  placa: string;
  marca: string;
  color: string;
  observacionVehiculo: string;
  visitas: number;
  tipoCliente?: 'principal' | 'acompanante';
  acompananteDe?: string;
  acompananteDeCedula?: string;
  acompanantes?: CompanionGuest[];
  numeroPersonas?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  nombre: string;
  categoria: string;
  precio: number;
  stock: number;
  stockMinimo: number;
  estado: 'Disponible' | 'Bajo stock' | 'Agotado' | 'Archivado' | 'Eliminado' | string;
  activo?: boolean;
  archivado?: boolean;
  oculto?: boolean;
  visible?: boolean;
  eliminado?: boolean;
  deleted?: boolean;
  isDeleted?: boolean;
  status?: string;
  desactivadoAt?: string;
  deletedAt?: string;
  desactivadoPor?: string;
  motivoDesactivacion?: string;
  lastMovementAt?: string;
  lastMovementType?: string;
  lastMovementBy?: string;
  createdAt: string;
  updatedAt: string;
  clientUpdatedAt?: string;
  // Control de migración del catálogo. Evita que productos recuperados una vez
  // vuelvan a ser revividos si el administrador los elimina explícitamente en el futuro.
  catalogRecoveryVersion?: number;
  recoveredFromLegacyCatalog?: boolean;
  recoveredAt?: string;
  migrationPlaceholder?: boolean;
  recoveredStockFromLocal?: boolean;
}

export function isProductArchivedOrHidden(product: any): boolean {
  if (!product) return true;

  const estadoStr = String(product?.estado || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const statusStr = String(product?.status || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  return (
    product?.activo === false ||
    product?.archivado === true ||
    product?.oculto === true ||
    product?.visible === false ||
    product?.eliminado === true ||
    product?.deleted === true ||
    product?.isDeleted === true ||
    statusStr === 'archived' ||
    statusStr === 'deleted' ||
    statusStr === 'hidden' ||
    estadoStr.includes('archivado') ||
    estadoStr.includes('desactivado') ||
    estadoStr.includes('eliminado') ||
    estadoStr.includes('oculto')
  );
}

export function isProductVisible(product: any): boolean {
  return !isProductArchivedOrHidden(product);
}

export interface Sale {
  id: string;
  shiftId: string;
  fecha: string;
  hora: string;
  createdAt: string;
  empleada: string;
  tipoVenta: 'producto' | 'habitacion' | 'reserva' | 'abono_reserva' | 'saldo_reserva' | 'liberacion_habitacion';
  concepto: string;
  total: number;
  metodoPago: PaymentMethod | 'N/A';
  efectivoRecibido?: number;
  cambioEntregado?: number;
  valorTransferido?: number;
  referenciaTransferencia?: string;
  productoId?: string;
  productoFirestoreId?: string;
  productoNombre?: string;
  cantidad?: number;
  habitacionId?: string;
  habitacionNombre?: string;
  reservaId?: string;
  clienteNombre?: string;
  clienteCedula?: string;
  acompanantes?: CompanionGuest[];
  numeroPersonas?: number;
  empresaNombre?: string;
  empresaNit?: string;
  facturarEmpresa?: boolean;
  facturarAEmpresa?: boolean;
  esEmpresa?: boolean;
  empresa?: string;
  nit?: string;
  nitEmpresa?: string;
  nitFacturacion?: string;
  nombreEmpresa?: string;
  razonSocial?: string;
  empresaFacturacion?: string;
  clientNit?: string;
  tarifaBase?: number;
  cargoAcompanantes?: number;
  pagoEmpresarial?: boolean;
  diasPagados?: number;
  nochesPagadas?: number;
  tarifaDiaria?: number;
  subtotalSinDescuento?: number;
  descuentoEstadiaLarga?: number;
  porcentajeDescuentoEstadia?: number;
  fechaSalidaProgramada?: string;
  salidaProgramada?: string;
  salidaProgramadaFecha?: string;
  checkoutDateTime?: string;

  // Compatibility fields for release movement
  type?: string;
  concept?: string;
  roomId?: string;
  roomName?: string;
  clientName?: string;
  employeeName?: string;
  createdBy?: string;

  // Stock movement fields
  tipoMovimiento?: string;
  productId?: string;
  productName?: string;
  cantidadAgregada?: number;
  quantityChange?: number;
  inventoryMovementType?: string;
  stockAnterior?: number;
  stockNuevo?: number;
  stockActual?: number;
  motivoInventario?: string;

  // Extra checkout fields
  observaciones?: string;
  horasAdicionales?: number;
  updatedAt?: string;
}

// Efectivo recibido o identificado en caja que NO corresponde a una venta.
// La base contable de todo turno sigue siendo $0.
export interface CashMovement {
  id: string;
  shiftId: string;
  tipo: 'entrada_efectivo_no_venta';
  monto: number;
  concepto: string;
  observacion: string;
  empleada: string;
  fecha: string;
  hora: string;
  createdAt: string;
  createdBy?: string;
}

export interface Expense {
  id: string;
  shiftId: string;
  concepto: string;
  categoria: string;
  metodoPago: PaymentMethod;
  valor: number;
  empleada: string;
  observacion: string;
  fecha: string;
  hora: string;
  createdAt: string;

  // Additional schema fields requested by the user
  type?: string;
  tipoMovimiento?: string;
  afectaCaja?: boolean;
  imprimirComprobante?: boolean;
  abrirCaja?: boolean;
  turnoId?: string;
  createdBy?: string;
}

export interface Shift {
  id: string;
  empleada: string;
  baseInicial: number;
  fechaApertura: string;
  horaApertura: string;
  createdAt: string;
  estado: 'abierto' | 'cerrado';
  observaciones?: string;
  empleadaNombreCompleto?: string;
  empleadaFechaNacimiento?: string;

  // Encadenamiento de caja entre cierre anterior y apertura nueva.
  cierreAnteriorId?: string;
  cierreAnteriorShiftId?: string;
  cierreAnteriorEmpleadoEntrega?: string;
  cierreAnteriorEmpleadoRecibe?: string;
  cierreAnteriorFechaCierre?: string;
  cierreAnteriorHoraCierre?: string;
  cierreAnteriorCajaQueDebiaQuedar?: number;
  cierreAnteriorDineroDejado?: number;
  baseSugeridaCierreAnterior?: number;
  baseConfirmadaApertura?: number;
  diferenciaBaseVsCierreAnterior?: number;
  aperturaConDiferencia?: boolean;
  observacionDiferenciaBase?: string;
}

export interface ProductInventoryClosure {
  productoId: string;
  nombre: string;
  categoria: string;
  stockSistema: number;
  conteoFisico: number;
  diferencia: number;
  observacion: string;
  contadoFisicamente?: boolean;
  precioUnitario?: number;
  faltante?: number;
  valorDescuento?: number;
}

export interface ShiftClosure {
  id: string;
  shiftId: string;
  empleadaEntrega: string;
  empleadoRecibe: string; // Alicia, Mileidys, Paola
  baseInicial: number;
  ventasEfectivo: number;
  entradasEfectivoNoVenta?: number;
  ventasTransferencia: number;
  totalVentas: number;
  gastosEfectivo: number;
  gastosTransferencia: number;
  nomina: number;
  pagoBaseTurno?: number;
  comisionProductos?: number;
  descuentoInventario?: number;
  pagoAutorizadoRetirado?: number;
  cajaAntesDePago?: number;
  cajaQueDebeQuedar?: number;
  dineroDejadoEnCaja?: number;
  diferenciaFinalCaja?: number;
  baseParaSiguienteTurno?: number;
  baseSugeridaSiguienteTurno?: number;
  nextShiftBase?: number;
  cierreDejaCajaParaProximoTurno?: boolean;
  totalEsperadoEfectivo: number;
  dineroFisicoContado: number;
  diferenciaCaja: number;
  inventarioConteo: ProductInventoryClosure[];
  observaciones: string;
  detalleVentas?: any[];
  detalleGastos?: any[];
  detalleEntradasEfectivoNoVenta?: CashMovement[];
  productosConDiferencia?: any[];
  faltantesInventario?: any[];
  movimientosTurno?: any[];
  resumenCierreExtendido?: any;
  fechaCierre: string;
  horaCierre: string;
  createdAt: string;
  empleadaEntregaNombreCompleto?: string;
  empleadaEntregaFechaNacimiento?: string;
  empleadaRecibeNombreCompleto?: string;
  empleadaRecibeFechaNacimiento?: string;
}

export interface Reservation {
  id: string;
  roomId: string;
  roomName: string;
  clientName: string;
  clientId: string; // Cédula or client DB ID
  clientPhone: string;
  clientEmail: string;
  clientDocument?: string; // Documento/Cédula
  checkInDate: string;
  checkInTime: string; // Formato 12H, ej: "03:30 PM"
  checkOutDate: string;
  checkOutTime: string; // Formato 12H
  status: ReservationStatus;
  observations: string;
  paymentStatus: 'Pendiente' | 'Abonado' | 'Pagado';
  amountPaid: number;
  balance: number;
  createdAt: string;
}

export interface SystemSettings {
  id: string;
  nombreHotel: string;
  nit: string;
  correoNotificaciones: string;
}

// Initial constants
export const INITIAL_ROOMS_DATA = [
  'Hab Apartamento',
  'Hab 301',
  'Hab 302',
  'Hab 303',
  'Hab 201',
  'Hab 101',
  'Hab 103',
  'Hab 104',
  'Hab 105',
  'Hab 106',
  'Hab 107',
  'Hab 108',
  'Hab 109',
  'Hab 110',
  'Hab 111',
  'Hab 202',
  'Hab 102'
];

export const OFFICIAL_ACTIVE_PRODUCT_NAMES = [
  "PAPAS",
  "DORITOS",
  "SPEEDMAX",
  "GALLETAS FESTIVAL",
  "JUGO HIT",
  "QUATRO",
  "REFAJO",
  "JUGO DEL VALLE",
  "AGUA NATURAL",
  "COCA-COLA",
  "POWER"
] as const;

export interface OfficialProductDefinition {
  key: string;
  id: string;
  nombre: string;
  stock: number;
  stockMinimo: number;
  categoria: string;
  precioSugerido: number;
  aliases: string[];
}

export const OFFICIAL_KODIAK_PRODUCTS: OfficialProductDefinition[] = [
  {
    key: 'jugo_del_valle',
    id: 'prod-jugo-del-valle',
    nombre: 'JUGO DEL VALLE',
    stock: 9,
    stockMinimo: 3,
    categoria: 'Bebidas',
    precioSugerido: 4000,
    aliases: ['JUGOS DEL VALLE', 'JUGO DEL VALLE', 'JUGO EL VALLE PET 400', 'JUGOS DEL VALLE PET 400', 'DEL VALLE', 'JUGO VALLE', 'JUGOS VALLE', 'VALLE']
  },
  {
    key: 'refajo',
    id: 'prod-refajo',
    nombre: 'REFAJO',
    stock: 11,
    stockMinimo: 2,
    categoria: 'Bebidas',
    precioSugerido: 4000,
    aliases: ['REFAJO', 'REFAJO PET 400', 'CERVEZA REFAJO', 'REFAJO COLOMBIANA', 'REFAJO 400ML']
  },
  {
    key: 'power',
    id: 'prod-power',
    nombre: 'POWER',
    stock: 14,
    stockMinimo: 2,
    categoria: 'Bebidas',
    precioSugerido: 5000,
    aliases: ['POWER', 'POWERADE', 'POWER ADE', 'BEBIDA POWER', 'POWERADE 500ML', 'POWER PET 400', 'POWER PET 400 ML']
  },
  {
    key: 'coca_cola',
    id: 'prod-coca-cola',
    nombre: 'COCA-COLA',
    stock: 12,
    stockMinimo: 3,
    categoria: 'Bebidas',
    precioSugerido: 4000,
    aliases: ['COCA COLA', 'COCACOLA', 'COCA-COLA PET 400', 'COCA-COLA', 'COKE', 'COCA-COLA 400ML', 'GASEOSA COCA COLA']
  },
  {
    key: 'jugo_hit',
    id: 'prod-jugo-hit',
    nombre: 'JUGO HIT',
    stock: 9,
    stockMinimo: 3,
    categoria: 'Bebidas',
    precioSugerido: 4000,
    aliases: ['JUGO HIT', 'HIT', 'JUGOS HIT', 'HIT PET']
  },
  {
    key: 'quatro',
    id: 'prod-quatro',
    nombre: 'QUATRO',
    stock: 12,
    stockMinimo: 3,
    categoria: 'Bebidas',
    precioSugerido: 4000,
    aliases: ['QUATRO', 'CUATRO', 'QUATRO PET 400', 'CUATRO PET 400', 'QUATRO 400ML', 'GASEOSA QUATRO']
  },
  {
    key: 'agua_natural',
    id: 'prod-agua-natural',
    nombre: 'AGUA NATURAL',
    stock: 22,
    stockMinimo: 2,
    categoria: 'Bebidas',
    precioSugerido: 3000,
    aliases: ['AGUA', 'AGUAS', 'AGUA NATURAL', 'AGUA SIN GAS', 'AGUA PURA', 'BOTELLA DE AGUA', 'AGUA MINERAL', 'AGUA PET 400']
  },
  {
    key: 'speedmax',
    id: 'prod-speedmax',
    nombre: 'SPEEDMAX',
    stock: 12,
    stockMinimo: 3,
    categoria: 'Bebidas',
    precioSugerido: 4000,
    aliases: ['SPEEDMAX', 'SPEED MAX', 'SPINAX', 'SPINMAX', 'SPEED', 'BEBIDA SPEEDMAX', 'ENERGIZANTE SPEEDMAX']
  },
  {
    key: 'doritos',
    id: 'prod-doritos',
    nombre: 'DORITOS',
    stock: 5,
    stockMinimo: 3,
    categoria: 'Snacks',
    precioSugerido: 4000,
    aliases: ['DORITOS', 'DORITO', 'DORITOS MEGA']
  },
  {
    key: 'papas_rizadas',
    id: 'prod-papas',
    nombre: 'PAPAS RIZADAS',
    stock: 10,
    stockMinimo: 3,
    categoria: 'Snacks',
    precioSugerido: 4000,
    aliases: ['PAPAS', 'PAPAS RIZADAS', 'PAPAS MARGARITA', 'PAPITAS', 'PAPAS FRITAS']
  },
  {
    key: 'galletas_festival',
    id: 'prod-galletas-festival',
    nombre: 'GALLETAS FESTIVAL',
    stock: 11,
    stockMinimo: 3,
    categoria: 'Snacks',
    precioSugerido: 2000,
    aliases: ['GALLETAS FESTIVAL', 'FESTIVAL', 'GALLETA FESTIVAL']
  }
];

export function normalizeProductName(name: any): string {
  return String(name || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/\s+/g, ' '); // collapse multiple spaces
}

export function getCanonicalProductName(rawName: any): string {
  const norm = normalizeProductName(rawName);
  if (!norm) return String(rawName || '').trim();

  if (norm === 'SPINAX' || norm === 'SPINMAX' || norm === 'SPEED MAX' || norm === 'SPEEDMAX' || norm.includes('SPINAX')) {
    return 'SPEEDMAX';
  }
  if (norm === 'AGUAS' || norm === 'AGUA NATURAL' || norm === 'AGUA PURIFICADA' || norm === 'AGUA' || (norm.includes('AGUA') && !norm.includes('GAS'))) {
    return 'AGUA NATURAL';
  }
  if (norm === 'COCACOLA' || norm === 'COCA COLA' || norm === 'COCA-COLA') {
    return 'COCA-COLA';
  }
  if (norm === 'QUATRO' || norm === 'QUATRO PET 400' || norm === 'CUATRO' || norm === 'CUATRO PET 400' || norm.startsWith('QUATRO')) {
    return 'QUATRO';
  }
  if (norm === 'JUGO DEL VALLE' || norm === 'JUGO DEL VALLE PET 400' || norm === 'DEL VALLE' || norm === 'DEL VALLE PET 400' || norm.startsWith('JUGO DEL VALLE')) {
    return 'JUGO DEL VALLE';
  }
  if (norm === 'POWER' || norm === 'POWER PET 400 ML' || norm === 'POWER PET 400' || norm.startsWith('POWER')) {
    return 'POWER';
  }
  if (norm === 'PAPAS' || norm === 'PAPAS RIZADAS' || norm.includes('PAPAS') || norm.includes('PAPITA')) {
    return 'PAPAS RIZADAS';
  }
  if (norm === 'FESTIVAL' || norm === 'GALLETAS FESTIVAL' || norm.includes('FESTIVAL')) {
    return 'GALLETAS FESTIVAL';
  }
  if (norm === 'DORITOS' || norm === 'DORITO' || norm.includes('DORITO')) {
    return 'DORITOS';
  }
  if (norm === 'JUGO HIT' || norm === 'HIT' || norm.includes('HIT')) {
    return 'JUGO HIT';
  }
  if (norm === 'REFAJO' || norm.includes('REFAJO')) {
    return 'REFAJO';
  }
  return String(rawName || '').trim();
}

export function matchOfficialProduct(productName: string): OfficialProductDefinition | null {
  const norm = normalizeProductName(productName);
  if (!norm) return null;

  // Cualquier referencia a SPINAX se empareja estrictamente con SPEEDMAX
  if (norm.includes('SPINAX') || norm.includes('SPEEDMAX') || norm.includes('SPEED MAX')) {
    return OFFICIAL_KODIAK_PRODUCTS.find(p => p.key === 'speedmax') || null;
  }

  for (const official of OFFICIAL_KODIAK_PRODUCTS) {
    const normOfficial = normalizeProductName(official.nombre);
    if (norm === normOfficial) return official;
    for (const alias of official.aliases) {
      if (norm === normalizeProductName(alias)) return official;
    }
  }

  // Emparejamiento semántico según reglas de equivalencia
  if (norm.includes('PAPAS') || norm.includes('PAPITA')) {
    return OFFICIAL_KODIAK_PRODUCTS.find(p => p.key === 'papas_rizadas') || null;
  }
  if (norm.includes('DORITO')) {
    return OFFICIAL_KODIAK_PRODUCTS.find(p => p.key === 'doritos') || null;
  }
  if (norm.includes('FESTIVAL')) {
    return OFFICIAL_KODIAK_PRODUCTS.find(p => p.key === 'galletas_festival') || null;
  }
  if (norm.includes('HIT')) {
    return OFFICIAL_KODIAK_PRODUCTS.find(p => p.key === 'jugo_hit') || null;
  }
  if (norm.includes('QUATRO') || norm.includes('CUATRO')) {
    return OFFICIAL_KODIAK_PRODUCTS.find(p => p.key === 'quatro') || null;
  }
  if (norm.includes('REFAJO')) {
    return OFFICIAL_KODIAK_PRODUCTS.find(p => p.key === 'refajo') || null;
  }
  if (norm.includes('VALLE')) {
    return OFFICIAL_KODIAK_PRODUCTS.find(p => p.key === 'jugo_del_valle') || null;
  }
  if (norm.includes('POWER')) {
    return OFFICIAL_KODIAK_PRODUCTS.find(p => p.key === 'power') || null;
  }
  if (norm.includes('COCA') || norm.includes('COKE')) {
    return OFFICIAL_KODIAK_PRODUCTS.find(p => p.key === 'coca_cola') || null;
  }
  if (norm.includes('NATURAL') || norm === 'AGUA' || (norm.includes('AGUA') && !norm.includes('GAS'))) {
    return OFFICIAL_KODIAK_PRODUCTS.find(p => p.key === 'agua_natural') || null;
  }

  return null;
}

export const INITIAL_PRODUCTS_DATA: Product[] = [
  {
    id: 'prod-jugo-del-valle',
    nombre: 'JUGO DEL VALLE',
    categoria: 'Bebidas',
    precio: 4000,
    stock: 9,
    stockMinimo: 3,
    estado: 'Disponible',
    activo: true,
    archivado: false,
    oculto: false,
    visible: true,
    eliminado: false,
    deleted: false,
    status: 'active',
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'prod-refajo',
    nombre: 'REFAJO',
    categoria: 'Bebidas',
    precio: 4000,
    stock: 11,
    stockMinimo: 2,
    estado: 'Disponible',
    activo: true,
    archivado: false,
    oculto: false,
    visible: true,
    eliminado: false,
    deleted: false,
    status: 'active',
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'prod-power',
    nombre: 'POWER',
    categoria: 'Bebidas',
    precio: 5000,
    stock: 14,
    stockMinimo: 2,
    estado: 'Disponible',
    activo: true,
    archivado: false,
    oculto: false,
    visible: true,
    eliminado: false,
    deleted: false,
    status: 'active',
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'prod-coca-cola',
    nombre: 'COCA-COLA',
    categoria: 'Bebidas',
    precio: 4000,
    stock: 12,
    stockMinimo: 3,
    estado: 'Disponible',
    activo: true,
    archivado: false,
    oculto: false,
    visible: true,
    eliminado: false,
    deleted: false,
    status: 'active',
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'prod-jugo-hit',
    nombre: 'JUGO HIT',
    categoria: 'Bebidas',
    precio: 4000,
    stock: 9,
    stockMinimo: 3,
    estado: 'Disponible',
    activo: true,
    archivado: false,
    oculto: false,
    visible: true,
    eliminado: false,
    deleted: false,
    status: 'active',
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'prod-quatro',
    nombre: 'QUATRO',
    categoria: 'Bebidas',
    precio: 4000,
    stock: 12,
    stockMinimo: 3,
    estado: 'Disponible',
    activo: true,
    archivado: false,
    oculto: false,
    visible: true,
    eliminado: false,
    deleted: false,
    status: 'active',
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'prod-agua-natural',
    nombre: 'AGUA NATURAL',
    categoria: 'Bebidas',
    precio: 3000,
    stock: 22,
    stockMinimo: 2,
    estado: 'Disponible',
    activo: true,
    archivado: false,
    oculto: false,
    visible: true,
    eliminado: false,
    deleted: false,
    status: 'active',
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'prod-speedmax',
    nombre: 'SPEEDMAX',
    categoria: 'Bebidas',
    precio: 4000,
    stock: 12,
    stockMinimo: 3,
    estado: 'Disponible',
    activo: true,
    archivado: false,
    oculto: false,
    visible: true,
    eliminado: false,
    deleted: false,
    status: 'active',
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'prod-doritos',
    nombre: 'DORITOS',
    categoria: 'Snacks',
    precio: 4000,
    stock: 5,
    stockMinimo: 3,
    estado: 'Disponible',
    activo: true,
    archivado: false,
    oculto: false,
    visible: true,
    eliminado: false,
    deleted: false,
    status: 'active',
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'prod-papas',
    nombre: 'PAPAS RIZADAS',
    categoria: 'Snacks',
    precio: 4000,
    stock: 10,
    stockMinimo: 3,
    estado: 'Disponible',
    activo: true,
    archivado: false,
    oculto: false,
    visible: true,
    eliminado: false,
    deleted: false,
    status: 'active',
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'prod-galletas-festival',
    nombre: 'GALLETAS FESTIVAL',
    categoria: 'Snacks',
    precio: 2000,
    stock: 11,
    stockMinimo: 3,
    estado: 'Disponible',
    activo: true,
    archivado: false,
    oculto: false,
    visible: true,
    eliminado: false,
    deleted: false,
    status: 'active',
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: new Date().toISOString()
  }
];

export interface EmployeeProfile {
  id: string;
  name: string;
  nombreCompleto: string;
  fechaNacimiento: string;
  fechaNacimientoTexto: string;
  rol: string;
  activo: boolean;
}

export const ALLOWED_EMPLOYEES: EmployeeProfile[] = [
  {
    id: 'ALICIA',
    name: 'ALICIA',
    nombreCompleto: 'Luz Alicia Serna Gómez',
    fechaNacimiento: '1987-06-24',
    fechaNacimientoTexto: '24 de junio de 1987',
    rol: 'recepcionista',
    activo: true
  },
  {
    id: 'MILEIDYS',
    name: 'MILEIDYS',
    nombreCompleto: 'María Mileydi Moreno',
    fechaNacimiento: '1985-12-20',
    fechaNacimientoTexto: '20 de diciembre de 1985',
    rol: 'recepcionista',
    activo: true
  },
  {
    id: 'PAOLA',
    name: 'PAOLA',
    nombreCompleto: 'Jenny Paola Lozano Alfonso',
    fechaNacimiento: '1996-08-13',
    fechaNacimientoTexto: '13 de agosto de 1996',
    rol: 'recepcionista',
    activo: true
  }
];

export function getEmployeeProfile(identifier: any): EmployeeProfile | null {
  if (!identifier || typeof identifier !== 'string') return null;
  const idLower = identifier.toLowerCase().trim();
  if (idLower.includes('alicia')) {
    return ALLOWED_EMPLOYEES[0];
  }
  if (idLower.includes('mileydis') || idLower.includes('mileydi')) {
    return ALLOWED_EMPLOYEES[1];
  }
  if (idLower.includes('paola')) {
    return ALLOWED_EMPLOYEES[2];
  }
  return null;
}

export function getEmployeeFullName(identifier: any): string {
  if (!identifier) return '';
  const profile = getEmployeeProfile(identifier);
  return profile ? profile.nombreCompleto : (typeof identifier === 'string' ? identifier : '');
}

export function getEmployeeBirthDate(identifier: any): string {
  if (!identifier) return '';
  const profile = getEmployeeProfile(identifier);
  return profile ? profile.fechaNacimientoTexto : '';
}

export type UserRole = 'admin' | 'recepcionista' | 'visor';

export interface FirebaseUser {
  uid: string;
  nombre: string;
  email: string;
  rol: UserRole;
  activo: boolean;
  createdAt: string;
  nombreCompleto?: string;
  fechaNacimiento?: string;
  fechaNacimientoTexto?: string;
}
