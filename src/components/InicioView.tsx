import React from 'react';
import { Home, Calendar, ShieldCheck, Bed, Package, Clock, LogOut, FileText, HelpCircle } from 'lucide-react';
import { Shift, Room, Product, Reservation, isProductVisible } from '../types';
import { formatCop, getTodayColombia } from '../utils/storage';
import hotelLogo from '../assets/images/hotel-logo-lite.jpg';

interface InicioProps {
  activeShift: Shift;
  rooms: Room[];
  products: Product[];
  reservations?: Reservation[];
  onTriggerLogOut: () => void;
  onLogout?: () => void;
}

export const InicioView: React.FC<InicioProps> = ({
  activeShift,
  rooms,
  products,
  reservations,
  onTriggerLogOut,
  onLogout
}) => {
  const safeRooms = Array.isArray(rooms) ? rooms : [];
  const occupiedCount = safeRooms.filter((r) => r.estado === 'ocupada').length;
  const availableCount = safeRooms.filter((r) => r.estado === 'disponible').length;

  const activeReservationsCount = (Array.isArray(reservations) ? reservations : [])
    .filter((res) => res.status === 'Confirmada' || res.status === 'Pendiente').length;

  return (
    <div className="space-y-6">
      {/* Welcome Hero card */}
      <div className="relative overflow-hidden bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950 border border-slate-800 p-6 sm:p-8 rounded-3xl shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="space-y-2 z-10">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full text-xs text-emerald-400 font-bold uppercase tracking-wider">
              Hotel Kodiak Lite
            </div>
            <span className="text-slate-500 text-xs font-mono">• {getTodayColombia()}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            SISTEMA POS HOTEL KODIAK
          </h1>
          <p className="text-sm text-slate-400 max-w-xl">
            Plataforma local y de escritorio para la facturación, ocupación en tiempo real, inventarios y cierres definitivos de turno del Hotel Kodiak.
          </p>
        </div>
        
        {/* Logo Placeholder */}
        <div className="w-24 h-24 sm:w-28 sm:h-28 border border-slate-800 bg-slate-950/60 rounded-2xl overflow-hidden flex items-center justify-center z-10 relative">
          <img 
            src={hotelLogo} 
            alt="Hotel Kodiak Logo" 
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
          <div className="absolute -top-1.5 -right-1.5 bg-emerald-500 w-3 h-3 rounded-full animate-ping" />
          <div className="absolute -top-1.5 -right-1.5 bg-emerald-500 w-3 h-3 rounded-full border-2 border-slate-950" />
        </div>
      </div>

      {/* Grid: Shift Status and Quick Counts */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        
        {/* Left: Active Shift Panel (Spans 5 cols) */}
        <div className="md:col-span-5 bg-slate-900/40 border border-slate-900 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <span>Turno Activo Actual</span>
            </h2>
            <div className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold px-2 py-0.5 rounded-md uppercase">
              Abierto
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-[10px] text-slate-500 uppercase font-semibold">Empleada de Turno</span>
              <p className="text-sm font-bold text-white mt-0.5">{activeShift.empleada}</p>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 uppercase font-semibold">Base Inicial</span>
              <p className="text-sm font-bold text-emerald-400 mt-0.5">{formatCop(0)}</p>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 uppercase font-semibold">Hora de Apertura</span>
              <p className="text-xs text-slate-300 mt-0.5">{activeShift.horaApertura}</p>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 uppercase font-semibold">Fecha</span>
              <p className="text-xs text-slate-300 mt-0.5">{activeShift.fechaApertura}</p>
            </div>
          </div>

          {activeShift.observaciones && (
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80">
              <span className="text-[9px] text-slate-500 uppercase font-bold block mb-1">Novedades de apertura:</span>
              <p className="text-xs text-slate-400 italic">"{activeShift.observaciones}"</p>
            </div>
          )}

          <div className="pt-2 border-t border-slate-800 space-y-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onTriggerLogOut}
                className="flex-1 py-2 px-3 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                title="Bloquear temporalmente la pantalla"
              >
                <Clock className="h-3.5 w-3.5 text-amber-400" />
                <span>Bloquear</span>
              </button>
              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  className="flex-1 py-2 px-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 text-red-400 text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  title="Cerrar la sesión de la cuenta"
                >
                  <LogOut className="h-3.5 w-3.5 text-red-400" />
                  <span>Cerrar Sesión</span>
                </button>
              )}
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              * Recuerde realizar el conteo de inventario físico de productos al momento de entregar este turno.
            </p>
          </div>
        </div>

        {/* Right: Quick stats metrics grid (Spans 7 cols) */}
        <div className="md:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-4">
          
          {/* Card Rooms Available */}
          <div className="bg-emerald-950/15 border border-emerald-900/30 rounded-2xl p-4 flex flex-col justify-between h-32 relative overflow-hidden group">
            <div className="flex justify-between items-start">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">Disponibles</span>
              <div className="bg-emerald-500/10 p-1.5 rounded-lg text-emerald-400">
                <Bed className="h-4 w-4" />
              </div>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-white">{availableCount}</p>
              <p className="text-[10px] text-emerald-400/80 font-medium mt-1">Habitaciones libres</p>
            </div>
          </div>

          {/* Card Rooms Occupied */}
          <div className="bg-red-950/15 border border-red-900/30 rounded-2xl p-4 flex flex-col justify-between h-32 relative overflow-hidden">
            <div className="flex justify-between items-start">
              <span className="text-[11px] font-bold uppercase tracking-wider text-red-400">Ocupadas</span>
              <div className="bg-red-500/10 p-1.5 rounded-lg text-red-400">
                <Bed className="h-4 w-4" />
              </div>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-white">{occupiedCount}</p>
              <p className="text-[10px] text-red-400/80 font-medium mt-1">Habitaciones cobradas</p>
            </div>
          </div>

          {reservations && <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between h-32 relative overflow-hidden">
            <div className="flex justify-between items-start">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400">Reservas</span>
              <div className="bg-amber-500/10 p-1.5 rounded-lg text-amber-400">
                <Calendar className="h-4 w-4" />
              </div>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-white">{activeReservationsCount}</p>
              <p className="text-[10px] text-slate-400 font-medium mt-1">Pendientes / Confirmadas</p>
            </div>
          </div>}

          {/* Card Products */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between h-32 relative overflow-hidden">
            <div className="flex justify-between items-start">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Productos</span>
              <div className="bg-slate-500/10 p-1.5 rounded-lg text-slate-400">
                <Package className="h-4 w-4" />
              </div>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-white">{(products || []).filter(isProductVisible).length}</p>
              <p className="text-[10px] text-slate-400 font-medium mt-1">Productos activos</p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
