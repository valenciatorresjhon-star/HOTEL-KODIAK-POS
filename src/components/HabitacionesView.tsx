import React, { useState, useEffect } from 'react';
import { Bed, User, ShieldAlert, CheckCircle, Search, HelpCircle, FileText, Printer, Shield, ChevronRight, X, Clock, Navigation, AlertTriangle } from 'lucide-react';
import { Room, Client, Sale, Shift, PaymentMethod, VehicleType, FirebaseUser, CompanionGuest, getEmployeeFullName } from '../types';
import { formatCop, isInvalidValue, parseColombiaDateTime } from '../utils/storage';
import { db, isFirebaseConfigured, auth } from '../firebase';
import { doc, updateDoc, setDoc, getDoc, serverTimestamp, addDoc, collection } from 'firebase/firestore';
import { getPrinterStatus, printReceipt, openCashDrawer as realOpenCashDrawer, getSettings, openBrowserPrintWindow, setBrowserPrintWindow } from '../services/printerService';
import {
  calculateRoomCharge,
  calculateRoomStayCharge,
  getOfficialRoomByAny,
  getRoomCapacity,
  KODIAK_COMPANION_FEE,
  KODIAK_RATES,
  canUseCoupleRate,
  isCoupleConcept,
  getCoupleRateForRoom,
  buildRoomTariffOptions,
  getDefaultRoomConcept,
  buildCheckoutDateTime,
  calculateExtraHours,
  cleanIntegerInput,
  formatIntegerInput,
  parseMoneyInput,
  formatMoneyInput,
  formatCheckoutDateTimeString
} from '../kodiakRules';

function parseCurrencyInput(value: any): number {
  return parseMoneyInput(value);
}

function formatCurrencyInput(value: any): string {
  return formatMoneyInput(value);
}


function getRoomVisualMeta(room: any) {
  const official = getOfficialRoomByAny(room);
  const camas = Number(official?.camas ?? room?.camas ?? 0);
  const servicio = String(official?.servicio ?? room?.servicioHabitacion ?? room?.servicio ?? 'Aire');
  const capacidadMaxima = Number(official?.capacidadMaxima ?? room?.capacidadMaxima ?? 2);
  const observacion = String(official?.observacion ?? room?.observacionesHabitacion ?? '');
  const tarifaTipo = String(official?.tarifaTipo ?? room?.tarifaTipo ?? '').toLowerCase();
  const fueraServicio = Boolean(official?.fueraServicio || room?.fueraServicio);

  return {
    official,
    camas,
    servicio,
    capacidadMaxima,
    observacion,
    tarifaTipo,
    fueraServicio,
    camasTexto: camas === 1 ? '1 cama' : `${camas} camas`,
    capacidadTexto: capacidadMaxima === 1 ? '1 persona' : `${capacidadMaxima} personas`,
  };
}

function getRoomServiceBadgeClass(servicio: any): string {
  const value = String(servicio || '').toLowerCase();
  if (value.includes('ventilador')) {
    return 'bg-cyan-500/15 border-cyan-400/30 text-cyan-300';
  }
  return 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300';
}

function getRoomTypeText(room: any): string {
  const meta = getRoomVisualMeta(room);
  if (meta.fueraServicio) return 'Fuera de servicio';
  if (meta.tarifaTipo === 'apartamento') return 'Apartamento';
  return `Habitación con ${meta.servicio.toLowerCase()}`;
}

function isRoomOutOfService(room: any): boolean {
  const official = getOfficialRoomByAny(room);
  const keyValues = [
    room?.id,
    room?.nombre,
    room?.roomName,
    room?.habitacionNombre,
    room?.numero
  ].map((value) => String(value || '').toLowerCase());

  const isHab108 = keyValues.some((value) => value.includes('108'));
  const status = String(room?.status || '').toLowerCase().trim();
  const estado = String(room?.estado || '').toLowerCase().trim();

  return Boolean(
    official?.fueraServicio ||
    room?.fueraServicio === true ||
    room?.outOfService === true ||
    room?.activa === false ||
    room?.activo === false ||
    status === 'out_of_service' ||
    status === 'fuera_de_servicio' ||
    status === 'fuera servicio' ||
    estado === 'fuera_de_servicio' ||
    estado === 'fuera servicio' ||
    isHab108
  );
}

function isRoomOccupied(room: any): boolean {
  if (isRoomOutOfService(room)) return false;

  return (
    room?.estado === 'ocupada' ||
    room?.status === 'occupied' ||
    room?.status === 'ocupada' ||
    room?.isOccupied === true ||
    room?.occupied === true ||
    room?.hospedado === true
  );
}

function isRoomAvailable(room: any): boolean {
  return !isRoomOutOfService(room) && !isRoomOccupied(room);
}

interface HabitacionesProps {
  activeShift: Shift;
  rooms: Room[];
  clients: Client[];
  onUpdateRooms: (updated: Room[]) => void;
  onUpdateClients: (updated: Client[]) => void;
  onAddSale: (sale: Sale) => void;
  userProfile: FirebaseUser | null;
  hotelSettings?: any;
}

export const getKodiakCheckoutDate = (checkInDate: Date, nights: number = 1): Date => {
  return buildCheckoutDateTime(checkInDate, nights);
};

export const calculateKodiakExtraHours = (checkoutDate: Date, nowDate: Date = new Date()): number => {
  return calculateExtraHours(checkoutDate, nowDate);
};

export const HabitacionesView: React.FC<HabitacionesProps> = ({
  activeShift,
  rooms,
  clients,
  onUpdateRooms,
  onUpdateClients,
  onAddSale,
  userProfile,
  hotelSettings
}) => {
  const safeRooms = Array.isArray(rooms) ? rooms : [];
  const safeClients = Array.isArray(clients) ? clients : [];

  const getCheckoutDetails = (room: Room) => {
    if (!room.fechaIngreso || !room.horaIngreso) {
      return { isNoche: false, isRato: false, checkInDate: null, checkoutDate: null, isOverdue: false, extraHours: 0, extraHoursCost: 0 };
    }

    const checkInDate = parseColombiaDateTime(room.fechaIngreso, room.horaIngreso);
    if (!checkInDate) {
      return { isNoche: false, isRato: false, checkInDate: null, checkoutDate: null, isOverdue: false, extraHours: 0, extraHoursCost: 0 };
    }

    const conceptoLower = (room.concepto || '').toLowerCase();
    const isRato = conceptoLower.includes('rato');
    const isNoche = !isRato;

    let checkoutDate: Date;
    const checkoutGuardado = room.checkoutDateTime ? new Date(room.checkoutDateTime) : null;
    const checkoutGuardadoValido = checkoutGuardado && !Number.isNaN(checkoutGuardado.getTime());

    if (checkoutGuardadoValido) {
      // Priorizar la fecha exacta que quedó guardada al cobrar la estadía.
      // Así una reserva pagada por 3 días no se evalúa como vencida antes de tiempo.
      checkoutDate = checkoutGuardado as Date;
    } else if (isRato) {
      // Rato checkout is 3 hours after check-in
      checkoutDate = new Date(checkInDate.getTime() + 3 * 60 * 60 * 1000);
    } else {
      // Hospedaje / Noche: salida oficial 12:00 p. m. considerando noches pagadas
      const nights = Number(room.diasPagados || room.nochesPagadas || 1);
      checkoutDate = buildCheckoutDateTime(checkInDate, nights);
    }

    const now = new Date();
    const isOverdue = now > checkoutDate;
    let extraHours = 0;
    let extraHoursCost = 0;

    if (isNoche) {
      // Las horas extra empiezan inmediatamente después de las 12:00 p. m.
      // de la fecha de salida correspondiente a los días/noches pagados.
      extraHours = calculateExtraHours(checkoutDate, now);
      const rate = hotelSettings?.checkoutHourlyRate ?? 10000;
      extraHoursCost = extraHours * rate;
    } else if (isRato && isOverdue) {
      const diffMs = now.getTime() - checkoutDate.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);
      extraHours = Math.ceil(diffHours);
      if (extraHours < 0) extraHours = 0;

      const rate = hotelSettings?.checkoutHourlyRate ?? 10000;
      extraHoursCost = extraHours * rate;
    }

    return {
      isNoche,
      isRato,
      checkInDate,
      checkoutDate,
      isOverdue,
      extraHours,
      extraHoursCost
    };
  };

  // Modals state
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [showOcuparModal, setShowOcuparModal] = useState<boolean>(false);
  const [showDetailModal, setShowDetailModal] = useState<boolean>(false);

  // Form states for Ocupar
  const [concepto, setConcepto] = useState<string>('Habitación con aire');
  const [otroConcepto, setOtroConcepto] = useState<string>('');
  const [diasPagados, setDiasPagados] = useState<number>(1);
  const [valorCobrado, setValorCobrado] = useState<number>(0);
  const [metodoPago, setMetodoPago] = useState<PaymentMethod>('Efectivo');

  // Cash states
  const [dineroRecibido, setDineroRecibido] = useState<number>(0);
  const [valorTransferido, setValorTransferido] = useState<number>(0);
  const [referenciaTransferencia, setReferenciaTransferencia] = useState<string>('');

  // Client search and input
  const [clientSearchTerm, setClientSearchTerm] = useState<string>('');
  const [filteredClients, setFilteredClients] = useState<Client[]>([]);
  const [showClientDropdown, setShowClientDropdown] = useState<boolean>(false);

  const [clienteNombre, setClienteNombre] = useState<string>('');
  const [clienteCedula, setClienteCedula] = useState<string>('');
  const [clienteCelular, setClienteCelular] = useState<string>('');
  const [clienteCorreo, setClienteCorreo] = useState<string>('');
  const [clienteDireccion, setClienteDireccion] = useState<string>('');
  const [acompanantes, setAcompanantes] = useState<CompanionGuest[]>([]);


  const [esEmpresa, setEsEmpresa] = useState<boolean>(false);
  const [empresaNombre, setEmpresaNombre] = useState<string>('');
  const [empresaNit, setEmpresaNit] = useState<string>('');

  // Vehicle states
  const [tieneVehiculo, setTieneVehiculo] = useState<boolean>(false);
  const [tipoVehiculo, setTipoVehiculo] = useState<VehicleType>('Moto');
  const [vehiculoPlaca, setVehiculoPlaca] = useState<string>('');
  const [vehiculoMarca, setVehiculoMarca] = useState<string>('');
  const [vehiculoColor, setVehiculoColor] = useState<string>('');
  const [vehiculoObservacion, setVehiculoObservacion] = useState<string>('');

  // Print/invoice triggers
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [showReceipt, setShowReceipt] = useState<boolean>(false);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [receiptAlreadyPrinted, setReceiptAlreadyPrinted] = useState<boolean>(false);

  const handleAutoPrintReceipt = async (data: any) => {
    if (hotelSettings && hotelSettings.autoPrintEnabled === false) {
      console.log("Impresión automática desactivada en configuración.");
      return;
    }

    try {
      console.log("AUTO IMPRIMIENDO RECIBO", data);
      
      const status = getPrinterStatus();
      const isRealHardware = status.connected && status.type === 'escpos';

      if (isRealHardware) {
        await printReceipt(data);
      }
    } catch (error) {
      console.error("ERROR AL IMPRIMIR RECIBO:", error);
    }
  };

  useEffect(() => {
    if (!showReceipt || !receiptData) {
      setReceiptAlreadyPrinted(false);
      return;
    }
    if (receiptAlreadyPrinted) return;

    setReceiptAlreadyPrinted(true);

    const timer = setTimeout(() => {
      handleAutoPrintReceipt(receiptData);
    }, 500);

    return () => clearTimeout(timer);
  }, [showReceipt, receiptData]);

  // Releasing room states
  const [isReleasingRoom, setIsReleasingRoom] = useState<boolean>(false);
  const [lastReleaseError, setLastReleaseError] = useState<string>('');
  const [roomPendingRelease, setRoomPendingRelease] = useState<Room | null>(null);
  const [showReleaseConfirm, setShowReleaseConfirm] = useState<boolean>(false);

  // Overdue checkout releasing states
  const [releaseActionType, setReleaseActionType] = useState<'cobrar' | 'exonerar'>('cobrar');
  const [releasePaymentMethod, setReleasePaymentMethod] = useState<'Efectivo' | 'Transferencia'>('Efectivo');
  const [releaseCashReceived, setReleaseCashReceived] = useState<number>(0);
  const [releaseObservation, setReleaseObservation] = useState<string>('');

  // Filter clients locally
  useEffect(() => {
    if (!clientSearchTerm.trim()) {
      setFilteredClients([]);
      return;
    }
    const term = clientSearchTerm.toLowerCase();
    const matches = safeClients.filter((c) => 
      c.nombre.toLowerCase().includes(term) ||
      c.cedula.includes(term) ||
      c.celular.includes(term) ||
      c.placa.toLowerCase().includes(term)
    );
    setFilteredClients(matches);
  }, [clientSearchTerm, safeClients]);

  const selectClientFromSearch = (client: Client) => {
    setClienteNombre(client.nombre || '');
    setClienteCedula(client.cedula || '');
    setClienteCelular(client.celular || '');
    setClienteCorreo(client.correo || '');
    setClienteDireccion(client.direccion || '');

    // Soporta datos empresariales guardados con nombres viejos o nuevos.
    // Esto evita que el recibo pierda Empresa/NIT al seleccionar un cliente existente.
    const empresaCliente = String(
      (client as any).empresa ||
      (client as any).empresaNombre ||
      (client as any).nombreEmpresa ||
      (client as any).razonSocial ||
      ''
    ).trim();
    const nitCliente = String(
      (client as any).nit ||
      (client as any).empresaNit ||
      (client as any).nitEmpresa ||
      (client as any).nitFacturacion ||
      ''
    ).trim();
    const facturaEmpresa = Boolean((client as any).esEmpresa || empresaCliente || nitCliente);

    setEsEmpresa(facturaEmpresa);
    setEmpresaNombre(empresaCliente);
    setEmpresaNit(nitCliente);
    const clientHasVehicle = String(client.placa || '').trim().toUpperCase() !== 'NO TIENE' && String(client.tipoVehiculo || '').trim() !== 'No tiene';
    setTieneVehiculo(clientHasVehicle);
    setTipoVehiculo(clientHasVehicle ? (client.tipoVehiculo || 'Moto') : 'Moto');
    setVehiculoPlaca(clientHasVehicle ? (client.placa || '') : '');
    setVehiculoMarca(clientHasVehicle ? (client.marca || '') : '');
    setVehiculoColor(clientHasVehicle ? (client.color || '') : '');
    setVehiculoObservacion(clientHasVehicle ? (client.observacionVehiculo || '') : '');
    setShowClientDropdown(false);
    setClientSearchTerm('');
  };

  const createEmptyAcompanante = (): CompanionGuest => ({
    id: `acompanante-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    nombre: '',
    cedula: '',
    celular: '',
    parentesco: 'Acompañante',
    observacion: ''
  });

  const getCapacidadMaximaFormulario = (): number => {
    if (!selectedRoom) return 0;
    return Number(getRoomCapacity(selectedRoom) || 0);
  };

  const getMaxAcompanantesPermitidos = (): number => {
    const capacidadMaxima = getCapacidadMaximaFormulario();

    // La capacidad máxima incluye al cliente principal.
    // Ejemplo: capacidad 6 = 1 cliente principal + máximo 5 acompañantes.
    return Math.max(0, capacidadMaxima - 1);
  };

  const getPersonasRegistradasEnFormulario = (): number => {
    // Cuenta al cliente principal + TODAS las tarjetas creadas.
    // Así no permite agregar acompañante #6, #7, #8 o #9 por encima del límite.
    return 1 + acompanantes.length;
  };

  const isLimitePersonasAlcanzado = (): boolean => {
    const capacidadMaxima = getCapacidadMaximaFormulario();
    if (capacidadMaxima <= 0) return true;
    return getPersonasRegistradasEnFormulario() >= capacidadMaxima;
  };

  const addAcompanante = () => {
    if (!selectedRoom) {
      setErrorMsg('Primero debe seleccionar una habitación.');
      return;
    }

    const capacidadMaxima = getCapacidadMaximaFormulario();
    const maxAcompanantes = getMaxAcompanantesPermitidos();
    const personasActuales = getPersonasRegistradasEnFormulario();

    if (capacidadMaxima <= 0 || isRoomOutOfService(selectedRoom)) {
      setErrorMsg('Esta habitación no permite ocupación.');
      return;
    }

    if (acompanantes.length >= maxAcompanantes || personasActuales >= capacidadMaxima) {
      setErrorMsg(
        `Esta habitación permite máximo ${capacidadMaxima} persona(s). ` +
        `Como ya está incluido el cliente principal, solo puede agregar máximo ${maxAcompanantes} acompañante(s).`
      );
      return;
    }

    setErrorMsg('');
    setAcompanantes((prev) => [...prev, createEmptyAcompanante()]);
  };

  const updateAcompanante = (id: string, field: keyof CompanionGuest, value: string) => {
    setAcompanantes((prev) =>
      prev.map((acompanante) =>
        acompanante.id === id
          ? { ...acompanante, [field]: value }
          : acompanante
      )
    );
  };

  const removeAcompanante = (id: string) => {
    setAcompanantes((prev) => prev.filter((acompanante) => acompanante.id !== id));
  };

  const getCleanAcompanantes = (): CompanionGuest[] => {
    return acompanantes
      .filter((acompanante) => {
        return Boolean(
          String(acompanante.nombre || '').trim() ||
          String(acompanante.cedula || '').trim() ||
          String(acompanante.celular || '').trim() ||
          String(acompanante.observacion || '').trim()
        );
      })
      .map((acompanante) => ({
        id: acompanante.id,
        nombre: String(acompanante.nombre || '').trim().toUpperCase(),
        cedula: String(acompanante.cedula || '').trim(),
        celular: String(acompanante.celular || '').trim(),
        parentesco: String(acompanante.parentesco || 'Acompañante').trim(),
        observacion: String(acompanante.observacion || '').trim()
      }));
  };

  useEffect(() => {
    if (!selectedRoom || !showOcuparModal) return;

    // REGLA HOTEL KODIAK:
    // El valor que aparece en el resumen DEBE ser exactamente el mismo valor
    // que pasa a la sección de pago. Para hospedaje normal se multiplica por
    // los días/noches seleccionados y se aplica el descuento de larga estadía.
    // En modalidad Rato, calculateRoomStayCharge ignora los días y cobra solo 3 horas.
    const cantidadAcompanantesACobrar = acompanantes.length;
    const stayBilling = calculateRoomStayCharge(
      selectedRoom,
      cantidadAcompanantesACobrar,
      concepto,
      diasPagados
    );
    const total = stayBilling.total;

    setValorCobrado(total);

    // Cuando cambia tarifa/días/acompañantes, precargar el pago con el TOTAL REAL.
    // El usuario todavía puede escribir un monto mayor en efectivo para calcular vueltas.
    if (metodoPago === 'Efectivo') setDineroRecibido(total);
    if (metodoPago === 'Transferencia') setValorTransferido(total);
  }, [selectedRoom, showOcuparModal, concepto, acompanantes, diasPagados, metodoPago]);

  // Cash drawer trigger helper
  const openCashDrawer = async (saleId: string = '', amount: number = 0, paymentMethod: string = 'Efectivo') => {
    console.log('[POS Drawer] Attempting to open physical electronic cash drawer via ESC/POS command sequences...');
    try {
      await realOpenCashDrawer(
        'checkout_room',
        saleId,
        amount,
        paymentMethod,
        activeShift?.empleada || 'Sistema',
        userProfile?.uid || 'system'
      );
    } catch (e) {
      console.error("Fallo local de apertura de cajon:", e);
    }
    if ('vibrate' in navigator) {
      navigator.vibrate([100, 50, 100]);
    }
  };

  // Validation rules for Ocupar
  const validateForm = (): boolean => {
    setErrorMsg('');

    const activeConcepto = concepto;
    if (isInvalidValue(activeConcepto)) {
      setErrorMsg('Debe definir o escribir un concepto.');
      return false;
    }

    if (valorCobrado <= 0 || isNaN(valorCobrado)) {
      setErrorMsg('El valor cobrado debe ser un número mayor a 0.');
      return false;
    }

    if (metodoPago === 'Efectivo') {
      if (dineroRecibido < valorCobrado) {
        setErrorMsg('El dinero recibido en efectivo no puede ser menor al valor a cobrar.');
        return false;
      }
    } else {
      if (valorTransferido < valorCobrado) {
        setErrorMsg('El valor transferido registrado no puede ser menor al valor a cobrar.');
        return false;
      }
      if (isInvalidValue(referenciaTransferencia)) {
        setErrorMsg('La referencia de transferencia bancaria es de registro obligatorio.');
        return false;
      }
    }

    // Client validators
    if (isInvalidValue(clienteNombre)) {
      setErrorMsg('Debe registrar el nombre completo del cliente.');
      return false;
    }
    if (isInvalidValue(clienteCedula)) {
      setErrorMsg('Debe registrar la cédula o NIT del cliente.');
      return false;
    }
    if (isInvalidValue(clienteCelular)) {
      setErrorMsg('Debe ingresar un número de celular de contacto.');
      return false;
    }
    if (isInvalidValue(clienteCorreo)) {
      setErrorMsg('Debe ingresar el correo electrónico del cliente.');
      return false;
    }
    if (isInvalidValue(clienteDireccion)) {
      setErrorMsg('Debe registrar la dirección física del cliente.');
      return false;
    }

    // Optional companions validators
    const cleanedAcompanantes = getCleanAcompanantes();
    for (const acompanante of cleanedAcompanantes) {
      if (isInvalidValue(acompanante.nombre)) {
        setErrorMsg('Si agrega un acompañante, debe registrar el nombre completo.');
        return false;
      }
      if (isInvalidValue(acompanante.cedula)) {
        setErrorMsg('Si agrega un acompañante, debe registrar la cédula.');
        return false;
      }
      if (acompanante.cedula === clienteCedula) {
        setErrorMsg('La cédula del acompañante no puede ser igual a la del cliente principal.');
        return false;
      }
    }

    const repeatedCedulas = new Set<string>();
    for (const acompanante of cleanedAcompanantes) {
      if (repeatedCedulas.has(acompanante.cedula)) {
        setErrorMsg('Hay acompañantes repetidos con la misma cédula.');
        return false;
      }
      repeatedCedulas.add(acompanante.cedula);
    }

    const officialRoom = getOfficialRoomByAny(selectedRoom);
    if (officialRoom?.fueraServicio || isRoomOutOfService(selectedRoom)) {
      setErrorMsg(`${officialRoom?.nombre || selectedRoom?.nombre || 'Esta habitación'} está fuera de servicio y no se puede ocupar.`);
      return false;
    }

    if (isCoupleConcept(concepto) && !canUseCoupleRate(selectedRoom)) {
      setErrorMsg('La tarifa Pareja está permitida para toda habitación activa con mínimo 1 cama.');
      return false;
    }

    const capacidadMaxima = Number(getRoomCapacity(selectedRoom) || 0);
    const maxAcompanantes = Math.max(0, capacidadMaxima - 1);
    const numeroPersonasFormulario = 1 + acompanantes.length;
    const numeroPersonasLimpio = 1 + cleanedAcompanantes.length;

    // Si se agregó una tarjeta de acompañante, debe completarse o quitarse.
    // Esto evita cobrar mal y evita superar capacidad con tarjetas vacías.
    for (const acompanante of acompanantes) {
      const nombreRaw = String(acompanante.nombre || '').trim();
      const cedulaRaw = String(acompanante.cedula || '').trim();

      if (!nombreRaw || !cedulaRaw) {
        setErrorMsg('Debe completar nombre y cédula de cada acompañante agregado, o quitar la tarjeta vacía.');
        return false;
      }
    }

    if (acompanantes.length > maxAcompanantes || numeroPersonasFormulario > capacidadMaxima || numeroPersonasLimpio > capacidadMaxima) {
      setErrorMsg(
        `Esta habitación permite máximo ${capacidadMaxima} persona(s). ` +
        `Está intentando ingresar ${numeroPersonasFormulario}.`
      );
      return false;
    }

    // Enterprise validators
    if (esEmpresa) {
      if (isInvalidValue(empresaNombre)) {
        setErrorMsg('Debe ingresar el nombre de la empresa.');
        return false;
      }
      if (isInvalidValue(empresaNit)) {
        setErrorMsg('Debe ingresar el NIT de la empresa.');
        return false;
      }
    }

    // Vehicle validators
    if (tieneVehiculo) {
      if (isInvalidValue(vehiculoPlaca)) {
        setErrorMsg('Debe ingresar la placa del vehículo. Si no trae vehículo, marque “No tiene vehículo”.');
        return false;
      }
      if (isInvalidValue(vehiculoMarca)) {
        setErrorMsg('Debe ingresar la marca del vehículo.');
        return false;
      }
      if (isInvalidValue(vehiculoColor)) {
        setErrorMsg('Debe ingresar el color del vehículo.');
        return false;
      }
      if (isInvalidValue(vehiculoObservacion)) {
        setErrorMsg('Debe registrar la observación del vehículo.');
        return false;
      }
    }

    return true;
  };

  const handleConfirmOcupar = () => {
    if (!validateForm()) return;

    // Pre-open print window for occupying room
    const settings = getSettings();
    if (metodoPago === 'Efectivo' && settings.printerType === 'browser' && settings.autoPrintEnabled) {
      if (hotelSettings?.printOnRoomCharge ?? true) {
        const win = openBrowserPrintWindow();
        setBrowserPrintWindow(win);
      }
    }

    const finalConcepto = concepto;
    const isRatoConcept = (finalConcepto || '').toLowerCase().includes('rato');
    const stayBilling = calculateRoomStayCharge(selectedRoom, getCleanAcompanantes().length, finalConcepto, diasPagados);
    const finalValorCobrado = stayBilling.total;
    const now = new Date();

    const cleanedAcompanantes = getCleanAcompanantes();
    const numeroPersonas = 1 + cleanedAcompanantes.length;
    const acompanantesTexto = cleanedAcompanantes
      .map((a) => `${a.nombre} C.C. ${a.cedula}`)
      .join(' | ');

    // Datos de facturación empresarial: se calculan UNA sola vez y se reutilizan
    // en cliente, venta, habitación y recibo. Así no se pierde el NIT al imprimir.
    const empresaFacturaNombre = (esEmpresa || empresaNombre || empresaNit)
      ? String(empresaNombre || '').trim().toUpperCase()
      : '';

    const empresaFacturaNit = (esEmpresa || empresaNombre || empresaNit)
      ? String(empresaNit || '').trim()
      : '';

    const facturarEmpresa = Boolean(
      (esEmpresa || Boolean(empresaFacturaNombre && empresaFacturaNit)) &&
      empresaFacturaNombre &&
      empresaFacturaNit
    );

    const empresaFacturacionNombre = facturarEmpresa ? empresaFacturaNombre : '';
    const empresaFacturacionNit = facturarEmpresa ? empresaFacturaNit : '';
    const debeFacturarEmpresa = facturarEmpresa;

    // 1. Create/update client profiles
    const existingClientIndex = safeClients.findIndex(
      (c) => c.cedula === clienteCedula || c.celular === clienteCelular
    );

    let updatedClients: Client[] = [...safeClients];
    let clientToSave: Client;

    if (existingClientIndex >= 0) {
      clientToSave = {
        ...safeClients[existingClientIndex],
        nombre: clienteNombre.trim().toUpperCase(),
        cedula: clienteCedula.trim(),
        celular: clienteCelular.trim(),
        correo: clienteCorreo.trim(),
        direccion: clienteDireccion.trim(),
        esEmpresa: debeFacturarEmpresa,
        empresa: debeFacturarEmpresa ? empresaFacturacionNombre : undefined,
        nit: debeFacturarEmpresa ? empresaFacturacionNit : undefined,
        empresaNombre: debeFacturarEmpresa ? empresaFacturacionNombre : undefined,
        empresaNit: debeFacturarEmpresa ? empresaFacturacionNit : undefined,
        nitEmpresa: debeFacturarEmpresa ? empresaFacturacionNit : undefined,
        tipoVehiculo: tieneVehiculo ? tipoVehiculo : 'No tiene',
        placa: tieneVehiculo ? vehiculoPlaca.trim().toUpperCase() : 'NO TIENE',
        marca: tieneVehiculo ? vehiculoMarca.trim().toUpperCase() : 'NO TIENE',
        color: tieneVehiculo ? vehiculoColor.trim().toUpperCase() : 'NO TIENE',
        observacionVehiculo: tieneVehiculo ? vehiculoObservacion.trim() : 'No registra vehículo',
        visitas: (safeClients[existingClientIndex].visitas || 1) + 1,
        tipoCliente: 'principal',
        acompanantes: cleanedAcompanantes,
        numeroPersonas,
        updatedAt: now.toISOString()
      };
      updatedClients[existingClientIndex] = clientToSave;
    } else {
      clientToSave = {
        id: `client-${now.getTime()}`,
        nombre: clienteNombre.trim().toUpperCase(),
        cedula: clienteCedula.trim(),
        celular: clienteCelular.trim(),
        correo: clienteCorreo.trim(),
        direccion: clienteDireccion.trim(),
        esEmpresa: debeFacturarEmpresa,
        empresa: debeFacturarEmpresa ? empresaFacturacionNombre : undefined,
        nit: debeFacturarEmpresa ? empresaFacturacionNit : undefined,
        empresaNombre: debeFacturarEmpresa ? empresaFacturacionNombre : undefined,
        empresaNit: debeFacturarEmpresa ? empresaFacturacionNit : undefined,
        nitEmpresa: debeFacturarEmpresa ? empresaFacturacionNit : undefined,
        tipoVehiculo: tieneVehiculo ? tipoVehiculo : 'No tiene',
        placa: tieneVehiculo ? vehiculoPlaca.trim().toUpperCase() : 'NO TIENE',
        marca: tieneVehiculo ? vehiculoMarca.trim().toUpperCase() : 'NO TIENE',
        color: tieneVehiculo ? vehiculoColor.trim().toUpperCase() : 'NO TIENE',
        observacionVehiculo: tieneVehiculo ? vehiculoObservacion.trim() : 'No registra vehículo',
        visitas: 1,
        tipoCliente: 'principal',
        acompanantes: cleanedAcompanantes,
        numeroPersonas,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      };
      updatedClients.push(clientToSave);
    }

    // Registrar también a cada acompañante como huésped independiente del fichero.
    cleanedAcompanantes.forEach((acompanante, index) => {
      const existingAcompananteIndex = updatedClients.findIndex((c) => c.cedula === acompanante.cedula);
      const existingAcompanante = existingAcompananteIndex >= 0 ? updatedClients[existingAcompananteIndex] : null;

      const acompananteClient: Client = {
        ...(existingAcompanante || {
          id: `client-acomp-${now.getTime()}-${index}`,
          createdAt: now.toISOString()
        } as Client),
        nombre: acompanante.nombre,
        cedula: acompanante.cedula,
        celular: acompanante.celular || clienteCelular.trim(),
        correo: existingAcompanante?.correo || 'sin_correo@hotelkodiak.com',
        direccion: existingAcompanante?.direccion || clienteDireccion.trim() || 'No registrada',
        esEmpresa: false,
        empresa: undefined,
        nit: undefined,
        tipoVehiculo: existingAcompanante?.tipoVehiculo || tipoVehiculo,
        placa: existingAcompanante?.placa || vehiculoPlaca.trim().toUpperCase() || 'S/P',
        marca: existingAcompanante?.marca || 'ACOMPAÑANTE',
        color: existingAcompanante?.color || 'S/C',
        observacionVehiculo: `Acompañante de ${clienteNombre.trim().toUpperCase()} C.C. ${clienteCedula.trim()}${acompanante.observacion ? ` — ${acompanante.observacion}` : ''}`,
        visitas: (existingAcompanante?.visitas || 0) + 1,
        tipoCliente: 'acompanante',
        acompananteDe: clienteNombre.trim().toUpperCase(),
        acompananteDeCedula: clienteCedula.trim(),
        acompanantes: [],
        numeroPersonas: 1,
        updatedAt: now.toISOString()
      };

      if (existingAcompananteIndex >= 0) {
        updatedClients[existingAcompananteIndex] = acompananteClient;
      } else {
        updatedClients.push(acompananteClient);
      }
    });

    onUpdateClients(updatedClients);

    // 2. Create Sale
    const saleId = `sale-${now.getTime()}`;
    const departure = isRatoConcept
      ? new Date(now.getTime() + 3 * 60 * 60 * 1000)
      : buildCheckoutDateTime(now, diasPagados);

    const salidaProgramadaStr = isRatoConcept
      ? departure.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true })
      : `${departure.toLocaleDateString('es-CO')} 12:00 p. m.`;

    const newSale: Sale = {
      id: saleId,
      shiftId: activeShift.id,
      fecha: now.toLocaleDateString('es-CO'),
      hora: now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true }),
      createdAt: now.toISOString(),
      empleada: activeShift.empleada,
      tipoVenta: 'habitacion',
      concepto: `Hospedaje: ${finalConcepto} - ${selectedRoom?.nombre}`,
      total: finalValorCobrado,
      metodoPago,
      efectivoRecibido: metodoPago === 'Efectivo' ? dineroRecibido : undefined,
      cambioEntregado: metodoPago === 'Efectivo' ? (dineroRecibido - finalValorCobrado) : undefined,
      valorTransferido: metodoPago === 'Transferencia' ? valorTransferido : undefined,
      referenciaTransferencia: metodoPago === 'Transferencia' ? referenciaTransferencia : undefined,
      habitacionId: selectedRoom?.id,
      habitacionNombre: selectedRoom?.nombre,
      clienteNombre,
      clienteCedula,
      acompanantes: cleanedAcompanantes,
      numeroPersonas,
      tarifaBase: stayBilling.dailyRate,
      cargoAcompanantes: stayBilling.dailyRate - (stayBilling.dailyRate / (1 + cleanedAcompanantes.length * 0.5)),
      diasPagados: isRatoConcept ? 1 : diasPagados,
      tarifaDiaria: stayBilling.dailyRate,
      subtotalSinDescuento: stayBilling.subtotal,
      descuentoEstadiaLarga: stayBilling.discountAmount,
      porcentajeDescuentoEstadia: stayBilling.discountPercentage,
      salidaProgramada: salidaProgramadaStr,
      salidaProgramadaFecha: departure.toLocaleDateString('es-CO'),
      checkoutDateTime: departure.toISOString(),
      facturarEmpresa,
      facturarAEmpresa: facturarEmpresa,
      esEmpresa: facturarEmpresa,
      empresa: facturarEmpresa ? empresaFacturacionNombre : undefined,
      empresaNombre: facturarEmpresa ? empresaFacturacionNombre : undefined,
      razonSocial: facturarEmpresa ? empresaFacturacionNombre : undefined,
      empresaFacturacion: facturarEmpresa ? empresaFacturacionNombre : undefined,
      nombreEmpresa: facturarEmpresa ? empresaFacturacionNombre : undefined,
      nit: facturarEmpresa ? empresaFacturacionNit : undefined,
      nitEmpresa: facturarEmpresa ? empresaFacturacionNit : undefined,
      empresaNit: facturarEmpresa ? empresaFacturacionNit : undefined,
      nitFacturacion: facturarEmpresa ? empresaFacturacionNit : undefined,
      clientNit: facturarEmpresa ? empresaFacturacionNit : undefined
    };
    onAddSale(newSale);

    // 3. Mark room as occupied
    const updatedRooms = safeRooms.map((r) => {
      if (r.id === selectedRoom?.id) {
        return {
          ...r,
          estado: 'ocupada' as const,
          concepto: finalConcepto,
          valorCobrado: finalValorCobrado,
          tarifaBase: stayBilling.dailyRate,
          cargoAcompanantes: stayBilling.dailyRate - (stayBilling.dailyRate / (1 + cleanedAcompanantes.length * 0.5)),
          diasPagados: isRatoConcept ? 1 : diasPagados,
          nochesPagadas: isRatoConcept ? 1 : diasPagados,
          tarifaDiaria: stayBilling.dailyRate,
          subtotalSinDescuento: stayBilling.subtotal,
          descuentoEstadiaLarga: stayBilling.discountAmount,
          porcentajeDescuentoEstadia: stayBilling.discountPercentage,
          totalConDescuento: stayBilling.total,
          metodoPago,
          horaIngreso: now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true }),
          fechaIngreso: now.toLocaleDateString('es-CO'),
          salidaProgramada: salidaProgramadaStr,
          fechaSalidaProgramada: departure.toLocaleDateString('es-CO'),
          checkoutDateTime: departure.toISOString(),
          tiempoRestante: '12:00h',
          empleada: activeShift.empleada,
          cliente: clienteNombre,
          facturarEmpresa,
          facturarAEmpresa: facturarEmpresa,
          esEmpresa: facturarEmpresa,
          empresa: facturarEmpresa ? empresaFacturacionNombre : '',
          empresaNombre: facturarEmpresa ? empresaFacturacionNombre : '',
          razonSocial: facturarEmpresa ? empresaFacturacionNombre : '',
          empresaFacturacion: facturarEmpresa ? empresaFacturacionNombre : '',
          nit: facturarEmpresa ? empresaFacturacionNit : '',
          empresaNit: facturarEmpresa ? empresaFacturacionNit : '',
          nitEmpresa: facturarEmpresa ? empresaFacturacionNit : '',
          nitFacturacion: facturarEmpresa ? empresaFacturacionNit : '',
          vehiculo: tieneVehiculo ? `${tipoVehiculo} (${vehiculoPlaca})` : 'No registra vehículo',
          ventaId: saleId,
          clienteDetails: {
            ...clientToSave,
            facturarEmpresa,
            esEmpresa: facturarEmpresa,
            empresa: facturarEmpresa ? empresaFacturacionNombre : undefined,
            empresaNombre: facturarEmpresa ? empresaFacturacionNombre : undefined,
            razonSocial: facturarEmpresa ? empresaFacturacionNombre : undefined,
            nit: facturarEmpresa ? empresaFacturacionNit : undefined,
            empresaNit: facturarEmpresa ? empresaFacturacionNit : undefined,
            nitEmpresa: facturarEmpresa ? empresaFacturacionNit : undefined,
            acompanantes: cleanedAcompanantes,
            numeroPersonas
          },
          acompanantes: cleanedAcompanantes,
          numeroPersonas,
          acompanantesTexto
        };
      }
      return r;
    });
    onUpdateRooms(updatedRooms);

    // Open cash drawer automatically if Cash method
    if (metodoPago === 'Efectivo') {
      openCashDrawer(saleId, finalValorCobrado, metodoPago);
    }

    // Prep receipt data
    const receipt = {
      hotel: 'Hotel Kodiak',
      nit: '901429000',
      fecha: now.toLocaleDateString('es-CO'),
      hora: now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true }),
      habitacion: selectedRoom?.nombre,
      concepto: finalConcepto,
      cliente: clienteNombre,
      clienteNombre,
      clienteCedula,
      diasPagados: isRatoConcept ? 1 : diasPagados,
      tarifaDiaria: stayBilling.dailyRate,
      subtotalSinDescuento: stayBilling.subtotal,
      descuentoEstadiaLarga: stayBilling.discountAmount,
      porcentajeDescuentoEstadia: stayBilling.discountPercentage,
      salidaProgramada: salidaProgramadaStr,
      facturarEmpresa,
      facturarAEmpresa: facturarEmpresa,
      esEmpresa: facturarEmpresa,
      empresa: facturarEmpresa ? empresaFacturacionNombre : '',
      empresaNombre: facturarEmpresa ? empresaFacturacionNombre : '',
      nombreEmpresa: facturarEmpresa ? empresaFacturacionNombre : '',
      companyName: facturarEmpresa ? empresaFacturacionNombre : '',
      razonSocial: facturarEmpresa ? empresaFacturacionNombre : '',
      empresaFacturacion: facturarEmpresa ? empresaFacturacionNombre : '',
      nitEmpresa: facturarEmpresa ? empresaFacturacionNit : '',
      empresaNit: facturarEmpresa ? empresaFacturacionNit : '',
      nitFacturacion: facturarEmpresa ? empresaFacturacionNit : '',
      companyNit: facturarEmpresa ? empresaFacturacionNit : '',
      clientNit: facturarEmpresa ? empresaFacturacionNit : '',
      datosEmpresaTexto: facturarEmpresa
        ? `FACTURAR A EMPRESA\nEmpresa: ${empresaFacturacionNombre}\nNIT Empresa: ${empresaFacturacionNit}`
        : '',
      clienteDetails: {
        facturarEmpresa,
        esEmpresa: facturarEmpresa,
        empresa: facturarEmpresa ? empresaFacturacionNombre : '',
        nit: facturarEmpresa ? empresaFacturacionNit : '',
        empresaNombre: facturarEmpresa ? empresaFacturacionNombre : '',
        empresaNit: facturarEmpresa ? empresaFacturacionNit : '',
        nitEmpresa: facturarEmpresa ? empresaFacturacionNit : '',
        razonSocial: facturarEmpresa ? empresaFacturacionNombre : ''
      },
      tarifaBase: stayBilling.dailyRate,
      cargoAcompanantes: stayBilling.dailyRate - (stayBilling.dailyRate / (1 + cleanedAcompanantes.length * 0.5)),
      acompanantes: cleanedAcompanantes,
      numeroPersonas,
      observaciones: [
        facturarEmpresa ? `Empresa: ${empresaFacturacionNombre} · NIT: ${empresaFacturacionNit}` : '',
        cleanedAcompanantes.length > 0 ? `Acompañantes: ${acompanantesTexto}` : '',
        diasPagados >= 3 ? `Descuento 10% aplicado por estadía de ${diasPagados} días` : ''
      ].filter(Boolean).join(' | '),
      metodo: metodoPago,
      valor: finalValorCobrado,
      recibido: metodoPago === 'Efectivo' ? dineroRecibido : valorTransferido,
      cambio: metodoPago === 'Efectivo' ? (dineroRecibido - finalValorCobrado) : 0,
      empleada: getEmployeeFullName(activeShift.empleada),
      turno: activeShift.id
    };

    console.log('[RECIBO HABITACION EMPRESA/NIT]', {
      facturarEmpresa,
      empresaFacturaNombre,
      empresaFacturaNit,
      receipt
    });
    setReceiptData(receipt);
    setAcompanantes([]);

    // Prompt for print option
    setShowOcuparModal(false);
    setShowReceipt(metodoPago === 'Efectivo');
  };

  const executeReleaseRoom = async (
    roomToRelease: Room,
    extraHoursCharged: boolean = false,
    paymentMethod: 'Efectivo' | 'Transferencia' | 'Exonerado' = 'Efectivo',
    amountCharged: number = 0,
    observation: string = '',
    horasAdicionales: number = 0
  ) => {
    console.log("EJECUTANDO LIBERACIÓN REAL CON PARÁMETROS:", {
      roomToRelease,
      extraHoursCharged,
      paymentMethod,
      amountCharged,
      observation,
      horasAdicionales
    });

    if (!roomToRelease) {
      alert("ERROR: No llegó habitación para liberar.");
      return;
    }

    if (isRoomOutOfService(roomToRelease)) {
      alert("Esta habitación está fuera de servicio. No se puede liberar ni ocupar.");
      return;
    }

    if (!isRoomOccupied(roomToRelease)) {
      alert("Esta habitación no está ocupada. No hay hospedaje activo para liberar.");
      return;
    }

    const roomDocId =
      roomToRelease.firestoreId ||
      roomToRelease.documentId ||
      roomToRelease.docId ||
      roomToRelease.id;

    console.log("roomDocId para liberar:", roomDocId);

    if (!roomDocId) {
      alert("ERROR: No se encontró ID real de Firestore.");
      return;
    }

    try {
      setIsReleasingRoom(true);
      setLastReleaseError("");

      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const yyyymmdd = `${year}-${month}-${day}`;
      const formattedHora = now.toLocaleTimeString("es-CO", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      });

      const releaseData: any = {
        estado: "disponible" as const,
        status: "available",
        isOccupied: false,
        occupied: false,
        hospedado: false,

        concepto: "",
        valorCobrado: 0,
        metodoPago: "",
        horaIngreso: "",
        fechaIngreso: "",
        salidaProgramada: "",
        tiempoRestante: "",
        empleada: "",
        cliente: "",
        vehiculo: "",
        ventaId: "",
        clienteDetails: null,
        acompanantes: [],
        numeroPersonas: 0,
        acompanantesTexto: "",

        occupantName: "",
        clientName: "",
        clienteNombre: "",
        clientId: "",
        clienteId: "",
        clientDocument: "",
        clienteCedula: "",
        clientPhone: "",
        clienteCelular: "",
        clientEmail: "",
        vehiclePlate: "",
        placa: "",
        vehicleType: "",

        checkInTime: null,
        ingreso: null,
        expectedCheckOut: null,
        expectedCheckOutTime: null,
        currentStayId: null,
        currentSaleId: null,

        releasedAt: isFirebaseConfigured ? serverTimestamp() : now.toISOString(),
        updatedAt: isFirebaseConfigured ? serverTimestamp() : now.toISOString(),
        updatedBy: auth?.currentUser?.uid || "",
        updatedByName: userProfile?.nombre || auth?.currentUser?.email || ""
      };

      console.log("AHORA SÍ ESCRIBIENDO EN FIRESTORE:", roomDocId, releaseData);

      if (isFirebaseConfigured) {
        const roomRef = doc(db, "hotel_rooms", roomDocId);

        await setDoc(roomRef, releaseData, { merge: true });

        console.log("SETDOC COMPLETADO. VERIFICANDO DOCUMENTO...");

        const verifySnap = await getDoc(roomRef);

        if (!verifySnap.exists()) {
          throw new Error("El documento no existe después de liberar.");
        }

        const verifiedData = verifySnap.data();

        console.log("DOCUMENTO VERIFICADO:", verifiedData);

        const ok =
          verifiedData.status === "available" ||
          verifiedData.estado === "disponible" ||
          verifiedData.isOccupied === false ||
          verifiedData.occupied === false;

        if (!ok) {
          throw new Error(
            "Firestore escribió, pero la habitación no quedó con estado disponible."
          );
        }

        if (extraHoursCharged) {
          const isExonerated = paymentMethod === 'Exonerado';
          const titleConcept = isExonerated
            ? `Horas Extras Exoneradas: Hab ${roomToRelease.nombre || roomDocId} (${horasAdicionales} hrs) - ${roomToRelease.cliente || 'Anónimo'}`
            : `Cobro Horas Extras: Hab ${roomToRelease.nombre || roomDocId} (${horasAdicionales} hrs) - ${roomToRelease.cliente || 'Anónimo'}`;

          await addDoc(collection(db, "hotel_sales"), {
            type: "room_release",
            tipoVenta: "habitacion", // To count as hospedaje income!
            category: "room",
            concept: titleConcept,
            concepto: titleConcept,
            roomId: roomDocId,
            roomName: roomToRelease.nombre || roomDocId,
            habitacionId: roomDocId,
            habitacionNombre: roomToRelease.nombre || roomDocId,
            clientName: roomToRelease.cliente || "Anónimo",
            clienteNombre: roomToRelease.cliente || "Anónimo",
            total: amountCharged,
            paymentMethod: isExonerated ? "N/A" : paymentMethod,
            metodoPago: isExonerated ? "N/A" : paymentMethod,
            employeeName: userProfile?.nombre || auth?.currentUser?.email || "",
            empleada: userProfile?.nombre || auth?.currentUser?.email || "",
            createdBy: auth?.currentUser?.uid || "",
            createdAt: serverTimestamp(),
            fecha: yyyymmdd,
            hora: formattedHora,
            observaciones: observation || "",
            horasAdicionales: horasAdicionales,
            shiftId: activeShift?.id || 'no-shift'
          });

          // Integrated print and cash drawer trigger for extra hours charge
          if (!isExonerated) {
            if (paymentMethod === 'Efectivo') {
              try {
                await openCashDrawer('checkout_extra_hours', amountCharged, 'Efectivo');
              } catch (e) {
                console.error("Fallo apertura cajon checkout:", e);
              }
            }
            if (hotelSettings?.printOnExtraHours ?? true) {
              const receiptDataObj = {
                id: '',
                fecha: now.toLocaleDateString('es-CO'),
                hora: formattedHora,
                employeeName: userProfile?.nombre || 'Sistema',
                turno: activeShift?.id || 'N/A',
                cliente: roomToRelease.cliente || 'Anónimo',
                habitacion: roomToRelease.nombre || roomDocId,
                metodoPago: paymentMethod,
                total: amountCharged,
                concepto: `Cobro Horas Extras: Hab ${roomToRelease.nombre || roomDocId} (${horasAdicionales} hrs)`,
                tipo: 'Horas Adicionales'
              };
              try {
                await printReceipt(receiptDataObj);
              } catch (err) {
                console.error("Fallo auto-impresión horas extras:", err);
              }
            }
          }
        } else {
          await addDoc(collection(db, "hotel_sales"), {
            type: "room_release",
            tipoVenta: "liberacion_habitacion",
            category: "room",
            concept: `Liberación ${roomToRelease.nombre || roomDocId}`,
            roomId: roomDocId,
            roomName: roomToRelease.nombre || roomDocId,
            clientName:
              (roomToRelease as any).clientName ||
              (roomToRelease as any).occupantName ||
              (roomToRelease as any).clienteNombre ||
              roomToRelease.cliente ||
              "",
            total: 0,
            paymentMethod: "N/A",
            employeeName: userProfile?.nombre || auth?.currentUser?.email || "",
            createdBy: auth?.currentUser?.uid || "",
            createdAt: serverTimestamp(),
            fecha: yyyymmdd,
            hora: formattedHora
          });
        }
      } else {
        // Fallback local storage for development/preview offline mode
        const checkoutSaleId = `sale-checkout-${Date.now()}`;
        if (extraHoursCharged) {
          const isExonerated = paymentMethod === 'Exonerado';
          const titleConcept = isExonerated
            ? `Horas Extras Exoneradas: Hab ${roomToRelease.nombre} (${horasAdicionales} hrs) - ${roomToRelease.cliente || 'Anónimo'}`
            : `Cobro Horas Extras: Hab ${roomToRelease.nombre} (${horasAdicionales} hrs) - ${roomToRelease.cliente || 'Anónimo'}`;

          const checkoutSale: Sale = {
            id: checkoutSaleId,
            shiftId: activeShift?.id || 'no-shift',
            fecha: yyyymmdd,
            hora: formattedHora,
            createdAt: now.toISOString(),
            empleada: activeShift?.empleada || 'Sistema',
            tipoVenta: 'habitacion',
            concepto: titleConcept,
            total: amountCharged,
            metodoPago: isExonerated ? 'N/A' : paymentMethod,
            habitacionId: roomToRelease.id,
            habitacionNombre: roomToRelease.nombre,
            clienteNombre: roomToRelease.cliente || 'Anónimo',
            observaciones: observation || "",
            horasAdicionales: horasAdicionales
          };
          onAddSale(checkoutSale);

          // Integrated print and cash drawer trigger for extra hours charge (offline path)
          if (!isExonerated) {
            if (paymentMethod === 'Efectivo') {
              try {
                await openCashDrawer(checkoutSaleId, amountCharged, 'Efectivo');
              } catch (e) {
                console.error("Fallo apertura cajon checkout (offline):", e);
              }
            }
            if (hotelSettings?.printOnExtraHours ?? true) {
              const receiptDataObj = {
                id: checkoutSaleId,
                fecha: now.toLocaleDateString('es-CO'),
                hora: formattedHora,
                employeeName: activeShift?.empleada || 'Sistema',
                turno: activeShift?.id || 'N/A',
                cliente: roomToRelease.cliente || 'Anónimo',
                habitacion: roomToRelease.nombre || roomToRelease.id,
                metodoPago: paymentMethod,
                total: amountCharged,
                concepto: `Cobro Horas Extras: Hab ${roomToRelease.nombre} (${horasAdicionales} hrs)`,
                tipo: 'Horas Adicionales'
              };
              try {
                await printReceipt(receiptDataObj);
              } catch (err) {
                console.error("Fallo auto-impresión horas extras (offline):", err);
              }
            }
          }
        } else {
          const checkoutSale: Sale = {
            id: checkoutSaleId,
            shiftId: activeShift?.id || 'no-shift',
            fecha: yyyymmdd,
            hora: formattedHora,
            createdAt: now.toISOString(),
            empleada: activeShift?.empleada || 'Sistema',
            tipoVenta: 'liberacion_habitacion',
            concepto: `Liberación: ${roomToRelease.nombre} - Checkout de ${roomToRelease.cliente || 'Anónimo'}`,
            total: 0,
            metodoPago: 'N/A',
            habitacionId: roomToRelease.id,
            habitacionNombre: roomToRelease.nombre,
            clienteNombre: roomToRelease.cliente || 'Anónimo',

            type: 'room_release',
            concept: `Liberación ${roomToRelease.nombre}`,
            roomId: roomToRelease.id,
            roomName: roomToRelease.nombre,
            clientName: roomToRelease.cliente || 'Anónimo',
            employeeName: activeShift?.empleada || 'Sistema',
            createdBy: userProfile?.uid || 'no-uid'
          };
          onAddSale(checkoutSale);
        }
      }

      const updatedRooms = safeRooms.map((r) => {
        const id = r.firestoreId || r.documentId || r.docId || r.id;

        if (id !== roomDocId) return r;

        return {
          ...r,
          ...releaseData,
          updatedAt: now.toISOString(),
          releasedAt: now.toISOString(),
          checkOutTime: now.toISOString()
        };
      });

      onUpdateRooms(updatedRooms);

      setShowReleaseConfirm(false);
      setRoomPendingRelease(null);
      setSelectedRoom(null);
      setShowDetailModal(false);

      alert("Habitación liberada correctamente.");
    } catch (error: any) {
      console.warn("Aviso al actualizar habitación en Firebase:", error);
      const errMsg = error?.message || String(error);
      setLastReleaseError(errMsg);
    } finally {
      setIsReleasingRoom(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-900 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Bed className="h-5 w-5 text-emerald-400" />
            <span>Habitaciones & Hospedajes</span>
          </h2>
          <p className="text-xs text-slate-400">Seleccione una habitación verde para ocuparla, o una roja para ver sus detalles de ocupación.</p>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <div className="w-3.5 h-3.5 bg-emerald-600 rounded-full border border-emerald-500/30" />
            <span className="text-emerald-400">Disponibles ({safeRooms.filter((r) => isRoomAvailable(r)).length})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3.5 h-3.5 bg-red-600 rounded-full border border-red-500/30" />
            <span className="text-red-400">Ocupadas ({safeRooms.filter((r) => isRoomOccupied(r)).length})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3.5 h-3.5 bg-slate-600 rounded-full border border-slate-500/30" />
            <span className="text-slate-400">Fuera servicio ({safeRooms.filter((r) => isRoomOutOfService(r)).length})</span>
          </div>
        </div>
      </div>

      {/* Grid containing rooms */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {safeRooms.map((room) => {
          const roomMeta = getRoomVisualMeta(room);
          const isOutOfService = isRoomOutOfService(room);
          const isOccupied = isRoomOccupied(room);
          const isAvailable = isRoomAvailable(room);
          return (
            <button
              key={room.id}
              onClick={() => {
                setSelectedRoom(room);
                if (isOutOfService) {
                  setShowDetailModal(true);
                  return;
                }
                if (isAvailable) {
                  // Reset form
                  const official = getOfficialRoomByAny(room);
                  if (official?.fueraServicio) { window.alert(`${official.nombre} está fuera de servicio y no se puede ocupar.`); return; }
                  // La tarifa se cobra por camas USADAS, no por camas físicas.
                  // Ejemplo: Hab 106 tiene 3 camas, pero puede cobrarse uso de 1, 2 o 3 camas.
                  const defaultConcept = getDefaultRoomConcept(room);
                  setConcepto(defaultConcept);
                  setDiasPagados(1);
                  setValorCobrado(calculateRoomCharge(room, 0, defaultConcept).total);
                  setDineroRecibido(0);
                  setValorTransferido(0);
                  setReferenciaTransferencia('');
                  setClienteNombre('');
                  setClienteCedula('');
                  setClienteCelular('');
                  setClienteCorreo('');
                  setClienteDireccion('');
                  setEsEmpresa(false);
                  setEmpresaNombre('');
                  setEmpresaNit('');
                  setTieneVehiculo(false);
                  setVehiculoPlaca('');
                  setVehiculoMarca('');
                  setVehiculoColor('');
                  setVehiculoObservacion('');
                  setAcompanantes([]);
                  setErrorMsg('');
                  setShowOcuparModal(true);
                } else {
                  setShowDetailModal(true);
                }
              }}
              className={`p-4 rounded-2xl text-left border flex flex-col justify-between min-h-48 transition-all active:scale-[0.98] ${
                isOutOfService
                  ? 'bg-slate-950/50 border-slate-700/60 text-slate-400 cursor-not-allowed opacity-80'
                  : isAvailable
                    ? 'bg-emerald-950/15 border-emerald-500/30 text-slate-100 hover:bg-emerald-950/25 hover:border-emerald-500/50'
                    : (() => {
                        const details = getCheckoutDetails(room);
                        return details.isOverdue
                          ? 'bg-amber-950/20 border-amber-500/40 text-slate-100 hover:bg-amber-950/30 hover:border-amber-500/60 shadow-lg shadow-amber-500/5'
                          : 'bg-red-950/15 border-red-500/30 text-slate-100 hover:bg-red-950/25 hover:border-red-500/50';
                      })()
              }`}
            >
              <div className="flex items-start justify-between w-full">
                <div className="bg-slate-900/60 p-2 rounded-xl text-slate-300">
                  {(() => {
                    const details = isOccupied ? getCheckoutDetails(room) : null;
                    const isOverdue = details ? details.isOverdue : false;
                    return (
                      <Bed className={`h-5 w-5 ${
                        isOutOfService ? 'text-slate-400' :
                        isAvailable ? 'text-emerald-400' : 
                        isOverdue ? 'text-amber-400 animate-bounce' : 'text-red-400'
                      }`} />
                    );
                  })()}
                </div>
                {(() => {
                  const details = isOccupied ? getCheckoutDetails(room) : null;
                  const isOverdue = details ? details.isOverdue : false;
                  return (
                    <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                      isOutOfService ? 'bg-slate-500/20 text-slate-300 border border-slate-500/30' :
                      isAvailable ? 'bg-emerald-500/20 text-emerald-300' :
                      isOverdue ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse' : 'bg-red-500/20 text-red-300'
                    }`}>
                      {isOutOfService ? 'Fuera servicio' : isAvailable ? 'Disponible' : isOverdue ? 'Checkout vencido' : 'Ocupada'}
                    </span>
                  );
                })()}
              </div>

              <div className="space-y-2">
                <div>
                  <h3 className="text-base font-black text-white tracking-tight leading-none mb-1">
                    {room.nombre}
                  </h3>
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    <span className={`text-[9px] px-2 py-0.5 rounded-full border font-black uppercase ${getRoomServiceBadgeClass(roomMeta.servicio)}`}>
                      {roomMeta.servicio}
                    </span>
                    <span className="text-[9px] px-2 py-0.5 rounded-full border border-slate-700 bg-slate-950 text-slate-200 font-black uppercase">
                      {roomMeta.camasTexto}
                    </span>
                    <span className="text-[9px] px-2 py-0.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 font-black uppercase">
                      Máx {roomMeta.capacidadMaxima}
                    </span>
                  </div>
                  {roomMeta.observacion && (
                    <p className="text-[9px] text-amber-300 font-bold uppercase leading-tight">{roomMeta.observacion}</p>
                  )}
                  {isOutOfService && (
                    <p className="text-[9px] text-red-300 font-black uppercase leading-tight">No se puede ocupar</p>
                  )}
                </div>
                {isAvailable ? (
                  <p className="text-[10px] text-emerald-400 font-bold">Presione para Ocupar</p>
                ) : (
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-red-400 truncate flex items-center gap-1">
                      <User className="h-2.5 w-2.5 shrink-0" />
                      <span>{room.cliente}</span>
                    </p>
                    <div className="flex justify-between items-center text-[9px] text-slate-500 font-mono">
                      <span>Ingreso: {room.horaIngreso}</span>
                      {(() => {
                        const details = getCheckoutDetails(room);
                        if (details.isOverdue && details.isNoche && details.extraHours > 0) {
                          return <span className="text-amber-400 font-bold">+{details.extraHours}h</span>;
                        }
                        return null;
                      })()}
                    </div>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Modal Ocupar y Cobrar */}
      {showOcuparModal && selectedRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col my-8 shadow-2xl">
            
            {/* Header */}
            <div className="border-b border-slate-850 px-6 py-4 flex justify-between items-center bg-slate-900/80 sticky top-0 z-10">
              <div className="space-y-2">
                <h3 className="text-base font-bold text-white">COBRAR Y OCUPAR — {selectedRoom.nombre}</h3>
                <p className="text-[11px] text-slate-400">Complete los datos de pago, cliente y vehículo para habilitar la habitación.</p>
                {(() => {
                  const meta = getRoomVisualMeta(selectedRoom);
                  return (
                    <div className="flex flex-wrap gap-1.5">
                      <span className={`text-[10px] px-2 py-1 rounded-full border font-black uppercase ${getRoomServiceBadgeClass(meta.servicio)}`}>
                        {meta.servicio}
                      </span>
                      <span className="text-[10px] px-2 py-1 rounded-full border border-slate-700 bg-slate-950 text-slate-200 font-black uppercase">
                        {meta.camasTexto}
                      </span>
                      <span className="text-[10px] px-2 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 font-black uppercase">
                        Capacidad máx. {meta.capacidadMaxima}
                      </span>
                      {meta.observacion && (
                        <span className="text-[10px] px-2 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300 font-black uppercase">
                          {meta.observacion}
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>
              <button
                onClick={() => {
                  setShowOcuparModal(false);
                  setSelectedRoom(null);
                }}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors bg-slate-800/40"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Form Fields */}
            <div className="p-6 space-y-6 flex-1 overflow-y-auto">
              
              {/* Section 1: Concept & Values */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-widest border-b border-slate-800 pb-1.5 flex items-center gap-1.5">
                  <Printer className="h-3.5 w-3.5" />
                  <span>1. Concepto, Habitación y Tarifa</span>
                </h4>

                {(() => {
                  const meta = getRoomVisualMeta(selectedRoom);
                  return (
                    <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] text-emerald-300 font-black uppercase tracking-widest">Habitación seleccionada</p>
                          <h5 className="text-base font-black text-white">{selectedRoom.nombre}</h5>
                          <p className="text-[11px] text-slate-300">
                            Esta habitación está registrada como <strong>{getRoomTypeText(selectedRoom)}</strong>.
                          </p>
                        </div>
                        <div className={`shrink-0 text-[10px] px-3 py-1 rounded-full border font-black uppercase ${getRoomServiceBadgeClass(meta.servicio)}`}>
                          {meta.servicio}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-xl bg-slate-950 border border-slate-800 p-2">
                          <p className="text-[9px] text-slate-500 font-bold uppercase">Camas</p>
                          <p className="text-sm font-black text-white">{meta.camasTexto}</p>
                        </div>
                        <div className="rounded-xl bg-slate-950 border border-slate-800 p-2">
                          <p className="text-[9px] text-slate-500 font-bold uppercase">Capacidad</p>
                          <p className="text-sm font-black text-indigo-300">{meta.capacidadTexto}</p>
                        </div>
                        <div className="rounded-xl bg-slate-950 border border-slate-800 p-2">
                          <p className="text-[9px] text-slate-500 font-bold uppercase">Tarifa</p>
                          <p className="text-sm font-black text-emerald-300">{formatCop(calculateRoomCharge(selectedRoom, 0, concepto).baseRate)}</p>
                        </div>
                      </div>
                      {meta.observacion && (
                        <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 px-3 py-2 text-[11px] text-amber-200 font-bold">
                          Observación de la habitación: {meta.observacion}
                        </div>
                      )}
                    </div>
                  );
                })()}
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-400 font-medium">Concepto permitido para esta habitación</label>
                    <select
                      value={concepto}
                      onChange={(e) => setConcepto(e.target.value)}
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                    >
                      {buildRoomTariffOptions(selectedRoom).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {canUseCoupleRate(selectedRoom) && isCoupleConcept(concepto) && (
                      <div className="mt-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100 font-bold">
                        Tarifa Pareja: {formatCop(getCoupleRateForRoom(selectedRoom))}. Incluye el primer acompañante sin cobro adicional.
                        Desde el segundo acompañante se cobra {formatCop(KODIAK_COMPANION_FEE)} c/u.
                      </div>
                    )}
                  </div>

                  {/* Stay days selector if not Rato */}
                  {(() => {
                    const isRato = (concepto || '').toLowerCase().includes('rato');
                    if (isRato) {
                      return (
                        <div className="space-y-1.5">
                          <label className="text-xs text-slate-400 font-medium">Modalidad Rato (3 Horas)</label>
                          <div className="rounded-xl bg-slate-950/80 border border-slate-800 px-3 py-2 text-xs text-slate-300">
                            Estadía de 3 horas continuas.
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center">
                          <label className="text-xs text-slate-400 font-medium">Días / Noches a Pagar</label>
                          {diasPagados >= 3 && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              10% DESCUENTO APLICADO
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            value={formatIntegerInput(diasPagados)}
                            onChange={(e) => {
                              const parsed = cleanIntegerInput(e.target.value);
                              setDiasPagados(Math.max(1, parsed));
                            }}
                            className="w-20 rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-bold text-center"
                            placeholder="1"
                          />
                          <div className="flex flex-wrap gap-1 flex-1">
                            {[1, 2, 3, 4, 5, 7].map((d) => (
                              <button
                                key={d}
                                type="button"
                                onClick={() => setDiasPagados(d)}
                                className={`px-2 py-1 text-[10px] font-bold rounded-lg border transition-all ${
                                  diasPagados === d
                                    ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                {d} {d === 1 ? 'día' : 'días'}{d >= 3 ? ' (-10%)' : ''}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Stay Billing Breakdown & Checkout Time */}
                {(() => {
                  const isRato = (concepto || '').toLowerCase().includes('rato');
                  const stayBilling = calculateRoomStayCharge(selectedRoom, acompanantes.length, concepto, diasPagados);
                  const now = new Date();
                  const checkoutDate = isRato
                    ? new Date(now.getTime() + 3 * 60 * 60 * 1000)
                    : buildCheckoutDateTime(now, diasPagados);
                  const salidaTexto = isRato
                    ? checkoutDate.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true })
                    : `${checkoutDate.toLocaleDateString('es-CO')} a las 12:00 p. m.`;

                  return (
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/90 p-4 space-y-3">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                        <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800">
                          <p className="text-[10px] text-slate-500 uppercase font-bold">Tarifa Diaria</p>
                          <p className="font-extrabold text-white">{formatCop(stayBilling.dailyRate)}</p>
                        </div>
                        <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800">
                          <p className="text-[10px] text-slate-500 uppercase font-bold">{isRato ? 'Modalidad' : 'Días'}</p>
                          <p className="font-extrabold text-indigo-300">{isRato ? '3 horas' : `${stayBilling.days} ${stayBilling.days === 1 ? 'día' : 'días'}`}</p>
                        </div>
                        <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800">
                          <p className="text-[10px] text-slate-500 uppercase font-bold">Subtotal</p>
                          <p className="font-extrabold text-slate-300">{formatCop(stayBilling.subtotal)}</p>
                        </div>
                        <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800">
                          <p className="text-[10px] text-slate-500 uppercase font-bold">Total a Cobrar</p>
                          <p className="font-extrabold text-emerald-400 text-sm">{formatCop(stayBilling.total)}</p>
                        </div>
                      </div>

                      {stayBilling.discountPercentage > 0 && (
                        <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 font-bold">
                          <div className="flex items-center gap-1.5">
                            <span className="bg-emerald-500 text-slate-950 text-[10px] px-1.5 py-0.5 rounded font-black">10% OFF</span>
                            <span>Descuento por estadía prolongada ({stayBilling.days} días)</span>
                          </div>
                          <span>- {formatCop(stayBilling.discountAmount)}</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-blue-500/10 border border-blue-500/25 text-xs text-blue-200">
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-blue-400 shrink-0" />
                          <span className="font-medium">Salida programada oficial:</span>
                        </div>
                        <strong className="text-white font-mono">{salidaTexto}</strong>
                      </div>
                    </div>
                  );
                })()}

                {false && concepto === 'Otro' && (
                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-400 font-medium">Describa el concepto personalizado</label>
                    <input
                      type="text"
                      value={otroConcepto}
                      onChange={(e) => setOtroConcepto(e.target.value)}
                      placeholder="Ej. Hospedaje especial 2 días, etc."
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                )}
              </div>

              {/* Section 2: Method of payment */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-widest border-b border-slate-800 pb-1.5 flex items-center gap-1.5">
                  <Printer className="h-3.5 w-3.5" />
                  <span>2. Método de Pago</span>
                </h4>

                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => setMetodoPago('Efectivo')}
                    className={`flex-1 py-3 px-4 rounded-xl border text-xs font-bold transition-all ${
                      metodoPago === 'Efectivo'
                        ? 'bg-emerald-500/10 border-emerald-500 text-emerald-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-300'
                    }`}
                  >
                    EFECTIVO
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetodoPago('Transferencia')}
                    className={`flex-1 py-3 px-4 rounded-xl border text-xs font-bold transition-all ${
                      metodoPago === 'Transferencia'
                        ? 'bg-indigo-500/10 border-indigo-500 text-indigo-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-300'
                    }`}
                  >
                    TRANSFERENCIA
                  </button>
                </div>

                {/* Sub-form based on payment method */}
                {metodoPago === 'Efectivo' ? (
                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-850 space-y-3.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">Total a Pagar:</span>
                      <strong className="text-sm font-extrabold text-white">{formatCop(valorCobrado)}</strong>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] text-slate-400 font-medium block">Dinero Físico Recibido (COP)</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={formatCurrencyInput(dineroRecibido)}
                        onChange={(e) => setDineroRecibido(parseCurrencyInput(e.target.value))}
                        placeholder="Ej. 50.000"
                        className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
                      />
                    </div>
                    {dineroRecibido >= valorCobrado ? (
                      <div className="flex justify-between text-xs text-emerald-400 font-semibold pt-1 border-t border-slate-900">
                        <span>Vueltos / Cambio a entregar:</span>
                        <span className="font-mono">{formatCop(dineroRecibido - valorCobrado)}</span>
                      </div>
                    ) : (
                      <div className="flex justify-between text-xs text-amber-500 font-semibold pt-1 border-t border-slate-900">
                        <span>Faltante por entregar:</span>
                        <span className="font-mono">{formatCop(valorCobrado - dineroRecibido)}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-850 space-y-3.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">Total a Pagar:</span>
                      <strong className="text-sm font-extrabold text-white">{formatCop(valorCobrado)}</strong>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-slate-400 font-medium block">Valor Transferido (COP)</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={formatCurrencyInput(valorTransferido)}
                          onChange={(e) => setValorTransferido(parseCurrencyInput(e.target.value))}
                          placeholder="Ej. 50.000"
                          className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-slate-400 font-medium block">Nro. de Referencia (Nequi, Davi, etc)</label>
                        <input
                          type="text"
                          value={referenciaTransferencia}
                          onChange={(e) => setReferenciaTransferencia(e.target.value)}
                          placeholder="Código o número"
                          className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Section 3: Customer search & profile */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-widest border-b border-slate-800 pb-1.5 flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5" />
                  <span>3. Datos del Cliente</span>
                </h4>

                {/* Autocomplete Finder */}
                <div className="relative">
                  <label className="text-[10px] text-slate-400 font-bold block mb-1 uppercase tracking-wide">Buscar Cliente Existente</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={clientSearchTerm}
                      onChange={(e) => {
                        setClientSearchTerm(e.target.value);
                        setShowClientDropdown(true);
                      }}
                      onFocus={() => setShowClientDropdown(true)}
                      placeholder="Ingrese nombre, cédula, celular, o placa para buscar..."
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 pl-9 pr-4 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                    />
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  </div>

                  {showClientDropdown && filteredClients.length > 0 && (
                    <div className="absolute z-30 left-0 right-0 mt-1 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl max-h-48 overflow-y-auto">
                      {filteredClients.map((client) => (
                        <button
                          key={client.id}
                          type="button"
                          onClick={() => selectClientFromSearch(client)}
                          className="w-full px-4 py-2.5 text-left text-xs hover:bg-slate-900 border-b border-slate-900 flex justify-between items-center"
                        >
                          <div>
                            <span className="font-bold text-slate-200 block">{client.nombre}</span>
                            <span className="text-[10px] text-slate-500 font-mono">C.C. {client.cedula} • Tel: {client.celular}</span>
                          </div>
                          <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded">
                            Placa: {client.placa}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Main Client Profile inputs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-400 font-medium">Nombre Completo del Cliente *</label>
                    <input
                      type="text"
                      value={clienteNombre}
                      onChange={(e) => setClienteNombre(e.target.value)}
                      placeholder="Ej. Jhon Alberto Valencia"
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-400 font-medium">Cédula de Ciudadanía *</label>
                    <input
                      type="text"
                      value={clienteCedula}
                      onChange={(e) => setClienteCedula(e.target.value)}
                      placeholder="Ej. 10987654"
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-400 font-medium">Nro. de Celular *</label>
                    <input
                      type="text"
                      value={clienteCelular}
                      onChange={(e) => setClienteCelular(e.target.value)}
                      placeholder="Ej. 3123456789"
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-400 font-medium">Correo Electrónico *</label>
                    <input
                      type="email"
                      value={clienteCorreo}
                      onChange={(e) => setClienteCorreo(e.target.value)}
                      placeholder="Ej. cliente@gmail.com"
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-xs text-slate-400 font-medium">Dirección Física de Residencia *</label>
                    <input
                      type="text"
                      value={clienteDireccion}
                      onChange={(e) => setClienteDireccion(e.target.value)}
                      placeholder="Dirección, calle, ciudad"
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                {/* Optional companion guests */}
                <div className="space-y-3.5 bg-slate-950/40 p-4 rounded-xl border border-slate-900">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <span className="text-xs font-semibold text-slate-300 block">¿Ingresa con acompañante / otra persona?</span>
                      <span className="text-[10px] text-slate-500">
                        Cada acompañante adicional cuesta {formatCop(KODIAK_COMPANION_FEE)}. En tarifa Pareja, el primer acompañante está incluido sin cargo. La capacidad incluye al cliente principal.
                      </span>
                    </div>

                    {(() => {
                      const capacidadMaxima = Number(getRoomCapacity(selectedRoom) || 0);
                      const personasRegistradas = 1 + acompanantes.length;
                      const maxAcompanantes = Math.max(0, capacidadMaxima - 1);
                      const limiteAlcanzado = personasRegistradas >= capacidadMaxima;

                      return (
                        <button
                          type="button"
                          onClick={addAcompanante}
                          disabled={limiteAlcanzado}
                          className={`px-3 py-2 rounded-xl text-[11px] font-bold transition-colors ${
                            limiteAlcanzado
                              ? 'bg-slate-800/70 border border-slate-700 text-slate-500 cursor-not-allowed'
                              : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                          }`}
                          title={
                            limiteAlcanzado
                              ? `Capacidad máxima alcanzada. Esta habitación permite ${capacidadMaxima} persona(s).`
                              : `Agregar acompañante. Máximo permitido: ${maxAcompanantes}.`
                          }
                        >
                          {limiteAlcanzado
                            ? `Capacidad llena (${personasRegistradas}/${capacidadMaxima})`
                            : '+ Agregar acompañante'}
                        </button>
                      );
                    })()}
                  </div>

                  {acompanantes.length > 0 && (
                    <div className="space-y-3 pt-2">
                      {acompanantes.map((acompanante, index) => (
                        <div key={acompanante.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-3 space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wide">
                              Acompañante #{index + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeAcompanante(acompanante.id)}
                              className="text-[10px] text-red-300 hover:text-red-200 font-bold"
                            >
                              Quitar
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-[10px] text-slate-400 font-medium">Nombre completo *</label>
                              <input
                                type="text"
                                value={acompanante.nombre}
                                onChange={(e) => updateAcompanante(acompanante.id, 'nombre', e.target.value)}
                                placeholder="Ej. MARÍA PÉREZ"
                                className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] text-slate-400 font-medium">Cédula *</label>
                              <input
                                type="text"
                                value={acompanante.cedula}
                                onChange={(e) => updateAcompanante(acompanante.id, 'cedula', e.target.value)}
                                placeholder="Ej. 10987654"
                                className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] text-slate-400 font-medium">Celular opcional</label>
                              <input
                                type="text"
                                value={acompanante.celular || ''}
                                onChange={(e) => updateAcompanante(acompanante.id, 'celular', e.target.value)}
                                placeholder="Si lo conoce"
                                className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] text-slate-400 font-medium">Parentesco / relación</label>
                              <input
                                type="text"
                                value={acompanante.parentesco || ''}
                                onChange={(e) => updateAcompanante(acompanante.id, 'parentesco', e.target.value)}
                                placeholder="Pareja, familiar, amigo..."
                                className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                              />
                            </div>
                            <div className="space-y-1 sm:col-span-2">
                              <label className="text-[10px] text-slate-400 font-medium">Observación opcional</label>
                              <input
                                type="text"
                                value={acompanante.observacion || ''}
                                onChange={(e) => updateAcompanante(acompanante.id, 'observacion', e.target.value)}
                                placeholder="Ej. Ingresó con el cliente principal"
                                className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {(() => {
                  const capacidadMaxima = Number(getRoomCapacity(selectedRoom) || 0);
                  const personasRegistradas = 1 + acompanantes.length;
                  const maxAcompanantes = Math.max(0, capacidadMaxima - 1);
                  const limiteAlcanzado = personasRegistradas >= capacidadMaxima;
                  const billingActual = calculateRoomCharge(selectedRoom, acompanantes.length, concepto);
                  const cargoAcompanantesActual = billingActual.companionCharge;
                  const acompanantesSinCargo = isCoupleConcept(concepto) && canUseCoupleRate(selectedRoom)
                    ? Math.min(1, acompanantes.length)
                    : 0;

                  return (
                    <div
                      className={`rounded-2xl border p-3 text-xs ${
                        limiteAlcanzado
                          ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                          : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <div>
                          <p className="font-bold">
                            Personas registradas: <strong>{personasRegistradas}</strong> / <strong>{capacidadMaxima}</strong>
                          </p>
                          <p className="text-[11px] opacity-80">
                            Cliente principal incluido. Máximo acompañantes permitidos: <strong>{maxAcompanantes}</strong>.
                          </p>
                        </div>

                        <div className="text-left sm:text-right">
                          <p>Acompañante adicional: <strong>{formatCop(KODIAK_COMPANION_FEE)}</strong> c/u</p>
                          {acompanantesSinCargo > 0 && (
                            <p className="text-amber-200">Pareja incluye sin cargo: <strong>{acompanantesSinCargo}</strong></p>
                          )}
                          <p>Cargo acompañantes: <strong>{formatCop(cargoAcompanantesActual)}</strong></p>
                          <p>Total actual: <strong>{formatCop(valorCobrado)}</strong></p>
                        </div>
                      </div>

                      {limiteAlcanzado && (
                        <div className="mt-2 rounded-xl bg-amber-950/40 border border-amber-500/20 px-3 py-2 text-[11px] font-bold">
                          ⚠️ Capacidad máxima alcanzada. No puede agregar más acompañantes en esta habitación.
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Business invoice toggle */}
                <div className="space-y-3.5 bg-slate-950/40 p-4 rounded-xl border border-slate-900">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-semibold text-slate-300 block">¿Facturar a Nombre de Empresa?</span>
                      <span className="text-[10px] text-slate-500">Habilite para registrar NIT corporativo</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEsEmpresa(!esEmpresa)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        esEmpresa ? 'bg-emerald-600' : 'bg-slate-800'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          esEmpresa ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {esEmpresa && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-slate-400">Razón Social / Empresa *</label>
                        <input
                          type="text"
                          value={empresaNombre}
                          onChange={(e) => setEmpresaNombre(e.target.value)}
                          placeholder="Ej. Inversiones S.A."
                          className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-slate-400">NIT de la Empresa *</label>
                        <input
                          type="text"
                          value={empresaNit}
                          onChange={(e) => setEmpresaNit(e.target.value)}
                          placeholder="Ej. 900.123.456-1"
                          className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Section 4: Vehicle profile */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-widest border-b border-slate-800 pb-1.5 flex items-center gap-1.5">
                  <Navigation className="h-3.5 w-3.5" />
                  <span>4. Datos del Vehículo</span>
                </h4>

                <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-3 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-slate-200 block">¿Trae vehículo?</span>
                    <span className="text-[10px] text-slate-500">Si marca No, no se exige placa ni datos del vehículo.</span>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setTieneVehiculo(true)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${tieneVehiculo ? 'bg-emerald-500/10 border-emerald-500 text-emerald-300' : 'bg-slate-950 border-slate-800 text-slate-400'}`}>Sí</button>
                    <button type="button" onClick={() => { setTieneVehiculo(false); setVehiculoPlaca(''); setVehiculoMarca(''); setVehiculoColor(''); setVehiculoObservacion(''); }} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${!tieneVehiculo ? 'bg-red-500/10 border-red-500 text-red-300' : 'bg-slate-950 border-slate-800 text-slate-400'}`}>No tiene</button>
                  </div>
                </div>

                {tieneVehiculo && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-400 font-medium">Tipo de Vehículo *</label>
                    <select
                      value={tipoVehiculo}
                      onChange={(e) => setTipoVehiculo(e.target.value as VehicleType)}
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none"
                    >
                      <option value="Moto">Moto</option>
                      <option value="Carro">Carro</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-400 font-medium">Placa del Vehículo *</label>
                    <input
                      type="text"
                      value={vehiculoPlaca}
                      onChange={(e) => setVehiculoPlaca(e.target.value.toUpperCase())}
                      placeholder="Ej. AAA12C o S/P"
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white uppercase font-mono focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-400 font-medium">Marca del Vehículo *</label>
                    <input
                      type="text"
                      value={vehiculoMarca}
                      onChange={(e) => setVehiculoMarca(e.target.value)}
                      placeholder="Ej. Yamaha, Chevrolet"
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-400 font-medium">Color *</label>
                    <input
                      type="text"
                      value={vehiculoColor}
                      onChange={(e) => setVehiculoColor(e.target.value)}
                      placeholder="Ej. Negro Mate, Rojo"
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-xs text-slate-400 font-medium">Observación de Seguridad del Vehículo *</label>
                    <input
                      type="text"
                      value={vehiculoObservacion}
                      onChange={(e) => setVehiculoObservacion(e.target.value)}
                      placeholder="Ej. Tiene rayones en tanque, sin espejos, casco amarrado"
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none"
                    />
                  </div>
                </div>
                )}
              </div>

            </div>

            {/* Sticky Actions Footer */}
            <div className="border-t border-slate-850 p-4 bg-slate-900/90 flex flex-col gap-3 sticky bottom-0 z-10">
              {errorMsg && (
                <div className="text-xs bg-red-500/10 border border-red-500/20 text-red-200 px-3 py-2 rounded-xl font-medium">
                  ⚠️ {errorMsg}
                </div>
              )}
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowOcuparModal(false);
                    setSelectedRoom(null);
                  }}
                  className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmOcupar}
                  className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs py-2 px-5 rounded-xl flex items-center gap-1 shadow-lg shadow-emerald-500/10 active:scale-[0.98] transition-all"
                >
                  <CheckCircle className="h-4 w-4" />
                  <span>CONFIRMAR PAGO Y OCUPAR</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Modal Ver Detalle de Habitación Ocupada */}
      {showDetailModal && selectedRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-[720px] max-h-[90vh] overflow-y-auto flex flex-col shadow-2xl">
            
            {/* Header */}
            <div className="border-b border-slate-850 px-6 py-4 flex justify-between items-center bg-slate-900 sticky top-0 z-10">
              <div className="flex items-center gap-2.5">
                <div className={`p-2 rounded-xl ${
                  isRoomOutOfService(selectedRoom)
                    ? 'bg-slate-500/10 border border-slate-500/20 text-slate-300'
                    : 'bg-red-500/10 border border-red-500/20 text-red-400'
                }`}>
                  <Bed className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">DETALLE DE {selectedRoom.nombre}</h3>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border uppercase font-bold tracking-wider ${
                    isRoomOutOfService(selectedRoom)
                      ? 'bg-slate-500/20 text-slate-300 border-slate-500/30'
                      : 'bg-red-500/20 text-red-300 border-red-500/30'
                  }`}>
                    Estado: {isRoomOutOfService(selectedRoom) ? 'Fuera de servicio' : 'Hospedado'}
                  </span>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowDetailModal(false);
                  setSelectedRoom(null);
                }}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors bg-slate-800/40"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Detail content */}
            <div className="p-6 space-y-6 flex-1 overflow-y-auto">
              
              {isRoomOutOfService(selectedRoom) && (
                <div className="bg-slate-500/10 border border-slate-500/30 rounded-2xl p-4 flex items-start gap-3 text-slate-300">
                  <AlertTriangle className="h-5 w-5 shrink-0 text-slate-300 mt-0.5" />
                  <div>
                    <h4 className="font-extrabold text-xs uppercase tracking-wider text-slate-200">Habitación fuera de servicio</h4>
                    <p className="text-[11px] text-slate-300 leading-normal mt-1">
                      Esta habitación está marcada como fuera de servicio en el catálogo oficial del Hotel Kodiak. No se puede ocupar ni liberar.
                    </p>
                  </div>
                </div>
              )}


              {/* Overdue alert banner if checkout is overdue */}
              {(() => {
                const details = getCheckoutDetails(selectedRoom);
                if (!isRoomOutOfService(selectedRoom) && details.isOverdue) {
                  return (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-start gap-3 text-amber-300">
                      <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
                      <div>
                        <h4 className="font-extrabold text-xs uppercase tracking-wider text-amber-400">Checkout Vencido</h4>
                        <p className="text-[11px] text-slate-300 leading-normal mt-1">
                          El huésped ha excedido la hora de salida programada ({selectedRoom.salidaProgramada || '12:00 p. m.'}). 
                          {details.isNoche && details.extraHours > 0 ? (
                            <span> Se deben cobrar <strong>{details.extraHours}</strong> {details.extraHours === 1 ? 'hora adicional' : 'horas adicionales'} a la tarifa configurable (Total extra: <strong>{formatCop(details.extraHoursCost)}</strong>).</span>
                          ) : details.isNoche ? (
                            <span> La salida vence a las 12:00 p. m.; después de esa hora comienza el cobro de horas adicionales.</span>
                          ) : null}
                        </p>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              {/* Box: Hospedaje summary */}
              <div className="grid grid-cols-2 gap-4 bg-slate-950 p-4 rounded-2xl border border-slate-850">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">Concepto</span>
                  <span className="text-xs text-white font-medium">{selectedRoom.concepto || 'Por definir'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">Valor Cobrado</span>
                  <span className="text-xs text-emerald-400 font-bold">{formatCop(selectedRoom.valorCobrado || 0)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">Método de Pago</span>
                  <span className="text-xs text-slate-300 font-medium">{selectedRoom.metodoPago || 'No registrado'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">Empleada Registra</span>
                  <span className="text-xs text-slate-300 font-medium">{getEmployeeFullName(selectedRoom.empleada) || 'No asignada'}</span>
                </div>
                <div className="col-span-2 grid grid-cols-3 gap-2 border-t border-slate-900 pt-3">
                  <div>
                    <span className="text-[9px] text-slate-500 uppercase block">Hora Ingreso</span>
                    <span className="text-xs text-slate-400 font-medium">{selectedRoom.horaIngreso || '-'}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-500 uppercase block">Fecha Ingreso</span>
                    <span className="text-xs text-slate-400 font-medium">{selectedRoom.fechaIngreso || '-'}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-500 uppercase block">Salida Est.</span>
                    <span className="text-xs text-slate-400 font-medium">{selectedRoom.salidaProgramada || '-'}</span>
                  </div>
                </div>
              </div>

              {/* Client detailed panel */}
              {selectedRoom.clienteDetails && (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-widest border-b border-slate-800 pb-1.5 flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" />
                    <span>Datos del Cliente Registrado</span>
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-xs bg-slate-950/40 p-4 rounded-xl border border-slate-900">
                    <div>
                      <span className="text-[10px] text-slate-500 font-bold block">Nombre Completo</span>
                      <span className="text-slate-200">{selectedRoom.clienteDetails.nombre}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 font-bold block">Cédula</span>
                      <span className="text-slate-200 font-mono">{selectedRoom.clienteDetails.cedula}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 font-bold block">Celular</span>
                      <span className="text-slate-200">{selectedRoom.clienteDetails.celular}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 font-bold block">Correo</span>
                      <span className="text-slate-200 truncate">{selectedRoom.clienteDetails.correo}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-[10px] text-slate-500 font-bold block">Dirección</span>
                      <span className="text-slate-300">{selectedRoom.clienteDetails.direccion}</span>
                    </div>

                    {selectedRoom.clienteDetails.esEmpresa && (
                      <div className="col-span-2 pt-2 border-t border-slate-900 grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-[10px] text-amber-500 font-bold block">Empresa</span>
                          <span className="text-slate-300 font-medium">{selectedRoom.clienteDetails.empresa}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-amber-500 font-bold block">NIT de Empresa</span>
                          <span className="text-slate-300 font-mono">{selectedRoom.clienteDetails.nit}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Companion guests panel */}
              {(((selectedRoom as any).acompanantes && (selectedRoom as any).acompanantes.length > 0) ||
                (selectedRoom.clienteDetails?.acompanantes && selectedRoom.clienteDetails.acompanantes.length > 0)) && (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-widest border-b border-slate-800 pb-1.5 flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" />
                    <span>Acompañantes Registrados</span>
                  </h4>
                  <div className="space-y-2 text-xs bg-slate-950/40 p-4 rounded-xl border border-slate-900">
                    {((selectedRoom as any).acompanantes || selectedRoom.clienteDetails?.acompanantes || []).map((acompanante: CompanionGuest, index: number) => (
                      <div key={acompanante.id || index} className="rounded-xl border border-slate-800 bg-slate-950 p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <span className="text-[10px] text-slate-500 font-bold block">Nombre</span>
                          <span className="text-slate-200">{acompanante.nombre || '-'}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 font-bold block">Cédula</span>
                          <span className="text-slate-200 font-mono">{acompanante.cedula || '-'}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 font-bold block">Celular</span>
                          <span className="text-slate-300">{acompanante.celular || 'No registrado'}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 font-bold block">Relación</span>
                          <span className="text-slate-300">{acompanante.parentesco || 'Acompañante'}</span>
                        </div>
                        {acompanante.observacion && (
                          <div className="sm:col-span-2">
                            <span className="text-[10px] text-slate-500 font-bold block">Observación</span>
                            <span className="text-amber-300 italic">"{acompanante.observacion}"</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Vehicle detailed panel */}
              {selectedRoom.clienteDetails && (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-widest border-b border-slate-800 pb-1.5 flex items-center gap-1.5">
                    <Navigation className="h-3.5 w-3.5" />
                    <span>Novedades del Vehículo</span>
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-xs bg-slate-950/40 p-4 rounded-xl border border-slate-900">
                    <div>
                      <span className="text-[10px] text-slate-500 font-bold block">Tipo</span>
                      <span className="text-slate-200">{selectedRoom.clienteDetails.tipoVehiculo}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 font-bold block">Placa</span>
                      <span className="text-slate-200 font-mono uppercase font-bold text-emerald-400">{selectedRoom.clienteDetails.placa}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 font-bold block">Marca / Línea</span>
                      <span className="text-slate-200">{selectedRoom.clienteDetails.marca}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 font-bold block">Color</span>
                      <span className="text-slate-200">{selectedRoom.clienteDetails.color}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-[10px] text-slate-500 font-bold block">Observaciones</span>
                      <span className="text-amber-300 italic">"{selectedRoom.clienteDetails.observacionVehiculo}"</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Diagnóstico de Liberación */}
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-[11px] font-mono space-y-1.5 text-slate-400">
                <div className="text-xs font-bold text-red-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  <span>DIAGNÓSTICO LIBERACIÓN</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                  <div><span className="text-slate-600 font-bold">room.id:</span> {selectedRoom.id}</div>
                  <div><span className="text-slate-600 font-bold">firestoreId:</span> {selectedRoom.firestoreId || "no definido"}</div>
                  <div><span className="text-slate-600 font-bold">documentId:</span> {selectedRoom.documentId || "no definido"}</div>
                  <div><span className="text-slate-600 font-bold">docId:</span> {selectedRoom.docId || "no definido"}</div>
                  <div><span className="text-slate-600 font-bold">status actual:</span> {selectedRoom.status || "no definido"}</div>
                  <div><span className="text-slate-600 font-bold">estado actual:</span> {selectedRoom.estado}</div>
                  <div><span className="text-slate-600 font-bold">isOccupied actual:</span> {String(selectedRoom.isOccupied)}</div>
                  <div><span className="text-slate-600 font-bold">rol actual:</span> {userProfile?.rol || "no definido"}</div>
                  <div className="col-span-1 sm:col-span-2"><span className="text-slate-600 font-bold">UID usuario actual:</span> {auth?.currentUser?.uid || "no logueado"}</div>
                </div>
                {lastReleaseError && (
                  <div className="mt-2 text-red-400 bg-red-950/20 p-2 rounded-lg border border-red-900/30 font-semibold break-all text-[10px]">
                    ⚠️ Último error de liberación: {lastReleaseError}
                  </div>
                )}
              </div>

            </div>

            {/* Actions */}
            <div className="border-t border-slate-850 p-4 bg-slate-900/90 flex justify-between gap-3 sticky bottom-0 z-10">
              <button
                type="button"
                onClick={() => {
                  setShowDetailModal(false);
                  setSelectedRoom(null);
                }}
                className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
              >
                Cerrar Detalle
              </button>
              {(userProfile?.rol === 'admin' || userProfile?.rol === 'recepcionista') && !isRoomOutOfService(selectedRoom) && isRoomOccupied(selectedRoom) && (
                <button
                  type="button"
                  disabled={isReleasingRoom}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    console.log("Liberando habitación:", selectedRoom);

                    const roomToRelease = selectedRoom;

                    if (roomToRelease) {
                      setRoomPendingRelease(roomToRelease);
                      setReleaseActionType('cobrar');
                      setReleasePaymentMethod('Efectivo');
                      setReleaseCashReceived(0);
                      setReleaseObservation('');
                      setShowReleaseConfirm(true);
                    } else {
                      alert("ERROR: No se pudo determinar qué habitación liberar.");
                    }
                  }}
                  className="bg-red-600 hover:bg-red-500 text-white font-semibold text-xs py-2 px-5 rounded-xl flex items-center gap-1.5 active:scale-[0.98] transition-all shadow-lg shadow-red-500/10 disabled:opacity-50 pointer-events-auto relative z-20"
                >
                  <AlertTriangle className="h-4 w-4" />
                  <span>{isReleasingRoom ? "LIBERANDO..." : "LIBERAR HABITACIÓN"}</span>
                </button>
              )}
            </div>

          </div>
        </div>
      )}

      {/* Bill receipt prompt modal */}
      {showReceipt && receiptData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-sm">
          <div className="bg-white text-slate-900 border border-slate-300 rounded-2xl w-full max-w-sm overflow-hidden p-6 shadow-2xl flex flex-col items-center animate-in fade-in zoom-in duration-150">
            
            {/* Real printer status indicator */}
            {(() => {
              const status = getPrinterStatus();
              const isRealHardware = status.connected && status.type === 'escpos';
              if (isRealHardware) {
                return (
                  <div className="w-full mb-4 px-3 py-2.5 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 text-[11px] flex items-center gap-1.5 font-medium leading-snug">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
                    <span>Impresora conectada. Impresión ESC/POS real activa.</span>
                  </div>
                );
              } else {
                return (
                  <div className="w-full mb-4 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-100 text-amber-850 text-[11px] flex flex-col gap-1 font-medium leading-snug">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500 flex-shrink-0" />
                      <span>Impresión desde navegador. Confirme la impresora en la ventana de impresión.</span>
                    </div>
                    <span className="text-[10px] text-amber-700/90 pl-4">Modo web: el cajón no se abre desde el navegador. Use modo hardware real o app de escritorio.</span>
                  </div>
                );
              }
            })()}

            {/* Real receipt thermal visualizer */}
            <div id="receipt-print-area" className="w-full font-mono text-xs border border-dashed border-slate-400 p-4 bg-stone-50 rounded-lg text-slate-850 flex flex-col gap-1 select-all relative overflow-hidden">
              <div className="text-center font-bold text-sm border-b border-dashed border-slate-400 pb-1.5 uppercase">
                {receiptData.hotel}
              </div>
              <div className="text-center text-[10px] text-slate-500 mb-2">
                NIT: {receiptData.nit} <br />
                Cl. 37 #64-29, El Retén, Barrancabermeja, Santander <br />
                Tel: 3117000942
              </div>
              
              <div className="flex justify-between text-[10px]">
                <span>Fecha: {receiptData.fecha}</span>
                <span>Hora: {receiptData.hora}</span>
              </div>
              <div className="flex justify-between text-[10px] border-b border-dashed border-slate-400 pb-1.5 mb-2">
                <span>Turno: {receiptData.turno.substring(0, 8)}</span>
                <span>Atendido: {receiptData.empleada}</span>
              </div>

              {(() => {
                const empresaRecibo = String(
                  receiptData.empresaNombre ||
                  receiptData.empresa ||
                  receiptData.nombreEmpresa ||
                  receiptData.razonSocial ||
                  receiptData.companyName ||
                  receiptData.clienteDetails?.empresaNombre ||
                  receiptData.clienteDetails?.empresa ||
                  ''
                ).trim();
                const nitEmpresaRecibo = String(
                  receiptData.nitEmpresa ||
                  receiptData.empresaNit ||
                  receiptData.nitFacturacion ||
                  receiptData.companyNit ||
                  receiptData.clientNit ||
                  receiptData.clienteDetails?.nitEmpresa ||
                  receiptData.clienteDetails?.empresaNit ||
                  receiptData.clienteDetails?.nit ||
                  ''
                ).trim();
                const debeMostrar = Boolean(
                  empresaRecibo ||
                  nitEmpresaRecibo ||
                  receiptData.facturarEmpresa ||
                  receiptData.facturarAEmpresa ||
                  receiptData.esEmpresa
                );

                if (!debeMostrar) return null;

                return (
                  <div className="border-b border-dashed border-slate-400 pb-1.5 mb-2 text-[10px]">
                    <div className="font-bold uppercase">FACTURAR A EMPRESA</div>
                    {empresaRecibo && <div>Empresa: {empresaRecibo}</div>}
                    {nitEmpresaRecibo && <div>NIT Empresa: {nitEmpresaRecibo}</div>}
                  </div>
                );
              })()}

              <div className="font-bold border-b border-dashed border-slate-400 pb-1 mb-2 text-[10px]">
                CONCEPTO DE CARGO
              </div>
              <div className="flex justify-between">
                <span>Hospedaje {receiptData.habitacion}</span>
                <span className="font-bold">{formatCop(receiptData.valor)}</span>
              </div>
              <div className="text-[10px] text-slate-500 pl-2">
                Concepto: {receiptData.concepto}
              </div>
              {receiptData.diasPagados && Number(receiptData.diasPagados) > 1 && (
                <div className="text-[10px] text-slate-600 pl-2 space-y-0.5 mt-1">
                  <div>Estadía: {receiptData.diasPagados} días / noches</div>
                  {receiptData.tarifaDiaria && <div>Tarifa diaria: {formatCop(receiptData.tarifaDiaria)}</div>}
                  {receiptData.subtotalSinDescuento && <div>Subtotal: {formatCop(receiptData.subtotalSinDescuento)}</div>}
                  {receiptData.descuentoEstadiaLarga && Number(receiptData.descuentoEstadiaLarga) > 0 && (
                    <div className="font-bold text-emerald-700">Descuento 10% (3+ días): -{formatCop(receiptData.descuentoEstadiaLarga)}</div>
                  )}
                </div>
              )}
              {receiptData.salidaProgramada && (
                <div className="text-[10px] text-slate-700 pl-2 font-bold mt-1">
                  Salida programada: {receiptData.salidaProgramada}
                </div>
              )}
              {receiptData.acompanantes && receiptData.acompanantes.length > 0 && (
                <div className="text-[10px] text-slate-600 pl-2 mt-1">
                  Personas: {receiptData.numeroPersonas || (1 + receiptData.acompanantes.length)}<br />
                  Acompañantes: {receiptData.acompanantes.map((a: CompanionGuest) => `${a.nombre} C.C. ${a.cedula}`).join(' / ')}
                </div>
              )}
              
              <div className="border-t border-dashed border-slate-400 pt-1.5 mt-3 space-y-1">
                <div className="flex justify-between font-bold text-xs">
                  <span>TOTAL A PAGAR:</span>
                  <span>{formatCop(receiptData.valor)}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span>Método Pago:</span>
                  <span>{receiptData.metodo}</span>
                </div>
                {receiptData.metodo === 'Efectivo' && (
                  <>
                    <div className="flex justify-between text-[10px]">
                      <span>Efectivo Recibido:</span>
                      <span>{formatCop(receiptData.recibido)}</span>
                    </div>
                    <div className="flex justify-between text-[10px] font-bold text-emerald-600">
                      <span>Vueltos / Cambio:</span>
                      <span>{formatCop(receiptData.cambio)}</span>
                    </div>
                  </>
                )}
              </div>

              <div className="border-t border-dashed border-slate-400 mt-4 pt-2 text-center text-[10px] text-slate-500 italic">
                Gracias por elegir Hotel Kodiak.<br />
                ¡Feliz estadía!
              </div>
            </div>

            {/* Trigger buttons */}
            <div className="mt-6 flex gap-3.5 w-full">
              <button
                type="button"
                onClick={() => {
                  setShowReceipt(false);
                  setReceiptData(null);
                }}
                className="flex-1 py-2 px-3 border border-slate-300 rounded-xl text-slate-600 hover:text-slate-900 text-xs font-bold transition-colors text-center"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await printReceipt(receiptData);
                  } catch (err) {
                    console.error("Fallo reimpresión manual:", err);
                    alert("No se pudo enviar la orden real a la impresora. Revise conexión USB, permisos del navegador o use la app de escritorio.");
                  }
                }}
                className="flex-1 py-2.5 px-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>Reimprimir Recibo</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Custom Release Confirmation Dialog */}
      {showReleaseConfirm && roomPendingRelease && (() => {
        const details = getCheckoutDetails(roomPendingRelease);
        const hasExtraHours = details.isOverdue && details.isNoche && details.extraHours > 0;

        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md overflow-y-auto">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg p-6 shadow-2xl flex flex-col gap-5 animate-in fade-in zoom-in duration-200">
              
              {/* Header */}
              <div className="flex items-center gap-3 border-b border-slate-850 pb-3">
                <div className={`p-2.5 rounded-xl ${hasExtraHours ? 'bg-amber-500/10 border border-amber-500/25 text-amber-400' : 'bg-red-500/10 border border-red-500/25 text-red-400'}`}>
                  <AlertTriangle className={`h-5 w-5 ${hasExtraHours ? 'animate-pulse' : ''}`} />
                </div>
                <div className="text-left">
                  <h3 className="text-base font-extrabold text-white">
                    {hasExtraHours ? 'Liquidación de Checkout Vencido' : 'Confirmar Liberación de Habitación'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Habitación: <strong className="text-white">{roomPendingRelease.nombre}</strong> — Cliente: <strong className="text-white">{roomPendingRelease.cliente || 'Anónimo'}</strong>
                  </p>
                </div>
              </div>

              {/* Overdue content */}
              {hasExtraHours ? (
                <div className="space-y-4 text-left">
                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-850 space-y-2.5 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Hora Ingreso:</span>
                      <span className="font-mono text-slate-200">{roomPendingRelease.fechaIngreso} {roomPendingRelease.horaIngreso}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Checkout Programado:</span>
                      <span className="font-mono text-slate-200">{roomPendingRelease.salidaProgramada || '12:00 p. m.'}</span>
                    </div>
                    <div className="flex justify-between items-center border-t border-slate-900 pt-2.5">
                      <span className="text-amber-400 font-bold">Tiempo de Retraso:</span>
                      <span className="font-bold text-amber-400 font-mono">+{details.extraHours} {details.extraHours === 1 ? 'hora' : 'horas'} (Fracción/Math.ceil)</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Tarifa por hora adicional:</span>
                      <span className="font-mono text-slate-200">{formatCop(hotelSettings?.checkoutHourlyRate ?? 10000)} / hr</span>
                    </div>
                    <div className="flex justify-between items-center border-t border-slate-900 pt-2.5 text-sm">
                      <span className="text-white font-extrabold">TOTAL ADICIONAL A COBRAR:</span>
                      <span className="font-extrabold text-emerald-400 font-mono text-base">{formatCop(details.extraHoursCost)}</span>
                    </div>
                  </div>

                  {/* Options: Cobrar vs Exonerar */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">Acción de Liberación</label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setReleaseActionType('cobrar')}
                        className={`py-3 px-4 rounded-xl text-xs font-bold border transition-all text-center flex flex-col items-center justify-center gap-1.5 ${
                          releaseActionType === 'cobrar'
                            ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400 shadow-md shadow-emerald-500/5'
                            : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-slate-300'
                        }`}
                      >
                        <CheckCircle className="h-4 w-4" />
                        <span>Cobrar y liberar</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setReleaseActionType('exonerar')}
                        className={`py-3 px-4 rounded-xl text-xs font-bold border transition-all text-center flex flex-col items-center justify-center gap-1.5 ${
                          releaseActionType === 'exonerar'
                            ? 'bg-amber-500/10 border-amber-500/40 text-amber-400 shadow-md shadow-amber-500/5'
                            : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-slate-300'
                        }`}
                      >
                        <X className="h-4 w-4" />
                        <span>Liberar sin cobrar</span>
                      </button>
                    </div>
                  </div>

                  {/* Actions specific options */}
                  {releaseActionType === 'cobrar' ? (
                    <div className="space-y-3 bg-slate-950/40 p-4 rounded-2xl border border-slate-850/60">
                      {/* Payment method selection */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block">Método de Pago Adicional</label>
                        <div className="grid grid-cols-2 gap-2">
                          {['Efectivo', 'Transferencia'].map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setReleasePaymentMethod(m as any)}
                              className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-all ${
                                releasePaymentMethod === m
                                  ? 'bg-emerald-600 border-emerald-500 text-white'
                                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Cash fields */}
                      {releasePaymentMethod === 'Efectivo' && (
                        <div className="grid grid-cols-2 gap-3 pt-1">
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-500 font-bold block">Dinero Recibido *</label>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={formatCurrencyInput(releaseCashReceived)}
                              onChange={(e) => setReleaseCashReceived(parseCurrencyInput(e.target.value))}
                              placeholder="Ej. 50.000"
                              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white text-right font-mono focus:outline-none focus:border-slate-700"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-500 font-bold block">Vueltos / Cambio</label>
                            <div className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-emerald-400 font-bold text-right font-mono h-[34px] flex items-center justify-end">
                              {releaseCashReceived > details.extraHoursCost
                                ? formatCop(releaseCashReceived - details.extraHoursCost)
                                : formatCop(0)}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2 bg-slate-950/40 p-4 rounded-2xl border border-slate-850/60 text-left">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block">
                        Observación / Motivo de Exoneración <span className="text-amber-500">*</span>
                      </label>
                      <textarea
                        value={releaseObservation}
                        onChange={(e) => setReleaseObservation(e.target.value)}
                        placeholder="Ej. Cortesía autorizada por administración para cliente frecuente."
                        rows={2}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-amber-500/60 placeholder:text-slate-600 resize-none font-sans"
                      />
                      <span className="text-[10px] text-slate-500 italic block">Para poder continuar, debe especificar una observación justificando por qué libera sin cobrar.</span>
                    </div>
                  )}

                </div>
              ) : (
                <div className="text-center py-2 text-slate-400 text-sm leading-normal">
                  ¿Está seguro de liberar la habitación <strong className="text-white">{roomPendingRelease.nombre}</strong>? 
                  <p className="text-xs text-slate-500 mt-2">No se detectaron horas adicionales vencidas.</p>
                </div>
              )}

              {/* Footer buttons */}
              <div className="flex gap-3 border-t border-slate-850 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowReleaseConfirm(false);
                    setRoomPendingRelease(null);
                  }}
                  className="flex-1 py-2.5 px-4 bg-slate-850 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-bold transition-all border border-slate-700/50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={isReleasingRoom || (hasExtraHours && releaseActionType === 'exonerar' && !releaseObservation.trim())}
                  onClick={() => {
                    if (hasExtraHours && releaseActionType === 'cobrar') {
                      const settings = getSettings();
                      if (settings.printerType === 'browser' && settings.autoPrintEnabled) {
                        if (hotelSettings?.printOnExtraHours ?? true) {
                          const win = openBrowserPrintWindow();
                          setBrowserPrintWindow(win);
                        }
                      }
                    }

                    if (hasExtraHours) {
                      if (releaseActionType === 'cobrar') {
                        executeReleaseRoom(
                          roomPendingRelease,
                          true,
                          releasePaymentMethod,
                          details.extraHoursCost,
                          '',
                          details.extraHours
                        );
                      } else {
                        // Exonerar
                        executeReleaseRoom(
                          roomPendingRelease,
                          true,
                          'Exonerado',
                          0,
                          releaseObservation,
                          details.extraHours
                        );
                      }
                    } else {
                      // Standard release
                      executeReleaseRoom(roomPendingRelease);
                    }
                  }}
                  className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition-all shadow-lg active:scale-[0.98] disabled:opacity-40 flex items-center justify-center gap-1.5 ${
                    hasExtraHours 
                      ? releaseActionType === 'exonerar'
                        ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-500/10'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/10'
                      : 'bg-red-600 hover:bg-red-500 text-white shadow-red-500/10'
                  }`}
                >
                  {isReleasingRoom ? "LIBERANDO..." : (
                    hasExtraHours 
                      ? releaseActionType === 'exonerar' ? "Confirmar sin cobrar" : "Confirmar cobro y liberar"
                      : "Sí, liberar habitación"
                  )}
                </button>
              </div>

            </div>
          </div>
        );
      })()}

    </div>
  );
};
