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
  { key: "papas", id: "prod-papas", nombre: "PAPAS RIZADAS", stock: 4, stockMinimo: 3, categoria: "Snacks", precioSugerido: 4000, aliases: ["PAPAS RIZADAS","PAPAS","PAPA RIZADA","PAPAS MARGARITA"] },
  { key: "galletas_festival", id: "prod-galletas-festival", nombre: "GALLETAS FESTIVAL", stock: 6, stockMinimo: 3, categoria: "Snacks", precioSugerido: 2000, aliases: ["FESTIVAL","GALLETA FESTIVAL","GALLETAS FESTIVAL"] },
  { key: "galletas_wafer", id: "prod-galletas-wafer", nombre: "GALLETAS WAFER", stock: 9, stockMinimo: 0, categoria: "Snacks", precioSugerido: 0, aliases: ["GALLETA WAFER","GALLETAS WAFER","WAFER"] },
  { key: "doritos", id: "prod-doritos", nombre: "DORITOS", stock: 4, stockMinimo: 3, categoria: "Snacks", precioSugerido: 4000, aliases: ["DORITO","DORITOS"] },
  { key: "de_toditos", id: "prod-de-toditos", nombre: "DE TODITOS", stock: 5, stockMinimo: 0, categoria: "Snacks", precioSugerido: 0, aliases: ["DE TODITOS","DETODITOS"] },
  { key: "trident", id: "prod-trident", nombre: "TRIDENT", stock: 3, stockMinimo: 0, categoria: "Snacks", precioSugerido: 0, aliases: ["TRIDENT","CHICLE TRIDENT"] },
  { key: "galletas_minichip", id: "prod-galletas-minichip", nombre: "GALLETAS MINICHIP", stock: 9, stockMinimo: 0, categoria: "Snacks", precioSugerido: 0, aliases: ["GALLETAS MINICHIP","GALLETA MINICHIP","MINICHIPS","GALLETAS MINI CHIP"] },
  { key: "champu", id: "prod-champu", nombre: "CHAMPÚ", stock: 1, stockMinimo: 0, categoria: "Aseo", precioSugerido: 0, aliases: ["CHAMPU","SHAMPOO","SHAMPO","CHAMPÚ"] },
  { key: "crema_peinar", id: "prod-crema-peinar", nombre: "CREMA PARA PEINAR", stock: 10, stockMinimo: 0, categoria: "Aseo", precioSugerido: 0, aliases: ["CREMA PEINAR","CREMA PARA PEINAR"] },
  { key: "desodorante", id: "prod-desodorante", nombre: "DESODORANTE", stock: 5, stockMinimo: 0, categoria: "Aseo", precioSugerido: 0, aliases: ["DESODORANTE","DESODORANTES"] },
  { key: "cigarrillo_unidad", id: "prod-cigarrillo-unidad", nombre: "CIGARRILLO UNIDAD", stock: 49, stockMinimo: 0, categoria: "Otros", precioSugerido: 0, aliases: ["CIGARRILLO UNIDAD","CIGARRILLO UNI","CIGARRILLO SUELTO","CIGARRILLOS UNIDAD"] },
  { key: "cigarrillo_paquete", id: "prod-cigarrillo-paquete", nombre: "CIGARRILLO PAQUETE", stock: 5, stockMinimo: 0, categoria: "Otros", precioSugerido: 0, aliases: ["CIGARRILLO PAQUETE","CIGARRILLO PAQ","CIGARRILLO PQT","CAJETILLA CIGARRILLOS","PAQUETE CIGARRILLOS"] },
  { key: "crema_dental", id: "prod-crema-dental", nombre: "CREMA DENTAL", stock: 2, stockMinimo: 0, categoria: "Aseo", precioSugerido: 0, aliases: ["CREMA DENTAL","PASTA DENTAL"] },
  { key: "prestobarba", id: "prod-prestobarba", nombre: "PRESTOBARBA", stock: 9, stockMinimo: 0, categoria: "Aseo", precioSugerido: 0, aliases: ["PRESTOBARBA","PRESTO BARBA","MAQUINA DE AFEITAR"] },
  { key: "condones", id: "prod-condones", nombre: "CONDONES", stock: 13, stockMinimo: 0, categoria: "Aseo", precioSugerido: 0, aliases: ["CONDONES","PRESERVATIVOS","CONDON"] },
  { key: "speedmax", id: "prod-speedmax", nombre: "SPEEDMAX", stock: 5, stockMinimo: 3, categoria: "Bebidas", precioSugerido: 4000, aliases: ["SPEEDMAX","SPEED MAX","SPINAX","SPINMAX","SPEED"] },
  { key: "jugo_del_valle", id: "prod-jugo-del-valle", nombre: "JUGO DEL VALLE", stock: 4, stockMinimo: 3, categoria: "Bebidas", precioSugerido: 4000, aliases: ["JUGO DEL VALLE","JUGOS DEL VALLE","JUGO DEL VALLE PET 400","DEL VALLE","JUGO VALLE"] },
  { key: "coca_cola", id: "prod-coca-cola", nombre: "COCA-COLA", stock: 16, stockMinimo: 3, categoria: "Bebidas", precioSugerido: 4000, aliases: ["COCA-COLA","COCA COLA","COCACOLA","COKE","COCA COLA PET 400"] },
  { key: "agua_natural", id: "prod-agua-natural", nombre: "AGUA NATURAL", stock: 15, stockMinimo: 2, categoria: "Bebidas", precioSugerido: 3000, aliases: ["AGUA","AGUAS","AGUA NATURAL","AGUA SIN GAS","AGUA PURIFICADA","BOTELLA DE AGUA"] },
  { key: "agua_con_gas", id: "prod-agua-con-gas", nombre: "AGUA CON GAS", stock: 13, stockMinimo: 0, categoria: "Bebidas", precioSugerido: 0, aliases: ["AGUA CON GAS","AGUA GASIFICADA","AGUA GAS"] },
  { key: "power", id: "prod-power", nombre: "POWER", stock: 5, stockMinimo: 2, categoria: "Bebidas", precioSugerido: 5000, aliases: ["POWER","POWER PET 400","POWER PET 400 ML","POWERADE","POWER ADE"] },
  { key: "quatro", id: "prod-quatro", nombre: "QUATRO", stock: 7, stockMinimo: 3, categoria: "Bebidas", precioSugerido: 4000, aliases: ["QUATRO","CUATRO","QUATRO PET 400","CUATRO PET 400"] },
  { key: "cerveza", id: "prod-cerveza", nombre: "CERVEZA", stock: 33, stockMinimo: 0, categoria: "Bebidas", precioSugerido: 0, aliases: ["CERVEZA","CERVEZAS"] },
  { key: "jugo_hit", id: "prod-jugo-hit", nombre: "JUGO HIT", stock: 9, stockMinimo: 3, categoria: "Bebidas", precioSugerido: 4000, aliases: ["JUGO HIT","HIT","JUGOS HIT","HIT PET"] },
  { key: "gatorade", id: "prod-gatorade", nombre: "GATORADE", stock: 12, stockMinimo: 0, categoria: "Bebidas", precioSugerido: 0, aliases: ["GATORADE","GATORADE PET"] },
  { key: "refajo", id: "prod-refajo", nombre: "REFAJO", stock: 0, stockMinimo: 2, categoria: "Bebidas", precioSugerido: 4000, aliases: ["REFAJO","REFAJO PET 400","REFAJO COLOMBIANA"] },
  { key: "agua_saborizada", id: "prod-agua-saborizada", nombre: "AGUA SABORIZADA", stock: 0, stockMinimo: 0, categoria: "Bebidas", precioSugerido: 0, aliases: ["AGUA SABORIZADA","AGUA DE SABORES","AGUA SABORISADA"] }
];

/** Inventario físico de referencia: 31-10-2026; no sobreescribir movimientos posteriores. */
export const OFFICIAL_ACTIVE_PRODUCT_NAMES = OFFICIAL_KODIAK_PRODUCTS.map((product) => product.nombre);

export function normalizeProductName(name: any): string {
  return String(name || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/\s+/g, ' '); // collapse multiple spaces
}

/** Normalización por alias exacto: evita mezclar AGUA SABORIZADA/NATURAL,
 * AGUA CON GAS, REFAJO/CERVEZA, y CIGARRILLOS UNIDAD/PAQUETE. */
export function getCanonicalProductName(rawName: any): string {
  const norm = normalizeProductName(rawName).replace(/[.,_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!norm) return '';
  for (const product of OFFICIAL_KODIAK_PRODUCTS) {
    if ([product.nombre, ...product.aliases].some((name) =>
      normalizeProductName(name).replace(/[.,_-]+/g, ' ').replace(/\s+/g, ' ').trim() === norm
    )) return product.nombre;
  }
  return normalizeProductName(rawName);
}

export function matchOfficialProduct(productName: string): OfficialProductDefinition | null {
  const canonical = getCanonicalProductName(productName);
  return OFFICIAL_KODIAK_PRODUCTS.find((product) => product.nombre === canonical) || null;
}

/** Copia inicial únicamente si falta el catálogo remoto.
 * Los stocks de esta referencia son los contados el 31-10-2026. */
export const INITIAL_PRODUCTS_DATA: Product[] = OFFICIAL_KODIAK_PRODUCTS
  // No crear entradas con precio artificial $0 en el modo local.
  // Las referencias con precio previo desconocido se recuperan de Firestore.
  .filter((product) => product.precioSugerido > 0)
  .map((product) => ({
  id: product.id,
  nombre: product.nombre,
  categoria: product.categoria,
  precio: product.precioSugerido, // Precio original documentado; nunca sustituir tarifas en Firebase.
  stock: product.stock,
  stockMinimo: product.stockMinimo,
  estado: product.stock === 0 ? 'Agotado' :
    product.stock <= product.stockMinimo ? 'Bajo stock' : 'Disponible',
  activo: true,
  archivado: false,
  oculto: false,
  visible: true,
  eliminado: false,
  deleted: false,
  status: 'active',
  inventoryReferenceDate: '2026-10-31',
  createdAt: '2026-10-31T00:00:00-05:00',
  updatedAt: '2026-10-31T00:00:00-05:00'
} as Product));

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
