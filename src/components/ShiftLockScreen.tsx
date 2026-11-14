import React, { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, Lock, Sparkles, Coins, Clipboard, UserCheck, Unlock, ArrowRightLeft, AlertTriangle, CheckCircle } from 'lucide-react';
import { ALLOWED_EMPLOYEES, Shift, ShiftClosure, getEmployeeProfile, getEmployeeFullName } from '../types';
import { openBrowserPrintWindow, setBrowserPrintWindow, printAndOpenDrawerForInitialCashCount } from '../services/printerService';

const onlyDigits = (value: string): string => {
  return String(value || '').replace(/\D/g, '');
};

const formatMoneyInput = (value: string | number): string => {
  const raw = value === 0 ? '0' : String(value ?? '');
  const digits = onlyDigits(raw);
  if (!digits) return '';
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Number(digits));
};

const parseMoneyInput = (value: string): number => {
  const digits = onlyDigits(value);
  return digits ? Number(digits) : 0;
};

const moneyText = (value: any): string => {
  return `$${Number(value || 0).toLocaleString('es-CO')}`;
};

function getClosureSuggestedBase(closure?: ShiftClosure | null): number {
  if (!closure) return 0;

  // La base del turno nuevo debe ser el dinero REALMENTE dejado en caja.
  // Un 0 explícito es válido y debe mantenerse como 0.
  const authoritativeFields = [
    'dineroDejadoEnCaja',
    'baseParaSiguienteTurno',
    'baseSugeridaSiguienteTurno',
    'nextShiftBase'
  ];

  for (const field of authoritativeFields) {
    if (Object.prototype.hasOwnProperty.call(closure as any, field)) {
      const raw = (closure as any)[field];
      if (raw === null || raw === undefined || raw === '') continue;
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  }

  // Solo para cierres antiguos sin los campos anteriores.
  if (Object.prototype.hasOwnProperty.call(closure as any, 'dineroFisicoContado')) {
    const n = Number((closure as any).dineroFisicoContado);
    if (Number.isFinite(n) && n >= 0) return n;
  }

  // Nunca usar cajaQueDebeQuedar / totalEsperadoEfectivo para abrir otro turno.
  return 0;
}

function findEmployeeForOpening(lastClosure?: ShiftClosure | null) {
  const candidateValues = [
    lastClosure?.empleadoRecibe,
    (lastClosure as any)?.receiverEmployeeName,
    (lastClosure as any)?.empleadaRecibeNombreCompleto
  ].filter(Boolean);

  for (const value of candidateValues) {
    const raw = String(value || '').toLowerCase();
    const found = ALLOWED_EMPLOYEES.find((emp) => {
      const id = emp.id.toLowerCase();
      const name = emp.name.toLowerCase();
      const full = emp.nombreCompleto.toLowerCase();
      return raw.includes(id) || raw.includes(name) || raw.includes(full) || full.includes(raw);
    });
    if (found) return found;
  }

  return null;
}

interface ShiftLockProps {
  onOpenShift: (shift: Shift) => void;
  lastClosure?: ShiftClosure | null;
}

export const ShiftLockScreen: React.FC<ShiftLockProps> = ({ onOpenShift, lastClosure = null }) => {
  const [selectedEmployee, setSelectedEmployee] = useState<string>('ALICIA');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [baseCashInput, setBaseCashInput] = useState<string>('0');
  const [obs, setObs] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [initialDrawerOpened, setInitialDrawerOpened] = useState<boolean>(false);
  const [openingDrawer, setOpeningDrawer] = useState<boolean>(false);

  const suggestedBaseFromClosure = useMemo(() => getClosureSuggestedBase(lastClosure), [lastClosure?.id, lastClosure?.dineroDejadoEnCaja]);
  // La base inicial corresponde al efectivo realmente contado por la empleada.
  // El cierre anterior es referencia, nunca se suma automáticamente.
  const baseCash = parseMoneyInput(baseCashInput);
  const hasPreviousClosure = !!lastClosure;
  const baseDifference = baseCash - suggestedBaseFromClosure;
  const openingWithDifferentBase = hasPreviousClosure && baseDifference !== 0;

  useEffect(() => {
    if (!lastClosure) {
      setBaseCashInput('0');
      return;
    }

    // Cada apertura inicia en cero. El último cierre permanece como referencia
    // contable y no se utiliza para precargar la nueva base.
    setBaseCashInput('0');
    setInitialDrawerOpened(false);

    const receivingEmployee = findEmployeeForOpening(lastClosure);
    if (receivingEmployee) {
      setSelectedEmployee(receivingEmployee.id);
      setPassword('');
    }
  }, [lastClosure?.id]);

  const validateOpeningBasics = (): boolean => {
    setError('');

    const emp = ALLOWED_EMPLOYEES.find((x) => x.id === selectedEmployee);
    if (!emp) {
      setError('Empleada seleccionada no válida.');
      return false;
    }
    if (!password.trim()) {
      setError('Por favor ingrese su clave o PIN de turno.');
      return false;
    }
    return true;
  };

  const handleInitialCashDrawer = async () => {
    if (!validateOpeningBasics()) return;

    const emp = ALLOWED_EMPLOYEES.find((x) => x.id === selectedEmployee)!;

    setOpeningDrawer(true);
    let win: Window | null = null;
    try {
      win = openBrowserPrintWindow();
      setBrowserPrintWindow(win);
    } catch (error) {
      console.warn('No se pudo preabrir ventana de impresión de apertura:', error);
    }

    try {
      await printAndOpenDrawerForInitialCashCount({
        employeeName: emp.nombreCompleto || emp.name,
        employeeAlias: emp.name,
        baseInicial: baseCash,
        observaciones: obs.trim(),
        cierreAnteriorId: lastClosure?.id || '',
        cierreAnteriorTurnoId: lastClosure?.shiftId || '',
        cierreAnteriorEntrega: lastClosure?.empleadaEntrega || '',
        cierreAnteriorRecibe: lastClosure?.empleadoRecibe || '',
        cierreAnteriorFecha: lastClosure?.fechaCierre || '',
        cierreAnteriorHora: lastClosure?.horaCierre || '',
        cierreAnteriorCajaQueDebiaQuedar: Number(lastClosure?.cajaQueDebeQuedar || 0),
        cierreAnteriorDineroDejado: Number(lastClosure?.dineroDejadoEnCaja || 0),
        baseSugeridaCierreAnterior: suggestedBaseFromClosure,
        diferenciaBaseVsCierreAnterior: baseDifference,
        aperturaConDiferencia: openingWithDifferentBase
      }, win);
      setInitialDrawerOpened(true);
      window.alert('Caja abierta para conteo inicial. Cuente la base y luego registre el turno.');
    } catch (error: any) {
      setError('No se pudo imprimir/abrir caja para conteo inicial: ' + (error?.message || String(error)));
    } finally {
      setOpeningDrawer(false);
    }
  };

  const handleOpen = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateOpeningBasics()) return;

    if (!initialDrawerOpened) {
      setError('Debe imprimir el comprobante y abrir la caja para conteo inicial antes de registrar el turno.');
      return;
    }

    const emp = ALLOWED_EMPLOYEES.find((x) => x.id === selectedEmployee)!;
    const now = new Date();
    const empProf = getEmployeeProfile(emp.id);

    const newShift: Shift = {
      id: `shift-${now.getTime()}`,
      empleada: emp.name,
      baseInicial: baseCash,
      fechaApertura: now.toLocaleDateString('es-CO'),
      horaApertura: now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true }),
      createdAt: now.toISOString(),
      estado: 'abierto',
      observaciones: obs.trim() || undefined,
      empleadaNombreCompleto: empProf ? empProf.nombreCompleto : emp.name,
      empleadaFechaNacimiento: empProf ? empProf.fechaNacimientoTexto : undefined,
      cierreAnteriorId: lastClosure?.id || undefined,
      cierreAnteriorShiftId: lastClosure?.shiftId || undefined,
      cierreAnteriorEmpleadoEntrega: lastClosure?.empleadaEntrega || undefined,
      cierreAnteriorEmpleadoRecibe: lastClosure?.empleadoRecibe || undefined,
      cierreAnteriorFechaCierre: lastClosure?.fechaCierre || undefined,
      cierreAnteriorHoraCierre: lastClosure?.horaCierre || undefined,
      cierreAnteriorCajaQueDebiaQuedar: lastClosure?.cajaQueDebeQuedar,
      cierreAnteriorDineroDejado: lastClosure?.dineroDejadoEnCaja,
      baseSugeridaCierreAnterior: suggestedBaseFromClosure,
      baseConfirmadaApertura: baseCash,
      diferenciaBaseVsCierreAnterior: baseDifference,
      aperturaConDiferencia: openingWithDifferentBase,
      observacionDiferenciaBase: undefined
    };

    onOpenShift(newShift);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 selection:bg-emerald-500/20">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-6">
        
        {/* Header/Logo Placeholder */}
        <div className="text-center space-y-2">
          <div className="mx-auto bg-emerald-500/10 border border-emerald-500/20 p-3 w-16 h-16 rounded-2xl flex items-center justify-center">
            <Lock className="h-8 w-8 text-emerald-400" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">SISTEMA POS HOTEL KODIAK</h1>
          <p className="text-xs text-slate-400">ADMINISTRACIÓN DE TURNOS Y CAJA</p>
          <div className="inline-block bg-red-500/10 text-red-400 text-[10px] uppercase font-bold tracking-wider px-3 py-1 rounded-full border border-red-500/20">
            TURNO CERRADO
          </div>
        </div>

        {hasPreviousClosure && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-3">
            <div className="flex items-center gap-2 text-emerald-300 font-black uppercase text-[11px] tracking-wider">
              <ArrowRightLeft className="h-4 w-4" />
              <span>Base tomada del último cierre</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Entregó</span>
                <strong className="text-white">{getEmployeeFullName(lastClosure?.empleadaEntrega) || lastClosure?.empleadaEntrega || 'N/A'}</strong>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Recibe</span>
                <strong className="text-white">{getEmployeeFullName(lastClosure?.empleadoRecibe) || lastClosure?.empleadoRecibe || 'N/A'}</strong>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Fecha cierre</span>
                <strong className="text-slate-200">{lastClosure?.fechaCierre || 'N/A'} {lastClosure?.horaCierre || ''}</strong>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Caja dejada</span>
                <strong className="text-emerald-300 text-sm">{moneyText(suggestedBaseFromClosure)}</strong>
              </div>
            </div>
            <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3 text-[11px] text-slate-300 leading-relaxed">
              Este valor corresponde al cierre anterior y se conserva para consulta. <strong>La nueva base del turno siempre es $0.</strong> Si el dinero permanece físicamente en caja, registre su entrega o retiro por separado.
            </div>
          </div>
        )}

        {!hasPreviousClosure && (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-[11px] text-amber-200 flex gap-2 leading-relaxed">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>La apertura comienza con base $0. No se recuperan saldos de turnos anteriores.</span>
          </div>
        )}

        <form onSubmit={handleOpen} className="space-y-4">
          {/* Employee selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <UserCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span>Seleccione Empleada</span>
            </label>
            <select
              value={selectedEmployee}
              onChange={(e) => {
                setSelectedEmployee(e.target.value);
                setPassword('');
                setError('');
                setInitialDrawerOpened(false);
              }}
              className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30"
            >
              {ALLOWED_EMPLOYEES.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>

          {/* Tarjeta de Información de la Empleada Seleccionada */}
          {(() => {
            const empProf = getEmployeeProfile(selectedEmployee);
            if (!empProf) return null;
            return (
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3 shadow-inner">
                <p className="text-[10px] text-emerald-400 font-extrabold uppercase tracking-widest flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3" />
                  <span>Empleada Seleccionada</span>
                </p>
                <div className="space-y-0.5">
                  <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Nombre Completo</div>
                  <div className="text-sm font-bold text-white leading-tight">{empProf.nombreCompleto}</div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs border-t border-slate-800/60 pt-2.5">
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Nacimiento</span>
                    <span className="text-slate-300 font-semibold">{empProf.fechaNacimientoTexto}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Rol / Cargo</span>
                    <span className="text-emerald-400 font-bold uppercase text-[11px] tracking-wider">
                      {empProf.rol === 'recepcionista' ? 'Recepcionista' : empProf.rol}
                    </span>
                  </div>
                </div>
                <div className="text-[10px] text-slate-500 flex items-center gap-1.5 border-t border-slate-800/40 pt-2">
                  <span>Nombre operativo:</span>
                  <span className="bg-slate-900 px-2 py-0.5 rounded text-slate-300 font-mono font-black">{empProf.name}</span>
                </div>
              </div>
            );
          })()}

          {/* Password with view/hide eye icon */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
              <span>Contraseña de Turno</span>
              <span className="text-[10px] text-slate-500 font-mono">Requerido</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Ingrese contraseña de seguridad"
                autoComplete="new-password"
                className="w-full rounded-xl bg-slate-950 border border-slate-800 pl-3.5 pr-10 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-white transition-colors"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Base Cash */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Coins className="h-3.5 w-3.5 text-emerald-400" />
              <span>Base Inicial de Caja (COP)</span>
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={baseCashInput}
              onChange={(e) => setBaseCashInput(formatMoneyInput(e.target.value))}
              required
              aria-label="Efectivo inicial contado"
              className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2 text-sm text-white font-mono"
            />
            <span className="text-[10px] text-emerald-400 block">
              Declare cuánto dinero hay realmente en el cajón: {moneyText(baseCash)}. {hasPreviousClosure ? `El último cierre reportó ${moneyText(suggestedBaseFromClosure)} (solo referencia).` : 'Sin cierre anterior.'}
            </span>
          </div>

          {/* Observaciones */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Clipboard className="h-3.5 w-3.5 text-emerald-400" />
              <span>Novedades / Observaciones de Apertura</span>
            </label>
            <textarea
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Opcional. Registre novedades o retiros del efectivo que quedó del turno anterior."
              rows={2}
              className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 resize-none"
            />
          </div>

          <button
            type="button"
            onClick={handleInitialCashDrawer}
            disabled={openingDrawer}
            className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs border flex items-center justify-center gap-2 ${initialDrawerOpened ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300' : 'bg-amber-500/10 border-amber-500/40 text-amber-200 hover:bg-amber-500/20'}`}
          >
            <Unlock className="h-4 w-4" />
            {openingDrawer ? 'ABRIENDO CAJA...' : initialDrawerOpened ? 'CAJA ABIERTA PARA CONTEO INICIAL' : 'IMPRIMIR COMPROBANTE Y ABRIR CAJA PARA CONTEO INICIAL'}
          </button>

          {initialDrawerOpened && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 p-3 text-[11px] font-bold flex gap-2">
              <CheckCircle className="h-4 w-4 flex-shrink-0" />
              <span>Caja abierta. Registre la base realmente contada; las ventas en efectivo se sumarán y los egresos se restarán.</span>
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-200 p-3 rounded-xl text-xs font-medium">
              ⚠️ {error}
            </div>
          )}

          <button
            type="submit"
            className="w-full py-3 px-4 rounded-xl font-semibold text-sm bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white active:scale-[0.98] transition-all shadow-lg shadow-emerald-500/10"
          >
            ABRIR TURNO Y REGISTRAR BASE
          </button>
        </form>

        <div className="text-center pt-2 border-t border-slate-800/60">
          <p className="text-[10px] text-slate-500">
            SISTEMA POS HOTELES KODIAK © 2026 • TODOS LOS DERECHOS RESERVADOS
          </p>
        </div>
      </div>
    </div>
  );
};
