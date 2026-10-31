import React, { useState } from 'react';
import { Coins, Plus, TrendingUp, TrendingDown, ClipboardList, Wallet, FileText, Check, X, Unlock } from 'lucide-react';
import { Shift, Sale, Expense, PaymentMethod } from '../types';
import { formatCop, isInvalidValue } from '../utils/storage';
import { openCashDrawer, getSettings, openBrowserPrintWindow, setBrowserPrintWindow } from '../services/printerService';
import { saveCashDrawerLog } from '../services/firebaseService';

function parseMoneyInput(value: string): number {
  const onlyNumbers = String(value || '').replace(/\D/g, '');
  return onlyNumbers ? Number(onlyNumbers) : 0;
}

function formatMoneyInput(value: number | string | null | undefined): string {
  const numberValue =
    typeof value === 'number'
      ? value
      : parseMoneyInput(String(value || ''));

  if (!numberValue || Number.isNaN(numberValue)) {
    return '';
  }

  return new Intl.NumberFormat('es-CO', {
    maximumFractionDigits: 0
  }).format(numberValue);
}

interface CajaProps {
  activeShift: Shift;
  sales: Sale[];
  expenses: Expense[];
  onAddExpense: (expense: Expense) => void;
  userProfile?: any;
}

export const CajaView: React.FC<CajaProps> = ({
  activeShift,
  sales,
  expenses,
  onAddExpense,
  userProfile
}) => {
  // No contar movimientos de abastecimiento o auditoría como ventas.
  const currentShiftSales = (Array.isArray(sales) ? sales : []).filter((s: any) =>
    s.shiftId === activeShift.id &&
    s.type !== 'stock_add' &&
    s.tipoVenta !== 'inventario' &&
    s.metodoPago !== 'N/A' &&
    Number(s.total || 0) > 0
  );
  const currentShiftExpenses = (Array.isArray(expenses) ? expenses : []).filter((e) => e.shiftId === activeShift.id);

  // Totals calculations
  const totalSalesCash = currentShiftSales.filter((s) => (s.metodoPago || '').toLowerCase() === 'efectivo').reduce((sum, s) => sum + s.total, 0);
  const totalSalesTransfer = currentShiftSales.filter((s) => (s.metodoPago || '').toLowerCase() === 'transferencia').reduce((sum, s) => sum + s.total, 0);
  const totalSales = totalSalesCash + totalSalesTransfer;

  const totalExpensesCash = currentShiftExpenses.filter((e) => (e.metodoPago || '').toLowerCase() === 'efectivo').reduce((sum, e) => sum + e.valor, 0);
  const totalExpensesTransfer = currentShiftExpenses.filter((e) => (e.metodoPago || '').toLowerCase() === 'transferencia').reduce((sum, e) => sum + e.valor, 0);
  const totalExpenses = totalExpensesCash + totalExpensesTransfer;

  // Base operativa siempre 0, incluso si un turno viejo traía un valor heredado.
  // No reescribir aquí el registro histórico de Firestore.
  const baseInicial = 0;
  const expectedCashInBox = totalSalesCash - totalExpensesCash;

  // New Expense form states
  const [showExpenseModal, setShowExpenseModal] = useState<boolean>(false);
  const [concepto, setConcepto] = useState<string>('');
  const [categoria, setCategoria] = useState<string>('Servicios');
  const [valor, setValor] = useState<number>(0);
  const [metodoPago, setMetodoPago] = useState<PaymentMethod>('Efectivo');
  const [observacion, setObservacion] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');

  const handleManualOpenDrawer = async () => {
    // Only visible/executable for admin and recepcionista
    const userRole = userProfile?.rol;
    if (userRole !== 'admin' && userRole !== 'recepcionista') {
      window.alert("No tiene permisos para abrir el cajón monedero.");
      return;
    }

    const pin = window.prompt("Ingrese el PIN administrativo para abrir el cajón monedero (4321):");
    if (pin !== "4321") {
      window.alert("PIN administrativo incorrecto. Operación cancelada.");
      return;
    }

    const reason = window.prompt("Ingrese el motivo de la apertura manual:", "Ajuste de caja / Dar cambio");
    if (reason === null) return; // Cancelled

    try {
      await openCashDrawer();
      
      const auditLog = {
        type: "cash_drawer_opened",
        source: "manual",
        reason: reason || "Apertura manual autorizada",
        employeeName: userProfile?.nombre || activeShift.empleada || "Recepcionista",
        createdBy: userProfile?.uid || userProfile?.id || activeShift.id || "manual",
        fecha: new Date().toLocaleDateString('es-CO'),
        hora: new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      };
      await saveCashDrawerLog(auditLog);
      
      window.alert("¡Cajón monedero abierto con éxito!");
    } catch (error: any) {
      window.alert(`No se pudo abrir el cajón: ${error.message || String(error)}`);
    }
  };

  const handleRegisterExpense = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (isInvalidValue(concepto)) {
      setErrorMsg('El concepto del gasto es obligatorio.');
      return;
    }

    if (valor <= 0 || isNaN(valor)) {
      setErrorMsg('El valor del gasto debe ser un número mayor a 0.');
      return;
    }

    // Pre-open print window if browser printer is active, before any async/state updates
    const settings = getSettings();
    let initialPrintWindow: Window | null = null;
    if (settings.printerType === 'browser') {
      initialPrintWindow = openBrowserPrintWindow();
      if (initialPrintWindow) {
        setBrowserPrintWindow(initialPrintWindow);
      }
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    
    const formattedDate = `${year}-${month}-${day}`;
    const formattedTime = `${hours}:${minutes}`;

    const newExpense: Expense = {
      id: `expense-${now.getTime()}`,
      shiftId: activeShift.id,
      concepto: concepto.trim().toUpperCase(),
      categoria,
      metodoPago, // 'Efectivo' or 'Transferencia'
      valor,
      empleada: activeShift.empleada,
      observacion: observacion.trim(),
      fecha: formattedDate,
      hora: formattedTime,
      createdAt: now.toISOString(),

      // Additional requested fields
      type: "expense",
      tipoMovimiento: metodoPago === 'Efectivo' ? "egreso_caja" : "egreso_banco",
      afectaCaja: metodoPago === 'Efectivo',
      imprimirComprobante: true,
      abrirCaja: metodoPago === 'Efectivo',
      turnoId: activeShift.id,
      createdBy: userProfile?.uid || userProfile?.id || ""
    };

    onAddExpense(newExpense);
    setShowExpenseModal(false);

    // Reset fields
    setConcepto('');
    setValor(0);
    setObservacion('');
    setSuccessMsg('Gasto registrado con éxito.');
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  return (
    <div className="space-y-6">
      
      {/* Action Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-900 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Coins className="h-5 w-5 text-emerald-400" />
            <span>Manejo de Caja & Registro de Gastos</span>
          </h2>
          <p className="text-xs text-slate-400">Administre el flujo del efectivo en caja y registre egresos por compras o nómina.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* MANUAL CASH DRAWER OPEN ACTION */}
          {(userProfile?.rol === 'admin' || userProfile?.rol === 'recepcionista') && (
            <button
              onClick={handleManualOpenDrawer}
              className="py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 active:scale-[0.98] transition-all"
            >
              <Unlock className="h-4 w-4" />
              <span>ABRIR CAJÓN</span>
            </button>
          )}

          <button
            onClick={() => {
              setErrorMsg('');
              setShowExpenseModal(true);
            }}
            className="py-2.5 px-4 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 active:scale-[0.98] transition-all"
          >
            <Plus className="h-4 w-4" />
            <span>Registrar Gasto (Egreso)</span>
          </button>
        </div>
      </div>

      {successMsg && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 p-3.5 rounded-xl text-xs font-medium">
          ✅ {successMsg}
        </div>
      )}

      {/* Grid: Financial status summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Expected Cash */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between h-28 relative overflow-hidden">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Caja Física Esperada</span>
            <div className="bg-emerald-500/10 p-1.5 rounded-lg text-emerald-400">
              <Wallet className="h-4 w-4" />
            </div>
          </div>
          <div>
            <p className={`text-xl font-black ${expectedCashInBox < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatCop(expectedCashInBox)}</p>
            <p className="text-[9px] text-slate-500 font-medium">Base inicial ($0) + ventas en efectivo - egresos en efectivo</p>
            {expectedCashInBox < 0 && (
              <p className="text-[9px] text-red-300">Saldo negativo: falta registrar el ingreso o justificar de dónde salió el efectivo usado para el gasto.</p>
            )}
          </div>
        </div>

        {/* Total Sales */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between h-28 relative overflow-hidden">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Recaudado</span>
            <div className="bg-emerald-500/10 p-1.5 rounded-lg text-emerald-400">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div>
            <p className="text-xl font-black text-white">{formatCop(totalSales)}</p>
            <div className="flex justify-between text-[9px] text-slate-500 mt-1">
              <span>Efectivo: {formatCop(totalSalesCash)}</span>
              <span>Transf: {formatCop(totalSalesTransfer)}</span>
            </div>
          </div>
        </div>

        {/* Total Expenses */}
        <div className="bg-slate-900/60 border border-slate-850 rounded-2xl p-4 flex flex-col justify-between h-28 relative overflow-hidden">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Egresos (Gastos)</span>
            <div className="bg-red-500/10 p-1.5 rounded-lg text-red-400">
              <TrendingDown className="h-4 w-4" />
            </div>
          </div>
          <div>
            <p className="text-xl font-black text-red-400">{formatCop(totalExpenses)}</p>
            <div className="flex justify-between text-[9px] text-slate-500 mt-1">
              <span>Efectivo: {formatCop(totalExpensesCash)}</span>
              <span>Transf: {formatCop(totalExpensesTransfer)}</span>
            </div>
          </div>
        </div>

        {/* Sales logged count */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between h-28 relative overflow-hidden">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Cant. Transacciones</span>
            <div className="bg-indigo-500/10 p-1.5 rounded-lg text-indigo-400">
              <ClipboardList className="h-4 w-4" />
            </div>
          </div>
          <div>
            <p className="text-xl font-black text-slate-200">{currentShiftSales.length} Ventas</p>
            <p className="text-[9px] text-slate-500 font-medium">Registradas por la empleada {activeShift.empleada}</p>
          </div>
        </div>

      </div>

      {/* Two panels layout for Sales Log and Expense Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Left: Sales list log */}
        <div className="bg-slate-900/40 border border-slate-900 rounded-2xl p-5 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-300 border-b border-slate-850 pb-2 flex items-center justify-between">
            <span>REGISTRO DE INGRESOS (VENTAS) DEL TURNO</span>
            <span className="text-[10px] bg-slate-950 px-2 py-0.5 rounded text-slate-500">Filtrado por turno</span>
          </h3>

          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {currentShiftSales.length === 0 ? (
              <p className="text-xs text-slate-500 italic text-center py-8">Aún no se han registrado ventas en el turno actual.</p>
            ) : (
              currentShiftSales.map((sale) => (
                <div key={sale.id} className="p-3 bg-slate-950 border border-slate-850 rounded-xl flex justify-between items-center text-xs">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-slate-200">{sale.concepto}</span>
                      <span className={`text-[8px] px-1.5 py-0.2 rounded-full uppercase ${
                        sale.metodoPago === 'Efectivo' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-indigo-500/15 text-indigo-400'
                      }`}>
                        {sale.metodoPago}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono mt-1 block">
                      {sale.hora} • {sale.clienteNombre || 'Sin cliente'}
                    </span>
                  </div>
                  <strong className="text-emerald-400 font-extrabold">{formatCop(sale.total)}</strong>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: Expenses list log */}
        <div className="bg-slate-900/40 border border-slate-900 rounded-2xl p-5 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-300 border-b border-slate-850 pb-2 flex items-center justify-between">
            <span>REGISTRO DE EGRESOS (GASTOS) DEL TURNO</span>
            <span className="text-[10px] bg-slate-950 px-2 py-0.5 rounded text-slate-500">Gasto total: {formatCop(totalExpenses)}</span>
          </h3>

          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {currentShiftExpenses.length === 0 ? (
              <p className="text-xs text-slate-500 italic text-center py-8">No se han registrado egresos o gastos en el turno.</p>
            ) : (
              currentShiftExpenses.map((exp) => (
                <div key={exp.id} className="p-3 bg-slate-950 border border-slate-850 rounded-xl flex justify-between items-center text-xs">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-slate-200">{exp.concepto}</span>
                      <span className="text-[9px] text-slate-500">[{exp.categoria}]</span>
                      <span className={`text-[8px] px-1.5 py-0.2 rounded-full uppercase bg-red-500/20 text-red-300`}>
                        {exp.metodoPago}
                      </span>
                    </div>
                    {exp.observacion && (
                      <p className="text-[10px] text-slate-400 italic mt-0.5">"{exp.observacion}"</p>
                    )}
                    <span className="text-[10px] text-slate-500 font-mono mt-1 block">
                      {exp.hora} • Empleada: {exp.empleada}
                    </span>
                  </div>
                  <strong className="text-red-400 font-extrabold">-{formatCop(exp.valor)}</strong>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

      {/* Modal: Register expense */}
      {showExpenseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <form onSubmit={handleRegisterExpense} className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-start border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">REGISTRAR EGRESO / GASTO</h3>
                <p className="text-[10px] text-slate-400">Ingrese los datos para descontar del saldo físico de caja.</p>
              </div>
              <button type="button" onClick={() => setShowExpenseModal(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3.5">
              
              <div className="space-y-1">
                <label className="text-xs text-slate-300 font-semibold block">Concepto del Egreso *</label>
                <input
                  type="text"
                  value={concepto}
                  onChange={(e) => setConcepto(e.target.value)}
                  placeholder="Ej. COMPRA PAPEL HIGIENICO"
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-1.5 text-xs text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-300 font-semibold block">Categoría de Egreso</label>
                <select
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
                >
                  <option value="Aseo">Aseo y desinfectantes</option>
                  <option value="Mantenimiento">Mantenimiento de habitaciones</option>
                  <option value="Servicios">Servicios Públicos / Internet</option>
                  <option value="Proveedores">Surtido de productos</option>
                  <option value="Nomina">Adelanto de Nómina / Pago</option>
                  <option value="Otros">Otros egresos menores</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-300 font-semibold block">Valor del Egreso (COP) *</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={formatMoneyInput(valor)}
                  onChange={(e) => setValor(parseMoneyInput(e.target.value))}
                  placeholder="Ej. 40.000"
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-1.5 text-xs text-white font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-300 font-semibold block">Método de Egreso</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMetodoPago('Efectivo')}
                    className={`flex-1 py-1.5 rounded-lg border text-xs font-bold ${
                      metodoPago === 'Efectivo' ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400' : 'bg-slate-950 border-slate-850 text-slate-400'
                    }`}
                  >
                    Efectivo de Caja
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetodoPago('Transferencia')}
                    className={`flex-1 py-1.5 rounded-lg border text-xs font-bold ${
                      metodoPago === 'Transferencia' ? 'bg-indigo-500/10 border-indigo-500 text-indigo-400' : 'bg-slate-950 border-slate-850 text-slate-400'
                    }`}
                  >
                    Transferencia Hotel
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-300 font-semibold block">Observaciones / Detalles</label>
                <textarea
                  value={observacion}
                  onChange={(e) => setObservacion(e.target.value)}
                  placeholder="Escriba proveedor, nro de recibo, etc."
                  rows={2}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-1.5 text-xs text-white resize-none"
                />
              </div>

              {errorMsg && (
                <div className="text-xs bg-red-500/10 border border-red-500/20 text-red-200 p-2.5 rounded-xl">
                  ⚠️ {errorMsg}
                </div>
              )}

              <button
                type="submit"
                className="w-full py-2.5 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white rounded-xl text-xs font-bold transition-all shadow-md"
              >
                REGISTRAR EGRESO FÍSICO
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
};