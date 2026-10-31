import React, { useMemo, useState } from 'react';
import { ShieldCheck, Coins, Package, ArrowRight, CheckCircle, ClipboardList, Unlock, AlertTriangle, ReceiptText } from 'lucide-react';
import { Shift, Sale, Expense, Product, ShiftClosure, ProductInventoryClosure, ALLOWED_EMPLOYEES, getEmployeeProfile, getEmployeeFullName, isProductVisible } from '../types';
import { formatCop } from '../utils/storage';
import { openBrowserPrintWindow, setBrowserPrintWindow, printAndOpenDrawerForPayrollWithdrawal, printShiftClosureReceipt } from '../services/printerService';
import { auth } from '../firebase';
import { calculateInventoryShortages, calculateProductCommission, calculateProductSalesTotal, isProductSale, isRoomSale } from '../kodiakRules';

function parseMoneyInput(value: string): number {
  const cleanValue = String(value || '').replace(/[^0-9]/g, '');
  return cleanValue ? Number(cleanValue) : 0;
}

function formatMoneyInput(value: number | null | undefined): string {
  const numericValue = Number(value || 0);
  if (!numericValue) return '';
  return String(Math.trunc(numericValue)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function buildCompactSaleDetail(sale: Sale) {
  return {
    id: sale.id,
    hora: sale.hora,
    fecha: sale.fecha,
    concepto: sale.concepto,
    tipoVenta: sale.tipoVenta,
    metodoPago: sale.metodoPago,
    total: Number(sale.total || 0),
    clienteNombre: sale.clienteNombre || (sale as any).clientName || '',
    clienteCedula: sale.clienteCedula || (sale as any).clientDocument || '',
    habitacionNombre: sale.habitacionNombre || (sale as any).roomName || '',
    productoNombre: sale.productoNombre || (sale as any).productName || '',
    cantidad: sale.cantidad || (sale as any).quantityChange || 0,
    acompanantes: (sale as any).acompanantes || [],
    numeroPersonas: (sale as any).numeroPersonas || 1
  };
}

function buildCompactExpenseDetail(expense: Expense) {
  return {
    id: expense.id,
    hora: expense.hora,
    fecha: expense.fecha,
    concepto: expense.concepto,
    categoria: expense.categoria,
    metodoPago: expense.metodoPago,
    valor: Number(expense.valor || 0),
    empleada: expense.empleada,
    observacion: expense.observacion || ''
  };
}

interface CierreProps {
  activeShift: Shift;
  sales: Sale[];
  expenses: Expense[];
  products: Product[];
  onConfirmClosure: (closure: ShiftClosure) => void;
  closureInProgress?: boolean;
  onStartClosure?: () => void;
  userProfile?: any;
}

export const CierreTurnoView: React.FC<CierreProps> = ({
  activeShift,
  sales = [],
  expenses = [],
  products = [],
  onConfirmClosure,
  closureInProgress = false,
  userProfile
}) => {
  const currentShiftSales = (Array.isArray(sales) ? sales : []).filter((s) => s.shiftId === activeShift.id);
  const currentShiftExpenses = (Array.isArray(expenses) ? expenses : []).filter((e) => e.shiftId === activeShift.id);
  const safeProducts = (Array.isArray(products) ? products : []).filter(isProductVisible);

  const salesCash = currentShiftSales.filter((s) => (s.metodoPago || '').toLowerCase() === 'efectivo').reduce((sum, s) => sum + Number(s.total || 0), 0);
  const salesTransfer = currentShiftSales.filter((s) => (s.metodoPago || '').toLowerCase() === 'transferencia').reduce((sum, s) => sum + Number(s.total || 0), 0);
  const totalSales = salesCash + salesTransfer;
  const expensesCash = currentShiftExpenses.filter((e) => (e.metodoPago || '').toLowerCase() === 'efectivo').reduce((sum, e) => sum + Number(e.valor || 0), 0);
  const expensesTransfer = currentShiftExpenses.filter((e) => (e.metodoPago || '').toLowerCase() === 'transferencia').reduce((sum, e) => sum + Number(e.valor || 0), 0);

  const productSalesTotal = calculateProductSalesTotal(currentShiftSales);
  const productCommission = calculateProductCommission(currentShiftSales);

  const [step, setStep] = useState<number>(1);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [payrollType, setPayrollType] = useState<string>('semana');
  const [payrollAmount, setPayrollAmount] = useState<number>(50000);
  const [physicalCounts, setPhysicalCounts] = useState<Record<string, number | ''>>({});
  const [productObservations, setProductObservations] = useState<Record<string, string>>({});
  const [productConfirmed, setProductConfirmed] = useState<Record<string, boolean>>({});
  const [inventoryLocked, setInventoryLocked] = useState<boolean>(false);
  const [receivingEmployee, setReceivingEmployee] = useState<string>('MILEIDYS');
  const [agreedHandover, setAgreedHandover] = useState<boolean>(false);
  const [moneyLeftInBox, setMoneyLeftInBox] = useState<number>(0);
  const [observations, setObservations] = useState<string>('');
  const [withdrawalReceiptPrinted, setWithdrawalReceiptPrinted] = useState<boolean>(false);
  const [isClosingShift, setIsClosingShift] = useState<boolean>(false);

  const handlePayrollTypeChange = (type: string) => {
    setPayrollType(type);
    if (type === 'medio') setPayrollAmount(25000);
    else if (type === 'semana') setPayrollAmount(50000);
    else if (type === 'finde') setPayrollAmount(55000);
    else setPayrollAmount(0);
  };

  const inventoryConteo: ProductInventoryClosure[] = useMemo(() => {
    return safeProducts.map((p) => {
      const raw = physicalCounts[p.id];
      const physical = raw === '' || raw === undefined || raw === null ? 0 : Number(raw || 0);
      const stockSistema = Number(p.stock || 0);
      const diferencia = physical - stockSistema;
      const faltante = Math.max(0, stockSistema - physical);
      const precioUnitario = Number(p.precio || 0);
      return {
        productoId: p.id,
        nombre: p.nombre,
        categoria: p.categoria,
        stockSistema,
        conteoFisico: physical,
        diferencia,
        observacion: (productObservations[p.id] || '').trim(),
        contadoFisicamente: !!productConfirmed[p.id],
        precioUnitario,
        faltante,
        valorDescuento: faltante * precioUnitario
      } as any;
    });
  }, [safeProducts, physicalCounts, productObservations, productConfirmed]);

  const shortageInfo = calculateInventoryShortages(inventoryConteo, safeProducts);
  const inventoryDiscount = shortageInfo.total;
  const authorizedPayroll = Math.max(0, payrollAmount + productCommission - inventoryDiscount);
  const baseInicial = activeShift?.baseInicial === 668500 ? 0 : Number(activeShift?.baseInicial || 0);
  const cashBeforePayroll = baseInicial + salesCash - expensesCash;
  const cashShouldRemain = cashBeforePayroll - authorizedPayroll;
  const finalCashDifference = moneyLeftInBox - cashShouldRemain;

  const roomSales = currentShiftSales.filter(isRoomSale).map(buildCompactSaleDetail);
  const productSales = currentShiftSales.filter(isProductSale).map(buildCompactSaleDetail);
  const saleDetails = currentShiftSales
    .filter((sale: any) => sale?.type !== 'stock_add' && sale?.tipoMovimiento !== 'abastecimiento_inventario')
    .map(buildCompactSaleDetail);
  const expenseDetails = currentShiftExpenses.map(buildCompactExpenseDetail);

  const handleConfirmBlindInventory = () => {
    setErrorMsg('');

    for (const product of safeProducts) {
      const raw = physicalCounts[product.id];
      if (raw === undefined || raw === null || raw === '' || Number.isNaN(Number(raw))) {
        setErrorMsg(`Debe digitar el conteo físico real de ${product.nombre}.`);
        return;
      }
      if (Number(raw) < 0) {
        setErrorMsg(`El conteo físico de ${product.nombre} no puede ser negativo.`);
        return;
      }
      const obs = (productObservations[product.id] || '').trim();
      if (obs.length < 2) {
        setErrorMsg(`Debe escribir observación obligatoria para ${product.nombre}. Ejemplo: "Conteo conforme" o explique la novedad.`);
        return;
      }
      if (!productConfirmed[product.id]) {
        setErrorMsg(`Debe confirmar que contó físicamente el producto ${product.nombre}.`);
        return;
      }
    }

    // IMPORTANTE: no usamos window.confirm aquí porque en Google AI Studio / algunos navegadores
    // el confirm puede quedarse bloqueado o no aparecer y parece que el botón no hiciera nada.
    // Al pasar de este punto el inventario queda bloqueado y ya no se puede regresar a modificarlo.
    setInventoryLocked(true);
    setWithdrawalReceiptPrinted(false);
    setStep(3);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePrintAndOpenWithdrawal = async () => {
    setErrorMsg('');
    if (!inventoryLocked) {
      setErrorMsg('Primero debe confirmar el conteo físico de inventario.');
      return;
    }

    let win: Window | null = null;
    try {
      win = openBrowserPrintWindow();
      setBrowserPrintWindow(win);
    } catch (error) {
      console.warn('No se pudo preabrir ventana de impresión para retiro:', error);
    }

    try {
      await printAndOpenDrawerForPayrollWithdrawal({
        shift: activeShift,
        employeeName: activeShift.empleada,
        receivingEmployee,
        payrollBase: payrollAmount,
        productCommission,
        inventoryDiscount,
        authorizedPayroll,
        productSalesTotal,
        shortageItems: shortageInfo.items,
        createdBy: auth?.currentUser?.uid || userProfile?.uid || 'system'
      }, win);
      setWithdrawalReceiptPrinted(true);
      window.alert(`Recibo de retiro enviado. Retire únicamente ${formatCop(authorizedPayroll)} de la caja.`);
    } catch (error: any) {
      setErrorMsg('No se pudo imprimir/abrir caja para retiro: ' + (error?.message || String(error)));
    }
  };

  const buildClosureData = (): ShiftClosure => {
    const now = new Date();
    const closureId = `closure-${Date.now()}`;
    const empEntregaProf = getEmployeeProfile(activeShift.empleada);
    const empRecibeProf = getEmployeeProfile(receivingEmployee);

    const movimientosTurno = [
      ...saleDetails.map((x) => ({ ...x, tipoMovimientoGeneral: 'venta' })),
      ...expenseDetails.map((x) => ({ ...x, tipoMovimientoGeneral: 'gasto' })),
      ...shortageInfo.items.map((x: any) => ({
        tipoMovimientoGeneral: 'faltante_inventario',
        concepto: `Faltante ${x.nombre}`,
        total: x.valorDescuento,
        cantidad: x.faltante,
        producto: x.nombre
      }))
    ];

    const closure: any = {
      id: closureId,
      shiftId: activeShift.id,
      turnoId: activeShift.id,
      empleadaEntrega: activeShift.empleada,
      empleadoRecibe: receivingEmployee,
      receiverEmployeeName: receivingEmployee,
      empleadaEntregaNombreCompleto: empEntregaProf?.nombreCompleto || getEmployeeFullName(activeShift.empleada) || activeShift.empleada,
      empleadaEntregaFechaNacimiento: empEntregaProf?.fechaNacimientoTexto || '',
      empleadaRecibeNombreCompleto: empRecibeProf?.nombreCompleto || getEmployeeFullName(receivingEmployee) || receivingEmployee,
      empleadaRecibeFechaNacimiento: empRecibeProf?.fechaNacimientoTexto || '',
      baseInicial: Number(activeShift.baseInicial || 0),
      ventasEfectivo: salesCash,
      ventasTransferencia: salesTransfer,
      totalVentas: totalSales,
      gastosEfectivo: expensesCash,
      gastosTransferencia: expensesTransfer,
      pagoBaseTurno: payrollAmount,
      comisionProductos: productCommission,
      descuentoInventario: inventoryDiscount,
      pagoAutorizadoRetirado: authorizedPayroll,
      nomina: authorizedPayroll,
      cajaAntesDePago: cashBeforePayroll,
      cajaQueDebeQuedar: cashShouldRemain,
      dineroDejadoEnCaja: moneyLeftInBox,
      diferenciaFinalCaja: finalCashDifference,
      // El dinero físico declarado se conserva arriba; no se traslada como base.
      baseParaSiguienteTurno: 0,
      baseSugeridaSiguienteTurno: 0,
      nextShiftBase: 0,
      cierreDejaCajaParaProximoTurno: false,
      totalEsperadoEfectivo: cashShouldRemain,
      dineroFisicoContado: moneyLeftInBox,
      diferenciaCaja: finalCashDifference,
      inventarioConteo: inventoryConteo,
      faltantesInventario: shortageInfo.items,
      productosConDiferencia: inventoryConteo.filter((x: any) => Number(x.diferencia || 0) !== 0),
      detalleVentas: saleDetails,
      detalleGastos: expenseDetails,
      movimientosTurno,
      resumenCierreExtendido: {
        habitacionesUsadas: roomSales.length,
        habitacionesDistintas: Array.from(new Set(roomSales.map((x) => x.habitacionNombre).filter(Boolean))).length,
        productosVendidosUnidades: productSales.reduce((sum, x: any) => sum + Number(x.cantidad || 0), 0),
        ventasProductosTotal: productSalesTotal,
        comisionProductos: productCommission,
        descuentoInventario: inventoryDiscount,
        pagoAutorizadoRetirado: authorizedPayroll,
        cajaAntesDePago: cashBeforePayroll,
        cajaQueDebeQuedar: cashShouldRemain,
        dineroDejadoEnCaja: moneyLeftInBox,
        baseParaSiguienteTurno: 0,
        diferenciaFinalCaja: finalCashDifference
      },
      observaciones: observations.trim(),
      fechaCierre: now.toLocaleDateString('es-CO'),
      horaCierre: now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true }),
      createdAt: now.toISOString(),
      createdBy: auth?.currentUser?.uid || userProfile?.uid || '',
      createdByEmail: auth?.currentUser?.email || userProfile?.email || '',
      estado: 'cerrado',
      status: 'closed',
      cierreConLiquidacion: true,
      conteoCiego: true,
      reciboRetiroImpreso: withdrawalReceiptPrinted
    };
    return closure as ShiftClosure;
  };

  const handleFinalClose = () => {
    setErrorMsg('');

    // IMPORTANTE HOTEL KODIAK:
    // No usamos closureInProgress del padre como bloqueo aquí porque puede quedar prendido
    // mientras el cierre se está guardando y hacer que el botón parezca congelado.
    // Solo protegemos contra doble clic con el estado local isClosingShift.
    if (isClosingShift) return;

    if (!inventoryLocked) {
      setErrorMsg('Debe confirmar el conteo físico ciego antes de cerrar.');
      return;
    }
    if (!withdrawalReceiptPrinted) {
      setErrorMsg('Debe imprimir el recibo y abrir caja para retirar el pago autorizado antes de cerrar.');
      return;
    }
    if (moneyLeftInBox === undefined || moneyLeftInBox === null || Number.isNaN(Number(moneyLeftInBox))) {
      setErrorMsg('Debe ingresar cuánto dinero deja físicamente en caja.');
      return;
    }
    if (!receivingEmployee) {
      setErrorMsg('Debe seleccionar la empleada que recibe el turno.');
      return;
    }
    if (!observations.trim()) {
      setErrorMsg('Debe escribir novedades generales del cierre. Si todo está bien, escriba: Todo conforme.');
      return;
    }
    if (!agreedHandover) {
      setErrorMsg('Debe marcar la confirmación de entrega con la empleada que recibe.');
      return;
    }

    setIsClosingShift(true);

    const closure = buildClosureData();

    // Abrimos la ventana de impresión en el MISMO clic para que Chrome/AI Studio no la bloquee.
    // Pero NO esperamos a que termine la impresión para guardar/cerrar el turno, porque eso era
    // lo que dejaba la pantalla congelada.
    let finalPrintWindow: Window | null = null;
    try {
      finalPrintWindow = openBrowserPrintWindow();
      if (finalPrintWindow) setBrowserPrintWindow(finalPrintWindow);
    } catch (windowError) {
      console.warn('No se pudo preabrir ventana del recibo final. Se intentará imprimir sin bloquear:', windowError);
    }

    // Primero cerramos/guardamos el turno para que la interfaz salga del cierre.
    try {
      const maybePromise = onConfirmClosure(closure) as any;
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch((saveError: any) => {
          console.error('Error guardando cierre desde onConfirmClosure:', saveError);
          setErrorMsg('El cierre intentó guardarse, pero ocurrió un error: ' + (saveError?.message || String(saveError)));
          setIsClosingShift(false);
        });
      }
    } catch (saveError: any) {
      console.error('Error inmediato consolidando cierre:', saveError);
      setErrorMsg('No se pudo consolidar el cierre: ' + (saveError?.message || String(saveError)));
      setIsClosingShift(false);
      return;
    }

    // Luego imprimimos el recibo total en segundo plano. Si la impresión falla, no debe impedir
    // que el turno quede cerrado ni dejar a la empleada atrapada en esta pantalla.
    window.setTimeout(() => {
      printShiftClosureReceipt(closure, finalPrintWindow)
        .catch((printError) => {
          console.warn('No se pudo imprimir el cierre total, pero el cierre ya fue enviado a guardar:', printError);
        });
    }, 250);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-red-400" />
              <span>Cierre y Liquidación de Turno</span>
            </h2>
            <p className="text-xs text-slate-400">Conteo físico ciego, pago autorizado, caja dejada y recibo total del turno.</p>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-bold font-mono">
            <span className={`px-2.5 py-1 rounded-full ${step === 1 ? 'bg-red-500 text-white' : 'bg-slate-950 text-slate-500'}`}>1. Nómina</span>
            <span className="text-slate-800">→</span>
            <span className={`px-2.5 py-1 rounded-full ${step === 2 ? 'bg-red-500 text-white' : 'bg-slate-950 text-slate-500'}`}>2. Conteo Ciego</span>
            <span className="text-slate-800">→</span>
            <span className={`px-2.5 py-1 rounded-full ${step === 3 ? 'bg-red-500 text-white' : 'bg-slate-950 text-slate-500'}`}>3. Retiro y Caja</span>
          </div>
        </div>
      </div>

      {step === 1 && (
        <div className="bg-slate-900/60 border border-slate-900 rounded-3xl p-6 space-y-5">
          <h3 className="text-xs font-bold text-red-400 uppercase tracking-widest border-b border-slate-800 pb-2 flex items-center gap-2">
            <Coins className="h-4 w-4" />
            <span>Paso 1: Pago base y comisión del turno</span>
          </h3>
          <p className="text-xs text-slate-300 leading-relaxed">Seleccione el pago base de <strong>{getEmployeeFullName(activeShift.empleada) || activeShift.empleada}</strong>. La comisión del 10% sobre productos se calcula automáticamente.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {[
              ['medio', 'Medio turno', 25000],
              ['semana', 'Turno entre semana', 50000],
              ['finde', 'Turno fin de semana', 55000],
              ['ninguno', 'Otro / no pagar base', 0]
            ].map(([type, label, value]: any) => (
              <button key={type} type="button" onClick={() => handlePayrollTypeChange(type)} className={`p-4 rounded-xl border text-left flex justify-between items-center transition-all ${payrollType === type ? 'bg-red-500/10 border-red-500 text-white font-bold' : 'bg-slate-950 border-slate-850 text-slate-400 hover:text-slate-300'}`}>
                <span>{label}</span><strong className={value > 0 ? 'text-red-400' : 'text-slate-500'}>{formatCop(value)}</strong>
              </button>
            ))}
          </div>

          {payrollType === 'ninguno' && (
            <div className="space-y-1">
              <label className="text-[11px] text-slate-400">Ingrese valor base personalizado:</label>
              <input type="text" inputMode="numeric" value={formatMoneyInput(payrollAmount)} onChange={(e) => setPayrollAmount(parseMoneyInput(e.target.value))} placeholder="Ej. 50.000" className="w-full sm:max-w-xs bg-slate-950 text-xs text-white p-2 rounded-lg border border-slate-800 font-mono" />
            </div>
          )}

          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-850 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div><span className="text-slate-500 block">Productos vendidos</span><strong className="text-slate-200">{formatCop(productSalesTotal)}</strong></div>
            <div><span className="text-slate-500 block">Comisión 10%</span><strong className="text-emerald-400">+{formatCop(productCommission)}</strong></div>
            <div><span className="text-slate-500 block">Pago base</span><strong className="text-red-300">{formatCop(payrollAmount)}</strong></div>
          </div>

          <div className="flex justify-end pt-2">
            <button type="button" onClick={() => setStep(2)} className="py-2.5 px-5 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white rounded-xl text-xs font-bold flex items-center gap-1 shadow-md">
              <span>Siguiente: Conteo Físico Ciego</span><ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="bg-slate-900/60 border border-slate-900 rounded-3xl p-6 space-y-5">
          <h3 className="text-xs font-bold text-red-400 uppercase tracking-widest border-b border-slate-800 pb-2 flex items-center gap-2">
            <Package className="h-4 w-4" />
            <span>Paso 2: Conteo físico ciego obligatorio</span>
          </h3>
          <div className="bg-amber-500/10 border border-amber-500/20 text-amber-200 p-3 rounded-xl text-xs leading-relaxed">
            <strong>Importante:</strong> durante este paso la empleada no ve el stock del sistema. Debe contar físicamente TODOS los productos, escribir observación y confirmar cada conteo. Al pasar al siguiente paso no podrá devolverse.
          </div>

          <div className="space-y-3">
            {safeProducts.length === 0 ? (
              <p className="text-xs text-slate-500 italic">No hay productos activos en inventario.</p>
            ) : safeProducts.map((p) => (
              <div key={p.id} className="bg-slate-950 border border-slate-850 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                <div className="sm:col-span-3">
                  <span className="font-bold text-white block">{p.nombre}</span>
                  <span className="text-[10px] text-slate-500 uppercase">{p.categoria}</span>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] text-slate-500 block mb-1">Conteo físico *</label>
                  <input type="number" min={0} value={physicalCounts[p.id] ?? ''} onChange={(e) => setPhysicalCounts((prev) => ({ ...prev, [p.id]: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) }))} placeholder="0" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white font-bold text-center" />
                </div>
                <div className="sm:col-span-5">
                  <label className="text-[10px] text-slate-500 block mb-1">Observación obligatoria *</label>
                  <input type="text" value={productObservations[p.id] || ''} onChange={(e) => setProductObservations((prev) => ({ ...prev, [p.id]: e.target.value }))} placeholder="Conteo conforme / faltó / dañado / vencido" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white" />
                </div>
                <label className="sm:col-span-2 flex items-center gap-2 text-[11px] text-slate-300">
                  <input type="checkbox" checked={!!productConfirmed[p.id]} onChange={(e) => setProductConfirmed((prev) => ({ ...prev, [p.id]: e.target.checked }))} />
                  Contado
                </label>
              </div>
            ))}
          </div>

          {errorMsg && <div className="text-xs bg-red-500/10 border border-red-500/20 text-red-200 p-2.5 rounded-xl font-medium">⚠️ {errorMsg}</div>}

          <div className="flex justify-between pt-4 border-t border-slate-850/80">
            <button type="button" onClick={() => setStep(1)} className="py-2 px-4 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white rounded-xl text-xs font-semibold">Volver</button>
            <button type="button" onClick={handleConfirmBlindInventory} className="py-2.5 px-5 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white rounded-xl text-xs font-bold flex items-center gap-1 shadow-md">
              <span>Confirmar Conteo, Bloquear Inventario y Pasar a Retiro</span><ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="bg-slate-900/60 border border-slate-900 rounded-3xl p-6 space-y-6">
          <h3 className="text-xs font-bold text-red-400 uppercase tracking-widest border-b border-slate-800 pb-2 flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            <span>Paso 3: Retiro autorizado, dinero dejado y cierre final</span>
          </h3>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-850 space-y-2 text-xs">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">Liquidación de la empleada</span>
              <div className="flex justify-between"><span>Pago base:</span><span>{formatCop(payrollAmount)}</span></div>
              <div className="flex justify-between"><span>Comisión productos 10%:</span><span className="text-emerald-400">+{formatCop(productCommission)}</span></div>
              <div className="flex justify-between"><span>Descuento faltantes total:</span><span className="text-red-400">-{formatCop(inventoryDiscount)}</span></div>

              {shortageInfo.items.length > 0 ? (
                <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 p-3 space-y-2">
                  <div className="text-[10px] font-black uppercase tracking-widest text-red-300">
                    Desglose de descuentos aplicados
                  </div>
                  {shortageInfo.items.map((item: any) => (
                    <div
                      key={item.productoId || item.nombre}
                      className="rounded-lg bg-slate-950/80 border border-slate-800 p-2 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-black text-white uppercase truncate">{item.nombre}</span>
                        <span className="font-black text-red-400 shrink-0">-{formatCop(item.valorDescuento)}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-[10px] text-slate-400">
                        <span>Sis: <b className="text-white">{item.stockSistema}</b></span>
                        <span>Fís: <b className="text-white">{item.conteoFisico}</b></span>
                        <span>Faltan: <b className="text-red-300">{item.faltante}</b></span>
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {item.faltante} und. x {formatCop(item.precioUnitario)} = <b className="text-red-300">{formatCop(item.valorDescuento)}</b> descontado
                      </div>
                      {item.observacion && (
                        <div className="text-[10px] italic text-slate-400">Obs: {item.observacion}</div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-[10px] font-bold text-emerald-300">
                  Sin faltantes de inventario. No se aplica descuento.
                </div>
              )}

              <div className="flex justify-between border-t border-slate-800 pt-2 text-emerald-400 font-black text-sm"><span>VALOR AUTORIZADO A RETIRAR:</span><span>{formatCop(authorizedPayroll)}</span></div>
              <button type="button" onClick={handlePrintAndOpenWithdrawal} className="w-full mt-3 py-2.5 px-4 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2">
                <Unlock className="h-4 w-4" /> IMPRIMIR RECIBO Y ABRIR CAJA PARA RETIRO
              </button>
              {withdrawalReceiptPrinted && <p className="text-[10px] text-emerald-400 font-bold">Recibo de retiro emitido. Retire únicamente {formatCop(authorizedPayroll)}.</p>}
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-850 space-y-2 text-xs">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">Entrega de caja después del retiro</span>
              <div className="flex justify-between"><span>Base inicial:</span><span>{formatCop(baseInicial)}</span></div>
              <div className="flex justify-between"><span>Ventas efectivo:</span><span>{formatCop(salesCash)}</span></div>
              <div className="flex justify-between"><span>Gastos efectivo:</span><span className="text-red-400">-{formatCop(expensesCash)}</span></div>
              <div className="flex justify-between"><span>Caja antes de pago:</span><span>{formatCop(cashBeforePayroll)}</span></div>
              <div className="flex justify-between"><span>Pago retirado:</span><span className="text-red-400">-{formatCop(authorizedPayroll)}</span></div>
              <div className="flex justify-between font-bold text-emerald-400 border-t border-slate-800 pt-2"><span>Caja que debe quedar:</span><span>{formatCop(cashShouldRemain)}</span></div>
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-[11px] text-emerald-300 font-bold leading-relaxed">
                El valor que escriba abajo será la <strong>base sugerida del siguiente turno</strong>. La empleada que recibe lo verá al abrir caja.
              </div>
              <div className="space-y-1.5 pt-2">
                <label className="text-xs text-slate-300 font-bold flex items-center gap-1.5"><Coins className="h-3.5 w-3.5 text-emerald-400" />Dinero que deja físicamente en caja *</label>
                <input type="text" inputMode="numeric" value={formatMoneyInput(moneyLeftInBox)} onChange={(e) => setMoneyLeftInBox(parseMoneyInput(e.target.value))} placeholder={`Debe quedar ${formatCop(cashShouldRemain)}`} className="w-full bg-slate-900 text-sm font-mono font-bold text-white p-2.5 rounded-xl border border-slate-800" />
              </div>
              {moneyLeftInBox !== cashShouldRemain && <div className={`p-3 rounded-lg border text-xs font-medium ${finalCashDifference >= 0 ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-red-500/10 border-red-500/20 text-red-300'}`}>{finalCashDifference >= 0 ? `Sobrante: ${formatCop(finalCashDifference)}` : `Faltante: ${formatCop(Math.abs(finalCashDifference))}`}</div>}
            </div>
          </div>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-850 space-y-3">
            <h4 className="text-xs font-black text-white uppercase flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-400" /> Resultado de inventario</h4>
            <div className="space-y-2">
              {inventoryConteo.map((item: any) => (
                <div key={item.productoId} className="grid grid-cols-1 sm:grid-cols-5 gap-2 text-xs bg-slate-900/60 rounded-xl p-3">
                  <strong className="text-white">{item.nombre}</strong>
                  <span>Sis: <b>{item.stockSistema}</b></span>
                  <span>Fís: <b>{item.conteoFisico}</b></span>
                  <span className={item.faltante > 0 ? 'text-red-400 font-bold' : 'text-emerald-400'}>{item.faltante > 0 ? `Faltan ${item.faltante} (${formatCop(item.valorDescuento)})` : 'Conforme'}</span>
                  <span className="text-slate-400 italic">{item.observacion}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Empleada que recibe el turno *</label>
              <select value={receivingEmployee} onChange={(e) => setReceivingEmployee(e.target.value)} className="w-full bg-slate-950 text-xs text-white p-2 rounded-xl border border-slate-850">
                {ALLOWED_EMPLOYEES.filter(emp => emp.name !== activeShift.empleada).map((x) => <option key={x.id} value={x.id}>{x.nombreCompleto} ({x.name})</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400 font-medium">Novedades generales del cierre *</label>
              <input type="text" value={observations} onChange={(e) => setObservations(e.target.value)} placeholder="Si todo está bien escriba: Todo conforme" className="w-full bg-slate-950 text-xs text-white p-2 rounded-xl border border-slate-850" />
            </div>
          </div>

          <div className="bg-slate-950/40 p-4 rounded-xl border border-slate-900 flex items-start gap-3">
            <input type="checkbox" id="handover-agree" checked={agreedHandover} onChange={(e) => setAgreedHandover(e.target.checked)} className="mt-1 w-4 h-4 text-emerald-500 border-slate-800 bg-slate-950 rounded" />
            <label htmlFor="handover-agree" className="text-xs text-slate-400 leading-normal select-none">Confirmo que el valor dejado en caja fue contado físicamente con la empleada receptora <strong>{getEmployeeFullName(receivingEmployee)}</strong> y que el pago autorizado retirado fue de <strong>{formatCop(authorizedPayroll)}</strong>.</label>
          </div>

          {errorMsg && <div className="text-xs bg-red-500/10 border border-red-500/20 text-red-200 p-2.5 rounded-xl font-medium">⚠️ {errorMsg}</div>}

          <div className="flex justify-end pt-4 border-t border-slate-850/80">
            <button type="button" onClick={handleFinalClose} disabled={isClosingShift} className={`py-3 px-6 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-red-500/20 ${isClosingShift ? 'opacity-50 cursor-not-allowed' : ''}`}>
              <CheckCircle className="h-4 w-4" /><span>{isClosingShift ? 'REGISTRANDO CIERRE...' : 'CONSOLIDAR, IMPRIMIR CIERRE TOTAL Y SALIR'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};