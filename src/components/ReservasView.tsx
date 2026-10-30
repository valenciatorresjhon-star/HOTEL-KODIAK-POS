import React, { useState } from 'react';
import { Calendar, Plus, Clock, User, Bed, ShieldAlert, CheckCircle, RefreshCw, ClipboardList, X, Search } from 'lucide-react';
import { Reservation, Room, ReservationStatus, Client, VehicleType } from '../types';
import { formatCop, isInvalidValue, getTodayColombia } from '../utils/storage';
import { AdminPasswordModal } from './AdminPasswordModal';

interface ReservasProps {
  reservations: Reservation[];
  rooms: Room[];
  clients?: Client[];
  onUpdateClients?: (updated: Client[]) => void;
  onUpdateReservations: (updated: Reservation[]) => void;
}

export const ReservasView: React.FC<ReservasProps> = ({
  reservations = [],
  rooms = [],
  clients = [],
  onUpdateClients,
  onUpdateReservations
}) => {
  const safeReservations = Array.isArray(reservations) ? reservations : [];
  const safeRooms = Array.isArray(rooms) ? rooms : [];
  const safeClients = Array.isArray(clients) ? clients : [];

  // Modal control
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Admin Verification Modal states
  const [showAdminModal, setShowAdminModal] = useState<boolean>(false);
  const [adminModalCallback, setAdminModalCallback] = useState<(() => void) | null>(null);
  const [adminModalMsg, setAdminModalMsg] = useState<string>('');

  // Calendar click error state
  const [calendarError, setCalendarError] = useState<string>('');

  // Form states
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [clientName, setClientName] = useState<string>('');
  const [clientId, setClientId] = useState<string>('');
  const [clientPhone, setClientPhone] = useState<string>('');
  const [clientEmail, setClientEmail] = useState<string>('');
  const [clientAddress, setClientAddress] = useState<string>('Medellín, Antioquia');

  // Corporate and vehicle details
  const [esEmpresa, setEsEmpresa] = useState<boolean>(false);
  const [empresa, setEmpresa] = useState<string>('');
  const [nit, setNit] = useState<string>('');

  const [tipoVehiculo, setTipoVehiculo] = useState<VehicleType>('Moto');
  const [placa, setPlaca] = useState<string>('');
  const [marca, setMarca] = useState<string>('');
  const [color, setColor] = useState<string>('');
  const [observacionVehiculo, setObservacionVehiculo] = useState<string>('');

  // Search states
  const [clientSearchQuery, setClientSearchQuery] = useState<string>('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  const [colombiaToday, setColombiaToday] = useState<string>(() => {
    return getTodayColombia();
  });

  const getTomorrowColombiaStr = (todayStr: string) => {
    const [y, m, d] = todayStr.split('-').map(Number);
    const tomorrow = new Date(y, m - 1, d + 1);
    return `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  };

  const isDateTimePastInColombia = (dateStr: string, timeStr: string): boolean => {
    const todayStr = getTodayColombia();
    if (dateStr < todayStr) {
      return true;
    }
    if (dateStr > todayStr) {
      return false;
    }

    const normalizedTime = timeStr.trim().toUpperCase();
    let hours = 12;
    let minutes = 0;

    const ampmMatch = normalizedTime.match(/^(\d+):(\d+)\s*(AM|PM)$/);
    if (ampmMatch) {
      let h = parseInt(ampmMatch[1]);
      const m = parseInt(ampmMatch[2]);
      const period = ampmMatch[3];
      if (period === 'PM' && h < 12) h += 12;
      if (period === 'AM' && h === 12) h = 0;
      hours = h;
      minutes = m;
    } else {
      const match24 = normalizedTime.match(/^(\d+):(\d+)$/);
      if (match24) {
        hours = parseInt(match24[1]);
        minutes = parseInt(match24[2]);
      }
    }

    const now = new Date();
    const colombiaTimeStr = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Bogota",
      hour12: false,
      hour: "numeric",
      minute: "numeric"
    }).format(now);

    const [colHour, colMin] = colombiaTimeStr.split(':').map(Number);

    if (hours < colHour) {
      return true;
    }
    if (hours === colHour && minutes < colMin) {
      return true;
    }
    return false;
  };

  const isCheckOutBeforeIn = (checkInDateStr: string, checkInTimeStr: string, checkOutDateStr: string, checkOutTimeStr: string): boolean => {
    if (checkOutDateStr < checkInDateStr) {
      return true;
    }
    if (checkOutDateStr > checkInDateStr) {
      return false;
    }

    const parseTimeToMinutes = (timeStr: string): number => {
      const normalizedTime = timeStr.trim().toUpperCase();
      let hours = 12;
      let minutes = 0;

      const ampmMatch = normalizedTime.match(/^(\d+):(\d+)\s*(AM|PM)$/);
      if (ampmMatch) {
        let h = parseInt(ampmMatch[1]);
        const m = parseInt(ampmMatch[2]);
        const period = ampmMatch[3];
        if (period === 'PM' && h < 12) h += 12;
        if (period === 'AM' && h === 12) h = 0;
        hours = h;
        minutes = m;
      } else {
        const match24 = normalizedTime.match(/^(\d+):(\d+)$/);
        if (match24) {
          hours = parseInt(match24[1]);
          minutes = parseInt(match24[2]);
        }
      }
      return hours * 60 + minutes;
    };

    const checkInMin = parseTimeToMinutes(checkInTimeStr);
    const checkOutMin = parseTimeToMinutes(checkOutTimeStr);

    return checkOutMin <= checkInMin;
  };

  const [checkInDate, setCheckInDate] = useState<string>(() => {
    return getTodayColombia();
  });
  const [checkInTime, setCheckInTime] = useState<string>('03:00 PM');
  const [checkOutDate, setCheckOutDate] = useState<string>(() => {
    return getTomorrowColombiaStr(getTodayColombia());
  });
  const [checkOutTime, setCheckOutTime] = useState<string>('01:00 PM');
  const [status, setStatus] = useState<ReservationStatus>('Confirmada');
  const [paymentStatus, setPaymentStatus] = useState<'Pendiente' | 'Abonado' | 'Pagado'>('Pendiente');
  const [amountPaid, setAmountPaid] = useState<number>(0);
  const [balance, setBalance] = useState<number>(50000);
  const [observations, setObservations] = useState<string>('');

  // Normalizer for search function
  const normalizeString = (str: string) => {
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, "");
  };

  // Filter clients based on search query
  const searchResults = clientSearchQuery.trim() === '' ? [] : safeClients.filter((c) => {
    const query = normalizeString(clientSearchQuery);
    const fieldsToSearch = [
      c.nombre,
      c.cedula,
      c.celular,
      c.correo,
      c.direccion,
      c.placa,
      c.empresa || '',
      c.nit || ''
    ];
    return fieldsToSearch.some(field => normalizeString(field).includes(query));
  });

  const handleSelectClient = (c: Client) => {
    setSelectedClient(c);
    setClientName(c.nombre || '');
    setClientId(c.cedula || '');
    setClientPhone(c.celular || '');
    setClientEmail(c.correo || '');
    setClientAddress(c.direccion || 'Medellín, Antioquia');
    
    setEsEmpresa(!!c.esEmpresa);
    setEmpresa(c.empresa || '');
    setNit(c.nit || '');

    setTipoVehiculo(c.tipoVehiculo || 'Moto');
    setPlaca(c.placa || '');
    setMarca(c.marca || '');
    setColor(c.color || '');
    setObservacionVehiculo(c.observacionVehiculo || '');

    // Clear search input so results list is closed
    setClientSearchQuery('');
  };

  const isClientIncomplete = !clientName.trim() || !clientId.trim() || !clientPhone.trim();

  // Automatic calendar update hook (Colombia time zone)
  React.useEffect(() => {
    const interval = setInterval(() => {
      setColombiaToday(getTodayColombia());
    }, 60000); // Check every minute
    return () => clearInterval(interval);
  }, []);

  const [currentYear, currentMonth, currentDay] = colombiaToday.split('-').map(Number);

  // Number of days in current month
  const daysInCurrentMonth = new Date(currentYear, currentMonth, 0).getDate();
  const daysArray = Array.from({ length: daysInCurrentMonth }, (_, i) => i + 1);

  const getFirstDayOfWeekInColombia = (year: number, month: number) => {
    const date = new Date(`${year}-${String(month).padStart(2, '0')}-01T12:00:00-05:00`);
    const shortDay = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Bogota",
      weekday: "short"
    }).format(date);
    const daysMap: Record<string, number> = {
      'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
    };
    return daysMap[shortDay] !== undefined ? daysMap[shortDay] : date.getDay();
  };

  const firstDay = getFirstDayOfWeekInColombia(currentYear, currentMonth);
  const blankTilesCount = firstDay === 0 ? 6 : firstDay - 1;
  const blankTilesArray = Array.from({ length: blankTilesCount }, (_, i) => i);

  const getMonthNameSpanish = (monthNum: number) => {
    const months = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    return months[monthNum - 1] || '';
  };

  const getFormattedTodaySpanish = () => {
    const months = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    return `${months[currentMonth - 1]} ${currentDay}, ${currentYear}`;
  };

  const handleDayClick = (dateStr: string) => {
    setCalendarError('');
    if (dateStr < colombiaToday) {
      setCalendarError('No se pueden seleccionar fechas pasadas.');
      return;
    }
    setCheckInDate(dateStr);
    const [y, m, d] = dateStr.split('-').map(Number);
    const tomorrow = new Date(y, m - 1, d + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    setCheckOutDate(tomorrowStr);
    setErrorMsg('');
    setShowCreateModal(true);
  };

  const handleCheckInClick = (res: Reservation) => {
    if (res.checkInDate < colombiaToday) {
      setAdminModalMsg("Esta reserva tiene fecha pasada. Para continuar requiere autorización administrativa.");
      setAdminModalCallback(() => () => {
        handleChangeStatus(res.id, 'Cumplida');
      });
      setShowAdminModal(true);
    } else {
      handleChangeStatus(res.id, 'Cumplida');
    }
  };

  const handleCreateReservation = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (checkInDate < colombiaToday) {
      setErrorMsg('No se pueden agendar reservas en fechas pasadas.');
      return;
    }

    if (isDateTimePastInColombia(checkInDate, checkInTime)) {
      setErrorMsg('No se puede agendar una reserva para una hora que ya pasó.');
      return;
    }

    if (isCheckOutBeforeIn(checkInDate, checkInTime, checkOutDate, checkOutTime)) {
      setErrorMsg('La fecha y hora de salida deben ser posteriores a la entrada.');
      return;
    }

    if (!selectedRoomId) {
      setErrorMsg('Debe seleccionar una habitación.');
      return;
    }

    if (isInvalidValue(clientName) || isInvalidValue(clientId) || isInvalidValue(clientPhone)) {
      setErrorMsg('Nombre completo, cédula, y celular del cliente son obligatorios.');
      return;
    }

    // Client incomplete check
    if (selectedClient && isClientIncomplete) {
      setErrorMsg('Este cliente tiene datos incompletos. Debe completarlos antes de guardar la reserva.');
      return;
    }

    const roomObj = safeRooms.find((r) => r.id === selectedRoomId);
    if (!roomObj) {
      setErrorMsg('La habitación seleccionada no es válida.');
      return;
    }

    // Identify existing client by 1. Cédula, 2. Celular, 3. Correo, 4. Placa
    const cCedula = clientId.trim();
    const cCelular = clientPhone.trim();
    const cCorreo = clientEmail.trim();
    const cPlaca = placa.trim().toUpperCase();

    let existingClient = safeClients.find(c => {
      if (cCedula && c.cedula === cCedula) return true;
      if (cCelular && c.celular === cCelular) return true;
      if (cCorreo && cCorreo !== 'sin_correo@hotelkodiak.com' && c.correo === cCorreo) return true;
      if (cPlaca && cPlaca !== 'S/P' && c.placa === cPlaca) return true;
      return false;
    });

    const now = new Date();
    let finalClient: Client;

    if (existingClient) {
      // Update existing client
      finalClient = {
        ...existingClient,
        nombre: clientName.trim().toUpperCase(),
        cedula: cCedula,
        celular: cCelular,
        correo: cCorreo || 'sin_correo@hotelkodiak.com',
        direccion: clientAddress.trim() || 'Medellín, Antioquia',
        esEmpresa,
        empresa: esEmpresa ? empresa.trim().toUpperCase() : undefined,
        nit: esEmpresa ? nit.trim() : undefined,
        tipoVehiculo,
        placa: cPlaca || 'S/P',
        marca: marca.trim().toUpperCase() || 'S/M',
        color: color.trim().toUpperCase() || 'S/C',
        observacionVehiculo: observacionVehiculo.trim() || 'Ninguna novedad registrada.',
        visitas: (existingClient.visitas || 1) + 1,
        updatedAt: now.toISOString()
      };

      if (onUpdateClients) {
        const updatedClients = safeClients.map(c => c.id === existingClient!.id ? finalClient : c);
        onUpdateClients(updatedClients);
      }
    } else {
      // Create new client
      finalClient = {
        id: `client-${now.getTime()}`,
        nombre: clientName.trim().toUpperCase(),
        cedula: cCedula,
        celular: cCelular,
        correo: cCorreo || 'sin_correo@hotelkodiak.com',
        direccion: clientAddress.trim() || 'Medellín, Antioquia',
        esEmpresa,
        empresa: esEmpresa ? empresa.trim().toUpperCase() : undefined,
        nit: esEmpresa ? nit.trim() : undefined,
        tipoVehiculo,
        placa: cPlaca || 'S/P',
        marca: marca.trim().toUpperCase() || 'S/M',
        color: color.trim().toUpperCase() || 'S/C',
        observacionVehiculo: observacionVehiculo.trim() || 'Ninguna novedad registrada.',
        visitas: 1,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      };

      if (onUpdateClients) {
        onUpdateClients([...safeClients, finalClient]);
      }
    }

    const newRes: Reservation = {
      id: `res-${now.getTime()}`,
      roomId: selectedRoomId,
      roomName: roomObj.nombre,
      clientName: finalClient.nombre,
      clientId: finalClient.id, // Save DB ID as clientId link
      clientPhone: finalClient.celular,
      clientEmail: finalClient.correo,
      clientDocument: finalClient.cedula, // Keep client document
      checkInDate,
      checkInTime,
      checkOutDate,
      checkOutTime,
      status,
      observations: observations.trim() || 'Ninguna observación especial.',
      paymentStatus,
      amountPaid,
      balance,
      createdAt: now.toISOString()
    };

    onUpdateReservations([...safeReservations, newRes]);
    setShowCreateModal(false);

    // Reset Form
    setClientName('');
    setClientId('');
    setClientPhone('');
    setClientEmail('');
    setClientAddress('Medellín, Antioquia');
    setEsEmpresa(false);
    setEmpresa('');
    setNit('');
    setTipoVehiculo('Moto');
    setPlaca('');
    setMarca('');
    setColor('');
    setObservacionVehiculo('');
    setObservations('');
    setAmountPaid(0);
    setBalance(50000);
    setClientSearchQuery('');
    setSelectedClient(null);
  };

  const handleChangeStatus = (resId: string, newStatus: ReservationStatus) => {
    const updated = safeReservations.map((r) => {
      if (r.id === resId) {
        return { ...r, status: newStatus };
      }
      return r;
    });
    onUpdateReservations(updated);
  };

  return (
    <div className="space-y-6">
      
      {/* Header action panel */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-900 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-400" />
            <span>Calendario de Reservas</span>
          </h2>
          <p className="text-xs text-slate-400">Programe y reserve las habitaciones del hotel con anticipación, registre abonos de hospedaje.</p>
        </div>

        <button
          onClick={() => {
            setErrorMsg('');
            if (safeRooms.length > 0) {
              setSelectedRoomId(safeRooms[0].id);
            }
            setClientName('');
            setClientId('');
            setClientPhone('');
            setClientEmail('');
            setClientAddress('Medellín, Antioquia');
            setEsEmpresa(false);
            setEmpresa('');
            setNit('');
            setTipoVehiculo('Moto');
            setPlaca('');
            setMarca('');
            setColor('');
            setObservacionVehiculo('');
            setObservations('');
            setAmountPaid(0);
            setBalance(50000);
            setClientSearchQuery('');
            setSelectedClient(null);
            setShowCreateModal(true);
          }}
          className="py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 active:scale-[0.98] transition-all"
        >
          <Plus className="h-4 w-4" />
          <span>Agendar Nueva Reserva</span>
        </button>
      </div>

      {/* Grid: Calendar visualizer + Reservation list log */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left column Spans 7: Monthly Calendar view */}
        <div className="lg:col-span-7 bg-slate-900/40 border border-slate-900 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-300">
              MES DE {getMonthNameSpanish(currentMonth).toUpperCase()} {currentYear} (KODIAK ACTIVE)
            </h3>
            <span className="text-[10px] text-slate-500 font-bold">Hoy es: {getFormattedTodaySpanish()}</span>
          </div>

          {calendarError && (
            <div className="text-[11px] bg-red-500/15 border border-red-500/20 text-red-300 px-3 py-2 rounded-xl flex items-center justify-between animate-fade-in">
              <span className="font-semibold">⚠️ {calendarError}</span>
              <button type="button" onClick={() => setCalendarError('')} className="text-slate-400 hover:text-white font-bold ml-2">✕</button>
            </div>
          )}

          {/* Calendar grid header */}
          <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] uppercase font-bold text-slate-500 border-b border-slate-800 pb-2">
            <span>Lun</span>
            <span>Mar</span>
            <span>Mié</span>
            <span>Jue</span>
            <span>Vie</span>
            <span>Sáb</span>
            <span>Dom</span>
          </div>

          {/* Day tiles */}
          <div className="grid grid-cols-7 gap-1.5 text-center text-xs">
            {blankTilesArray.map((_, idx) => (
              <div key={`blank-${idx}`} className="p-2.5 text-transparent select-none">0</div>
            ))}

            {daysArray.map((dayNum) => {
              const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
              // Count how many confirm / pending reservations exist on this date
              const dayResCount = safeReservations.filter((res) => 
                (res.checkInDate === dateStr || res.checkOutDate === dateStr) &&
                (res.status === 'Confirmada' || res.status === 'Pendiente')
              ).length;

              const isToday = dayNum === currentDay;
              const isPast = dateStr < colombiaToday;

              return (
                <div
                  key={dayNum}
                  onClick={() => handleDayClick(dateStr)}
                  className={`p-2.5 rounded-xl flex flex-col justify-between items-center h-14 border transition-all select-none ${
                    isPast
                      ? 'bg-slate-950/40 border-slate-900/60 opacity-30 cursor-not-allowed text-slate-600'
                      : isToday
                      ? 'bg-emerald-950/20 border-emerald-500/50 text-white font-extrabold hover:border-emerald-400 cursor-pointer hover:bg-emerald-950/40'
                      : 'bg-slate-950 border-slate-850 text-slate-400 hover:border-emerald-500 cursor-pointer hover:bg-slate-900'
                  }`}
                >
                  <span className="text-[11px]">{dayNum}</span>
                  {dayResCount > 0 ? (
                    <span className="text-[9px] bg-indigo-500 text-white font-black px-1.5 py-0.2 rounded-full leading-none">
                      {dayResCount} Res
                    </span>
                  ) : (
                    <span className={`w-1.5 h-1.5 rounded-full ${isPast ? 'bg-slate-900' : 'bg-slate-800'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right column Spans 5: list of reservations */}
        <div className="lg:col-span-5 bg-slate-900/40 border border-slate-900 rounded-2xl p-5 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-300 border-b border-slate-850 pb-2">
            LISTADO DE RESERVAS AGENDADAS ({safeReservations.length})
          </h3>

          <div className="space-y-3.5 max-h-[380px] overflow-y-auto pr-1">
            {safeReservations.length === 0 ? (
              <p className="text-xs text-slate-500 italic text-center py-10">No hay reservas vigentes agendadas.</p>
            ) : (
              safeReservations.map((res) => (
                <div key={res.id} className="p-4 bg-slate-950 border border-slate-850 rounded-xl space-y-2.5 text-xs">
                  <div className="flex justify-between items-start">
                    <div>
                      <strong className="text-slate-100 block">{res.clientName}</strong>
                      <span className="text-[10px] text-slate-400 block font-medium">Habitación: {res.roomName}</span>
                    </div>

                    <span className={`text-[8px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                      res.status === 'Confirmada'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : res.status === 'Cumplida'
                        ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    }`}>
                      {res.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400 bg-slate-900 p-2 rounded-lg border border-slate-850/60 font-mono">
                    <div>
                      <span className="text-slate-500 uppercase block font-bold text-[8px]">Entrada (In)</span>
                      <span>{res.checkInDate} {res.checkInTime}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 uppercase block font-bold text-[8px]">Salida (Out)</span>
                      <span>{res.checkOutDate} {res.checkOutTime}</span>
                    </div>
                  </div>

                  {/* Payment details */}
                  <div className="flex justify-between items-center text-[11px] pt-1 border-t border-slate-900">
                    <span className="text-slate-500 font-medium">Abonado: {formatCop(res.amountPaid)}</span>
                    <strong className="text-emerald-400 font-bold">Por pagar: {formatCop(res.balance)}</strong>
                  </div>

                  {res.status !== 'Cumplida' && res.status !== 'Cancelada' && res.checkInDate < colombiaToday && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 animate-pulse">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      <span>Reserva vencida / fecha pasada</span>
                    </div>
                  )}

                  {/* Action transitions */}
                  {res.status !== 'Cumplida' && res.status !== 'Cancelada' && (
                    <div className="flex gap-2 pt-1 border-t border-slate-900">
                      <button
                        type="button"
                        onClick={() => handleCheckInClick(res)}
                        className="flex-1 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 rounded text-[9px] font-bold"
                      >
                        Cumplida (Check-In)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleChangeStatus(res.id, 'Cancelada')}
                        className="flex-1 py-1 bg-red-600/20 hover:bg-red-600/30 text-red-300 rounded text-[9px] font-bold"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

      </div>

      {/* Modal: Create Reservation */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <form onSubmit={handleCreateReservation} className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">AGENDAR RESERVACIÓN</h3>
                <p className="text-[10px] text-slate-400">Ingrese datos del hospedaje programado para bloquear calendario.</p>
              </div>
              <button type="button" onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              
              {/* 1. Seleccione Habitación */}
              <div className="space-y-1">
                <label className="text-xs text-slate-300 font-semibold block">Seleccione Habitación *</label>
                <select
                  value={selectedRoomId}
                  onChange={(e) => setSelectedRoomId(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
                >
                  {safeRooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nombre} ({r.estado})
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. BUSCAR CLIENTE GUARDADO */}
              <div className="space-y-2 bg-slate-950/40 p-4 rounded-xl border border-slate-900">
                <label className="text-xs text-slate-300 font-bold uppercase tracking-wider block flex items-center gap-1.5">
                  <Search className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Buscar Cliente Guardado</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={clientSearchQuery}
                    onChange={(e) => setClientSearchQuery(e.target.value)}
                    placeholder="Buscar por nombre, cédula, celular, correo o placa..."
                    className="w-full bg-slate-950 border border-slate-800 text-xs text-white pl-9 pr-4 py-2 rounded-xl focus:outline-none focus:border-emerald-500"
                  />
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
                </div>
                
                {/* Search Results list */}
                {searchResults.length > 0 && (
                  <div className="mt-2 max-h-48 overflow-y-auto bg-slate-900 border border-slate-800 rounded-xl divide-y divide-slate-850/60 shadow-lg">
                    {searchResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleSelectClient(c)}
                        className="w-full text-left p-3 hover:bg-slate-800/80 transition-colors flex flex-col gap-1"
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-xs text-emerald-400 uppercase">{c.nombre}</span>
                          {c.placa && c.placa !== 'S/P' && (
                            <span className="font-mono text-[10px] bg-slate-950 border border-slate-850 px-1.5 py-0.2 rounded text-amber-400 font-black uppercase">
                              {c.placa}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-x-2 text-[10px] text-slate-400 font-mono">
                          <span>Cédula: {c.cedula}</span>
                          <span>Celular: {c.celular}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {clientSearchQuery.trim() !== '' && searchResults.length === 0 && (
                  <p className="text-[10px] text-slate-500 italic mt-1.5 pl-1">No se encontraron clientes registrados con ese término.</p>
                )}
              </div>

              {/* 3. DATOS DEL HUÉSPED */}
              <div className="space-y-3 pt-1 border-t border-slate-850/60">
                <span className="text-xs font-bold text-emerald-400 block border-b border-slate-850/60 pb-0.5 uppercase tracking-wider">Datos del Huésped</span>

                {/* Cliente Incompleto warning */}
                {selectedClient && isClientIncomplete && (
                  <div className="text-[11px] bg-red-500/15 border border-red-500/20 text-red-300 p-3 rounded-xl flex items-start gap-2">
                    <ShieldAlert className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
                    <span>Este cliente tiene datos incompletos. Debe completarlos antes de guardar la reserva.</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-slate-400 font-medium">Nombre Completo *</label>
                  <input
                    type="text"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Ej. SANTIAGO ARBELAEZ"
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-1.5 text-xs text-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-slate-400 font-medium">Cédula o Pasaporte *</label>
                    <input
                      type="text"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      placeholder="Ej. 1029345"
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-slate-400 font-medium">Celular de Contacto *</label>
                    <input
                      type="text"
                      value={clientPhone}
                      onChange={(e) => setClientPhone(e.target.value)}
                      placeholder="Ej. 30129384"
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-slate-400 font-medium">Correo Electrónico</label>
                    <input
                      type="email"
                      value={clientEmail}
                      onChange={(e) => setClientEmail(e.target.value)}
                      placeholder="Ej. correo@mail.com"
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-1.5 text-xs text-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-slate-400 font-medium">Dirección de Residencia</label>
                    <input
                      type="text"
                      value={clientAddress}
                      onChange={(e) => setClientAddress(e.target.value)}
                      placeholder="Dirección, Ciudad"
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-1.5 text-xs text-white"
                    />
                  </div>
                </div>

                {/* Corporate profile toggles */}
                <div className="space-y-3 bg-slate-950/40 p-4 rounded-xl border border-slate-900 mt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">¿Es un Cliente Corporativo / Empresa?</span>
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
                    <div className="grid grid-cols-2 gap-3 pt-2">
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400">Razón Social</label>
                        <input
                          type="text"
                          value={empresa}
                          onChange={(e) => setEmpresa(e.target.value)}
                          placeholder="Ej. Industrias S.A.S."
                          className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400">NIT Corporativo</label>
                        <input
                          type="text"
                          value={nit}
                          onChange={(e) => setNit(e.target.value)}
                          placeholder="Ej. 901234567-9"
                          className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Vehicle profile */}
                <div className="space-y-3 pt-2">
                  <span className="text-xs font-bold text-slate-400 block border-b border-slate-800 pb-1">Datos del Vehículo</span>
                  
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="space-y-1">
                      <label className="text-slate-400 font-medium">Tipo de Vehículo</label>
                      <select
                        value={tipoVehiculo}
                        onChange={(e) => setTipoVehiculo(e.target.value as VehicleType)}
                        className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
                      >
                        <option value="Moto">Moto</option>
                        <option value="Carro">Carro</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-slate-400 font-medium">Placa</label>
                      <input
                        type="text"
                        value={placa}
                        onChange={(e) => setPlaca(e.target.value)}
                        placeholder="Ej. ABC12D"
                        className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white font-mono uppercase"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-slate-400 font-medium">Marca</label>
                      <input
                        type="text"
                        value={marca}
                        onChange={(e) => setMarca(e.target.value)}
                        placeholder="Ej. Honda"
                        className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-slate-400 font-medium">Color</label>
                      <input
                        type="text"
                        value={color}
                        onChange={(e) => setColor(e.target.value)}
                        placeholder="Ej. Azul"
                        className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
                      />
                    </div>
                    <div className="space-y-1 col-span-2">
                      <label className="text-slate-400 font-medium">Novedad / Observación Vehículo</label>
                      <input
                        type="text"
                        value={observacionVehiculo}
                        onChange={(e) => setObservacionVehiculo(e.target.value)}
                        placeholder="Ej. Rasguños leves, maletero trasero..."
                        className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* 4. Fechas de hospedaje */}
              <div className="space-y-3">
                <span className="text-xs font-bold text-emerald-400 block border-b border-slate-800 pb-0.5 uppercase tracking-wider">Fechas de Hospedaje</span>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-slate-400 font-medium">Fecha Check-In (In)</label>
                    <input
                      type="date"
                      value={checkInDate}
                      onChange={(e) => setCheckInDate(e.target.value)}
                      min={colombiaToday}
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-1.5 text-xs text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400 font-medium">Hora Check-In (12H AM/PM)</label>
                    <input
                      type="text"
                      value={checkInTime}
                      onChange={(e) => setCheckInTime(e.target.value)}
                      placeholder="Ej. 03:00 PM"
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-1.5 text-xs text-white"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-slate-400 font-medium">Fecha Check-Out (Out)</label>
                    <input
                      type="date"
                      value={checkOutDate}
                      onChange={(e) => setCheckOutDate(e.target.value)}
                      min={checkInDate || colombiaToday}
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-1.5 text-xs text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400 font-medium">Hora Check-Out (12H AM/PM)</label>
                    <input
                      type="text"
                      value={checkOutTime}
                      onChange={(e) => setCheckOutTime(e.target.value)}
                      placeholder="Ej. 01:00 PM"
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-1.5 text-xs text-white"
                    />
                  </div>
                </div>
              </div>

              {/* 5. Abonos y saldos */}
              <div className="space-y-3">
                <span className="text-xs font-bold text-emerald-400 block border-b border-slate-800 pb-0.5 uppercase tracking-wider">Abonos y Saldos</span>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-slate-400 font-medium">Monto Abonado (COP)</label>
                    <input
                      type="number"
                      value={amountPaid}
                      onChange={(e) => setAmountPaid(parseInt(e.target.value) || 0)}
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-1.5 text-xs text-white font-mono"
                      min={0}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400 font-medium">Saldo Pendiente (COP)</label>
                    <input
                      type="number"
                      value={balance}
                      onChange={(e) => setBalance(parseInt(e.target.value) || 0)}
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-1.5 text-xs text-white font-mono"
                      min={0}
                    />
                  </div>
                </div>
              </div>

              {/* 6. Observaciones */}
              <div className="space-y-1">
                <label className="text-xs text-slate-300 font-semibold block">Observación especial de reserva</label>
                <input
                  type="text"
                  value={observations}
                  onChange={(e) => setObservations(e.target.value)}
                  placeholder="Ej. Viene con aire, mascota pequeña, etc."
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2 text-xs text-white"
                />
              </div>

              {errorMsg && (
                <div className="text-xs bg-red-500/10 border border-red-500/20 text-red-200 p-2.5 rounded-xl">
                  ⚠️ {errorMsg}
                </div>
              )}

              {/* 7. Guardar reserva */}
              <button
                type="submit"
                disabled={selectedClient !== null && isClientIncomplete}
                className={`w-full py-2.5 text-white rounded-xl text-xs font-bold transition-all shadow-md ${
                  selectedClient !== null && isClientIncomplete
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
                    : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500'
                }`}
              >
                AGENDAR RESERVACIÓN DE HABITACIÓN
              </button>
            </div>
          </form>
        </div>
      )}

      <AdminPasswordModal
        open={showAdminModal}
        title="Autorización administrativa"
        message={adminModalMsg}
        onConfirm={(password) => {
          if (password === '4321') {
            setShowAdminModal(false);
            if (adminModalCallback) {
              adminModalCallback();
            }
            return true;
          }
          return false;
        }}
        onCancel={() => {
          setShowAdminModal(false);
          setAdminModalCallback(null);
        }}
      />

    </div>
  );
};
