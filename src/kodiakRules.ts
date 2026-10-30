import { Product, ProductInventoryClosure, Sale, Expense, Room } from './types';

export type KodiakRoomService = 'Aire' | 'Ventilador';

export interface KodiakRoomCatalogItem {
  id: string;
  nombre: string;
  numero: string;
  camas: number;
  servicio: KodiakRoomService;
  capacidadMaxima: number;
  fueraServicio?: boolean;
  observacion?: string;
  tarifaTipo: 'apartamento' | 'aire' | 'ventilador';
}

export interface KodiakTariffOption {
  value: string;
  label: string;
  rate: number;
  usedBeds?: number;
  facturaElectronica?: boolean;
  kind: 'habitacion' | 'pareja' | 'rato';
}

export const KODIAK_COMPANION_FEE = 17000;
export const KODIAK_COUPLE_RATE = 70000;
export const KODIAK_COUPLE_RATE_VENTILADOR = 54000;
export const KODIAK_PRODUCT_COMMISSION_RATE = 0.10;

export const KODIAK_RATES = {
  // Tarifas oficiales por USO DE CAMAS, no por camas físicas de la habitación.
  // Ejemplo: una habitación de 3 camas puede cobrar uso de 1, 2 o 3 camas.
  aire: 52000,
  aire1: 52000,
  aire2: 82000,
  aire3: 112000,
  aire1Factura: 70000,
  aire2Factura: 110000,
  aire3Factura: 150000,
  aireSinTv: 47000,
  aireSinTvFactura: 60000,
  ventilador: 37000,
  ventiladorFactura: 50000,
  rato3h: 35000,
  pareja: KODIAK_COUPLE_RATE,
  parejaVentilador: KODIAK_COUPLE_RATE_VENTILADOR,
  apartamento: 82000,
  acompananteAdicional: KODIAK_COMPANION_FEE
};

// Regla HOTEL KODIAK: 1 cama = 2 personas, 2 camas = 4 personas, 3 camas = 6 personas.
export const KODIAK_OFFICIAL_ROOMS: KodiakRoomCatalogItem[] = [
  { id: 'room-apt', nombre: 'Hab Apartamento', numero: 'Apartamento', camas: 2, servicio: 'Aire', capacidadMaxima: 4, tarifaTipo: 'apartamento' },
  { id: 'room-301', nombre: 'Hab 301', numero: '301', camas: 1, servicio: 'Aire', capacidadMaxima: 2, tarifaTipo: 'aire' },
  { id: 'room-302', nombre: 'Hab 302', numero: '302', camas: 1, servicio: 'Aire', capacidadMaxima: 2, tarifaTipo: 'aire' },
  { id: 'room-303', nombre: 'Hab 303', numero: '303', camas: 2, servicio: 'Aire', capacidadMaxima: 4, tarifaTipo: 'aire' },
  { id: 'room-201', nombre: 'Hab 201', numero: '201', camas: 1, servicio: 'Aire', capacidadMaxima: 2, tarifaTipo: 'aire' },
  { id: 'room-101', nombre: 'Hab 101', numero: '101', camas: 1, servicio: 'Aire', capacidadMaxima: 2, tarifaTipo: 'aire', observacion: 'Sin televisor' },
  { id: 'room-103', nombre: 'Hab 103', numero: '103', camas: 2, servicio: 'Aire', capacidadMaxima: 4, tarifaTipo: 'aire' },
  { id: 'room-104', nombre: 'Hab 104', numero: '104', camas: 2, servicio: 'Aire', capacidadMaxima: 4, tarifaTipo: 'aire' },
  { id: 'room-105', nombre: 'Hab 105', numero: '105', camas: 1, servicio: 'Aire', capacidadMaxima: 2, tarifaTipo: 'aire' },
  { id: 'room-106', nombre: 'Hab 106', numero: '106', camas: 3, servicio: 'Aire', capacidadMaxima: 6, tarifaTipo: 'aire' },
  { id: 'room-107', nombre: 'Hab 107', numero: '107', camas: 1, servicio: 'Aire', capacidadMaxima: 2, tarifaTipo: 'aire' },
  { id: 'room-108', nombre: 'Hab 108', numero: '108', camas: 0, servicio: 'Aire', capacidadMaxima: 0, tarifaTipo: 'aire', fueraServicio: true, observacion: 'No está en uso' },
  { id: 'room-109', nombre: 'Hab 109', numero: '109', camas: 1, servicio: 'Aire', capacidadMaxima: 2, tarifaTipo: 'aire' },
  { id: 'room-110', nombre: 'Hab 110', numero: '110', camas: 1, servicio: 'Aire', capacidadMaxima: 2, tarifaTipo: 'aire' },
  { id: 'room-111', nombre: 'Hab 111', numero: '111', camas: 3, servicio: 'Aire', capacidadMaxima: 6, tarifaTipo: 'aire' },
  { id: 'room-202', nombre: 'Hab 202', numero: '202', camas: 1, servicio: 'Ventilador', capacidadMaxima: 2, tarifaTipo: 'ventilador' },
  { id: 'room-102', nombre: 'Hab 102', numero: '102', camas: 1, servicio: 'Ventilador', capacidadMaxima: 2, tarifaTipo: 'ventilador' }
];

export function normalizeRoomKey(value: any): string {
  const raw = String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (raw.includes('apart')) return 'apartamento';
  const num = raw.match(/\d{3}/)?.[0] || raw.match(/\d+/)?.[0] || '';
  return num;
}

export function getOfficialRoomByAny(value: any): KodiakRoomCatalogItem | null {
  const key = normalizeRoomKey(typeof value === 'object' ? (value?.nombre || value?.id || value?.roomName) : value);
  return KODIAK_OFFICIAL_ROOMS.find((room) => room.numero.toLowerCase() === key || normalizeRoomKey(room.nombre) === key || normalizeRoomKey(room.id) === key) || null;
}

export function hydrateOfficialRoom(room: Partial<Room> | null | undefined, fallback?: KodiakRoomCatalogItem): Room {
  const official = fallback || getOfficialRoomByAny(room) || KODIAK_OFFICIAL_ROOMS[0];
  const merged: any = {
    ...(room || {}),
    id: official.id,
    nombre: official.nombre,
    camas: official.camas,
    servicioHabitacion: official.servicio,
    capacidadMaxima: official.capacidadMaxima,
    fueraServicio: !!official.fueraServicio,
    observacionesHabitacion: official.observacion || (room as any)?.observacionesHabitacion || '',
    tarifaTipo: official.tarifaTipo,
    estado: official.fueraServicio ? 'disponible' : ((room as any)?.estado || 'disponible')
  };
  if (official.fueraServicio) {
    merged.status = 'out_of_service';
    merged.isOccupied = false;
    merged.occupied = false;
    merged.hospedado = false;
  }
  return merged as Room;
}

export function buildOfficialRoomsFromExisting(existingRooms: Room[] = []): Room[] {
  const byKey = new Map<string, Room>();
  for (const room of existingRooms || []) {
    const official = getOfficialRoomByAny(room);
    if (!official) continue;
    const key = official.id;
    const current = byKey.get(key);
    const currentMs = getRecordMs(current);
    const candidateMs = getRecordMs(room);
    if (!current || candidateMs >= currentMs) {
      byKey.set(key, hydrateOfficialRoom(room, official));
    }
  }
  return KODIAK_OFFICIAL_ROOMS.map((official) => hydrateOfficialRoom(byKey.get(official.id), official));
}

function getRecordMs(item: any): number {
  const candidates = [item?.clientUpdatedAt, item?.updatedAt, item?.lastSavedAt, item?.releasedAt, item?.createdAt];
  for (const value of candidates) {
    const ms = getDateMs(value);
    if (ms) return ms;
  }
  return 0;
}

function getDateMs(value: any): number {
  if (!value) return 0;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (typeof value === 'number') return value;
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  return 0;
}

export function normalizeKodiakText(value: any): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function formatCopRule(value: number): string {
  return `$${Number(value || 0).toLocaleString('es-CO')}`;
}

export function isCoupleConcept(concept?: any): boolean {
  return normalizeKodiakText(concept).includes('pareja');
}

export function isInvoiceConcept(concept?: any): boolean {
  const value = normalizeKodiakText(concept);
  if (value.includes('sin factura')) return false;
  return value.includes('con factura') || value.includes('factura electronica');
}

export function isRatoConcept(concept?: any): boolean {
  return normalizeKodiakText(concept).includes('rato');
}

export function isNoTvRoom(room: any): boolean {
  const official = getOfficialRoomByAny(room);
  const obs = normalizeKodiakText(`${official?.observacion || ''} ${room?.observacionesHabitacion || ''} ${room?.observacion || ''}`);
  return obs.includes('sin televisor') || obs.includes('sin tv') || normalizeRoomKey(room) === '101';
}

export function getUsedBedsFromConcept(concept?: any): number {
  const value = normalizeKodiakText(concept);
  const matchUso = value.match(/uso\s*(?:de\s*)?(\d+)\s*cama/);
  if (matchUso?.[1]) return Number(matchUso[1]);
  const matchCama = value.match(/(?:^|\s|-)\s*(\d+)\s*cama/);
  if (matchCama?.[1]) return Number(matchCama[1]);
  return 0;
}

export function canUseCoupleRate(room: any): boolean {
  const official = getOfficialRoomByAny(room);
  if (official?.fueraServicio) return false;
  return getRoomBeds(room) >= 1;
}

export function getCoupleRateForRoom(room: any): number {
  const official = getOfficialRoomByAny(room);
  const service = normalizeKodiakText(official?.servicio || room?.servicioHabitacion || room?.servicio || '');
  const tarifaTipo = normalizeKodiakText(official?.tarifaTipo || room?.tarifaTipo || '');

  // Se conserva la regla que ya venía aprobada: pareja en ventilador = $54.000.
  if (tarifaTipo === 'ventilador' || service.includes('ventilador')) {
    return KODIAK_RATES.parejaVentilador;
  }

  return KODIAK_RATES.pareja;
}

export function getRoomBeds(room: any): number {
  return getOfficialRoomByAny(room)?.camas || Number(room?.camas || 1);
}

export function getRoomCapacity(room: any): number {
  return getOfficialRoomByAny(room)?.capacidadMaxima || Number(room?.capacidadMaxima || 2);
}

export function getAirRateByUsedBeds(usedBeds: number, facturaElectronica: boolean = false): number {
  const beds = Math.min(3, Math.max(1, Number(usedBeds || 1)));
  if (facturaElectronica) {
    if (beds === 3) return KODIAK_RATES.aire3Factura;
    if (beds === 2) return KODIAK_RATES.aire2Factura;
    return KODIAK_RATES.aire1Factura;
  }
  if (beds === 3) return KODIAK_RATES.aire3;
  if (beds === 2) return KODIAK_RATES.aire2;
  return KODIAK_RATES.aire1;
}

export function getBaseRateForRoom(room: any, concept?: string): number {
  const official = getOfficialRoomByAny(room);
  const facturaElectronica = isInvoiceConcept(concept);
  const usedBedsFromConcept = getUsedBedsFromConcept(concept);

  if (isRatoConcept(concept)) return KODIAK_RATES.rato3h;
  if (isCoupleConcept(concept) && canUseCoupleRate(room)) return getCoupleRateForRoom(room);

  if (official?.tarifaTipo === 'ventilador') {
    return facturaElectronica ? KODIAK_RATES.ventiladorFactura : KODIAK_RATES.ventilador;
  }

  if (isNoTvRoom(room)) {
    return facturaElectronica ? KODIAK_RATES.aireSinTvFactura : KODIAK_RATES.aireSinTv;
  }

  // La tarifa se cobra por camas USADAS. Si el concepto no especifica uso,
  // se asume uso de 1 cama para no sobrecobrar.
  const usedBeds = usedBedsFromConcept || 1;
  return getAirRateByUsedBeds(usedBeds, facturaElectronica);
}

export function buildRoomTariffOptions(room: any): KodiakTariffOption[] {
  const official = getOfficialRoomByAny(room);
  if (official?.fueraServicio) return [];

  const options: KodiakTariffOption[] = [];
  const beds = Math.min(3, Math.max(0, Number(getRoomBeds(room) || 0)));
  const isVentilador = official?.tarifaTipo === 'ventilador' || normalizeKodiakText(official?.servicio || room?.servicioHabitacion).includes('ventilador');
  const noTv = isNoTvRoom(room);

  if (isVentilador) {
    options.push({
      value: 'Habitación con ventilador - sin factura',
      label: `Habitación ventilador · sin factura (${formatCopRule(KODIAK_RATES.ventilador)})`,
      rate: KODIAK_RATES.ventilador,
      usedBeds: 1,
      facturaElectronica: false,
      kind: 'habitacion'
    });
    options.push({
      value: 'Habitación con ventilador - con factura electrónica',
      label: `Habitación ventilador · con factura electrónica (${formatCopRule(KODIAK_RATES.ventiladorFactura)})`,
      rate: KODIAK_RATES.ventiladorFactura,
      usedBeds: 1,
      facturaElectronica: true,
      kind: 'habitacion'
    });
  } else if (noTv) {
    options.push({
      value: 'Habitación con aire sin TV - 1 cama - sin factura',
      label: `Habitación aire sin TV · 1 cama · sin factura (${formatCopRule(KODIAK_RATES.aireSinTv)})`,
      rate: KODIAK_RATES.aireSinTv,
      usedBeds: 1,
      facturaElectronica: false,
      kind: 'habitacion'
    });
    options.push({
      value: 'Habitación con aire sin TV - 1 cama - con factura electrónica',
      label: `Habitación aire sin TV · 1 cama · con factura electrónica (${formatCopRule(KODIAK_RATES.aireSinTvFactura)})`,
      rate: KODIAK_RATES.aireSinTvFactura,
      usedBeds: 1,
      facturaElectronica: true,
      kind: 'habitacion'
    });
  } else {
    for (let usedBeds = 1; usedBeds <= beds; usedBeds += 1) {
      const sinFactura = getAirRateByUsedBeds(usedBeds, false);
      const conFactura = getAirRateByUsedBeds(usedBeds, true);
      const camaText = usedBeds === 1 ? '1 cama' : `${usedBeds} camas`;
      options.push({
        value: `Habitación con aire - uso ${usedBeds} ${usedBeds === 1 ? 'cama' : 'camas'} - sin factura`,
        label: `Habitación aire · uso ${camaText} · sin factura (${formatCopRule(sinFactura)})`,
        rate: sinFactura,
        usedBeds,
        facturaElectronica: false,
        kind: 'habitacion'
      });
      options.push({
        value: `Habitación con aire - uso ${usedBeds} ${usedBeds === 1 ? 'cama' : 'camas'} - con factura electrónica`,
        label: `Habitación aire · uso ${camaText} · con factura electrónica (${formatCopRule(conFactura)})`,
        rate: conFactura,
        usedBeds,
        facturaElectronica: true,
        kind: 'habitacion'
      });
    }
  }

  if (canUseCoupleRate(room)) {
    const pareja = getCoupleRateForRoom(room);
    options.push({
      value: 'Pareja - incluye 1 acompañante',
      label: `Pareja · incluye 1 acompañante (${formatCopRule(pareja)})`,
      rate: pareja,
      usedBeds: 1,
      facturaElectronica: false,
      kind: 'pareja'
    });
  }

  options.push({
    value: 'Rato 3 horas',
    label: `Rato 3 horas (${formatCopRule(KODIAK_RATES.rato3h)})`,
    rate: KODIAK_RATES.rato3h,
    facturaElectronica: false,
    kind: 'rato'
  });

  return options;
}

export function getDefaultRoomConcept(room: any): string {
  return buildRoomTariffOptions(room)[0]?.value || 'Habitación con aire - uso 1 cama - sin factura';
}

export function calculateRoomCharge(room: any, companionCount: number, concept?: string): { baseRate: number; companionCharge: number; total: number } {
  const baseRate = getBaseRateForRoom(room, concept);

  // REGLA HOTEL KODIAK:
  // Tarifa "Pareja" incluye 1 acompañante sin cobrar adicional.
  // En las demás tarifas, cada acompañante cobra el adicional vigente.
  const acompanantesACobrar =
    isCoupleConcept(concept) && canUseCoupleRate(room)
      ? Math.max(0, Number(companionCount || 0) - 1)
      : Math.max(0, Number(companionCount || 0));

  const companionCharge = acompanantesACobrar * KODIAK_COMPANION_FEE;
  return { baseRate, companionCharge, total: baseRate + companionCharge };
}

export function calculateRoomStayCharge(
  room: any,
  companionCount: number,
  concept: string,
  dias: number = 1
): {
  baseRate: number;
  companionCharge: number;
  dailyRate: number;
  days: number;
  subtotal: number;
  discountPercentage: number;
  discountAmount: number;
  total: number;
  isRato: boolean;
} {
  const isRato = isRatoConcept(concept);
  const baseCharge = calculateRoomCharge(room, companionCount, concept);
  const dailyRate = baseCharge.total;

  if (isRato) {
    return {
      baseRate: baseCharge.baseRate,
      companionCharge: baseCharge.companionCharge,
      dailyRate,
      days: 1,
      subtotal: dailyRate,
      discountPercentage: 0,
      discountAmount: 0,
      total: dailyRate,
      isRato: true
    };
  }

  const cleanDays = Math.max(1, Math.floor(Number(dias) || 1));
  const subtotal = Math.round(dailyRate * cleanDays);
  const discountPercentage = cleanDays >= 3 ? 10 : 0;
  const discountAmount = cleanDays >= 3 ? Math.round(subtotal * 0.10) : 0;
  const total = subtotal - discountAmount;

  return {
    baseRate: baseCharge.baseRate,
    companionCharge: baseCharge.companionCharge,
    dailyRate,
    days: cleanDays,
    subtotal,
    discountPercentage,
    discountAmount,
    total,
    isRato: false
  };
}

export function isProductSale(sale: any): boolean {
  if (!sale) return false;
  if (sale.type === 'stock_add' || sale.tipoMovimiento === 'abastecimiento_inventario' || sale.tipoMovimiento === 'entrada_inventario') return false;
  const tipo = String(sale.tipoVenta || sale.type || '').toLowerCase();
  return tipo === 'producto' || tipo.includes('producto') || !!sale.productoId || !!sale.productId;
}

export function isRoomSale(sale: any): boolean {
  const tipo = String(sale?.tipoVenta || sale?.type || '').toLowerCase();
  return tipo.includes('habitacion') || tipo.includes('room') || !!sale?.habitacionId || !!sale?.roomId;
}

export function calculateProductSalesTotal(sales: Sale[]): number {
  return (sales || []).filter(isProductSale).reduce((sum, sale: any) => sum + Number(sale.total || 0), 0);
}

export function calculateProductCommission(sales: Sale[]): number {
  return Math.round(calculateProductSalesTotal(sales) * KODIAK_PRODUCT_COMMISSION_RATE);
}

export function calculateInventoryShortages(inventory: ProductInventoryClosure[], products: Product[] = []) {
  const priceById = new Map((products || []).map((p) => [p.id, Number(p.precio || 0)]));
  const items = (inventory || [])
    .map((item: any) => {
      const stockSistema = Number(item.stockSistema || 0);
      const conteoFisico = Number(item.conteoFisico || 0);
      const faltante = Math.max(0, stockSistema - conteoFisico);
      const precioUnitario = Number(item.precioUnitario ?? priceById.get(item.productoId) ?? item.precio ?? 0);
      const valorDescuento = faltante * precioUnitario;
      return { ...item, stockSistema, conteoFisico, faltante, precioUnitario, valorDescuento };
    })
    .filter((item) => item.faltante > 0);
  const total = items.reduce((sum, item) => sum + Number(item.valorDescuento || 0), 0);
  return { items, total };
}

export function moneyText(value: any): string {
  return `$${Number(value || 0).toLocaleString('es-CO')}`;
}

export function cleanIntegerInput(value: any): number {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return 0;
  return Number(digits.replace(/^0+/, '') || '0');
}

export function formatIntegerInput(value: any): string {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '';
  return String(n);
}

export function parseMoneyInput(value: any): number {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return 0;
  return Number(digits);
}

export function formatMoneyInput(value: any): string {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '';
  return n.toLocaleString('es-CO');
}

/**
 * Regla Hotel Kodiak:
 * Toda habitación hospedaje normal tiene salida programada a las 12:00 p. m. del día de salida.
 * Si entra a cualquier hora y paga `nights` días/noches, la salida es a las 12:00 p. m.
 * (Si la hora de ingreso es >= 12:00 p.m., el día base suma las noches; si ingresa en la mañana < 12:00 p.m.,
 *  la primera noche vence hoy a las 12:00 p.m. o se ajusta según las noches pagadas).
 */
export function buildCheckoutDateTime(checkInDate: Date, nights: number = 1): Date {
  const checkout = new Date(checkInDate);
  const n = Math.max(1, Math.floor(Number(nights) || 1));
  
  // Si ingresa después del mediodía (>= 12:00 p.m.), 1 noche = mañana 12:00 p.m., N noches = +N días
  // Si ingresa antes del mediodía (< 12:00 p.m.), se cuenta desde hoy + (n - 1) o estándar + n
  const checkInHour = checkInDate.getHours();
  const additionalDays = checkInHour >= 12 ? n : Math.max(1, n);
  
  checkout.setDate(checkout.getDate() + additionalDays);
  checkout.setHours(12, 0, 0, 0);
  return checkout;
}

/**
 * Regla Hotel Kodiak:
 * La salida del hospedaje normal vence a las 12:00 p. m. de la fecha programada.
 * Después de las 12:00 p. m. comienza inmediatamente el cobro de horas adicionales.
 * Ejemplo: 12:00:00 = 0 horas extra; 12:00:01 a 1:00:00 p. m. = 1 hora extra.
 */
export function calculateExtraHours(checkoutDateTime: Date, nowDate: Date = new Date()): number {
  if (nowDate <= checkoutDateTime) return 0;

  const diffMs = nowDate.getTime() - checkoutDateTime.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60)));
}

/**
 * Descuento estadía larga Hotel Kodiak:
 * Si el cliente paga 3 días o más, aplicar descuento automático del 10% sobre el subtotal de hospedaje.
 */
export function calculateLongStayDiscount(dailyRate: number, days: number): {
  subtotal: number;
  discountPercentage: number;
  discountAmount: number;
  total: number;
} {
  const nDays = Math.max(1, Math.floor(Number(days) || 1));
  const subtotal = Math.round(Number(dailyRate || 0) * nDays);
  const discountPercentage = nDays >= 3 ? 10 : 0;
  const discountAmount = nDays >= 3 ? Math.round(subtotal * 0.10) : 0;
  const total = subtotal - discountAmount;

  return {
    subtotal,
    discountPercentage,
    discountAmount,
    total
  };
}

export function formatCheckoutDateTimeString(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year} 12:00 p. m.`;
}
