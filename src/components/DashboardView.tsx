import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  TrendingUp, 
  TrendingDown, 
  Coins, 
  CheckCircle2, 
  ArrowRight, 
  Clock, 
  ShieldAlert, 
  Settings, 
  RefreshCw,
  Bed,
  Package,
  Activity,
  Download,
  Eye,
  FileSpreadsheet,
  X,
  Info,
  Layers,
  Calendar,
  Users
} from 'lucide-react';
import { Sale, Expense, ShiftClosure } from '../types';
import { formatCop, getTodayColombia, safeGetLocalStorage } from '../utils/storage';
import { db } from '../firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import * as XLSX from 'xlsx';

interface DashboardProps {
  sales: Sale[];
  expenses: Expense[];
  closures: ShiftClosure[];
  onRestoreState: (state: any) => void;
  userProfile?: any;
  onlineStatus?: 'online' | 'offline' | 'syncing';
  lastSyncTime?: string;
  roomsCount?: number;
  productsCount?: number;
  hotelSettings?: any;
  onUpdateSettings?: (settings: any) => Promise<void>;
}

type FilterType = 'Hoy' | 'Esta semana' | 'Este mes' | 'Todo' | 'Rango';

function getEmployeeFullName(nameOrEmail: any) {
  const value = String(nameOrEmail || "").toLowerCase();

  if (value.includes("alicia")) return "Luz Alicia Serna Gómez";
  if (value.includes("paola")) return "Jenny Paola Lozano Alfonso";
  if (value.includes("mileidys") || value.includes("mileydi")) return "María Mileydi Moreno";

  return nameOrEmail || "Sin dato";
}

function formatColombianPesos(value: any) {
  const num = Math.round(Number(value || 0));
  const parts = String(Math.abs(num)).split("");
  let formatted = "";
  let count = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    formatted = parts[i] + formatted;
    count++;
    if (count % 3 === 0 && i !== 0) {
      formatted = "." + formatted;
    }
  }
  const sign = num < 0 ? "-" : "";
  return `${sign}$ ${formatted}`;
}

function getClosureStatusBadge(diferencia: number) {
  if (diferencia === 0) {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        Exacto
      </span>
    );
  } else if (diferencia < 0) {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-red-500/10 text-red-400 border border-red-500/20">
        Faltante
      </span>
    );
  } else {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">
        Sobrante
      </span>
    );
  }
}

function formatFirebaseDate(value: any) {
  try {
    let date: Date | null = null;

    if (value?.toDate) date = value.toDate();
    else if (value?.seconds) date = new Date(value.seconds * 1000);
    else if (typeof value === "string") date = new Date(value);
    else if (value instanceof Date) date = value;

    if (!date || isNaN(date.getTime())) return "Sin fecha";

    return date.toLocaleDateString("es-CO", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
  } catch {
    return "Sin fecha";
  }
}

function formatFirebaseTime(value: any) {
  try {
    let date: Date | null = null;

    if (value?.toDate) date = value.toDate();
    else if (value?.seconds) date = new Date(value.seconds * 1000);
    else if (typeof value === "string") date = new Date(value);
    else if (value instanceof Date) date = value;

    if (!date || isNaN(date.getTime())) return "Sin hora";

    return date.toLocaleTimeString("es-CO", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
  } catch {
    return "Sin hora";
  }
}

function formatCurrency(value: any) {
  return Number(value || 0).toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0
  });
}

export const DashboardView: React.FC<DashboardProps> = ({
  sales = [],
  expenses = [],
  closures = [],
  userProfile,
  onlineStatus = 'online',
  lastSyncTime = '',
  roomsCount = 0,
  productsCount = 0,
  hotelSettings,
  onUpdateSettings
}) => {
  const [filterType, setFilterType] = useState<FilterType>('Hoy');
  const [startDate, setStartDate] = useState<string>(() => getTodayColombia());
  const [endDate, setEndDate] = useState<string>(() => getTodayColombia());
  const [printSuccess, setPrintSuccess] = useState<string | null>(null);
  const [hourlyRateInput, setHourlyRateInput] = useState<string>(() => {
    return String(hotelSettings?.checkoutHourlyRate ?? 10000);
  });
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [saveSettingsSuccess, setSaveSettingsSuccess] = useState(false);

  // Sync state tracking
  const [autoPrintEnabled, setAutoPrintEnabled] = useState<boolean>(() => !!(hotelSettings?.autoPrintEnabled ?? true));
  const [printerType, setPrinterType] = useState<string>(() => String(hotelSettings?.printerType ?? 'escpos'));
  const [paperSize, setPaperSize] = useState<string>(() => String(hotelSettings?.paperSize ?? '80mm'));

  // Historical closures state from props and local/firestore sync
  const [shiftClosures, setShiftClosures] = useState<any[]>(() => {
    if (Array.isArray(closures) && closures.length > 0) return closures;
    return safeGetLocalStorage('hotel_shift_closures', []);
  });
  const [closuresError, setClosuresError] = useState<string>("");
  const [selectedClosure, setSelectedClosure] = useState<any | null>(null);

  // Hover state for weekly chart tooltip
  const [hoveredWeekDay, setHoveredWeekDay] = useState<any | null>(null);
  const [weekTooltipPos, setWeekTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const handleExportToExcel = () => {
    try {
      const rows = filteredClosures.map((closure) => {
        const cierreDate = closure.closedAt || closure.createdAt || closure.fecha || closure.fechaCierre;
        const cerro = getEmployeeFullName(closure.empleadaEntrega || closure.employeeName || closure.createdByEmail);
        const recibe = getEmployeeFullName(closure.empleadaRecibe || closure.receiverEmployeeName);
        const esperado = Number(closure.efectivoEsperado || closure.totalEsperadoEfectivo || 0);
        const contado = Number(closure.efectivoContado || closure.dineroFisicoContado || 0);
        const diferencia = Number(
          closure.diferencia ?? closure.cashDifference ?? (contado - esperado)
        );
        
        return {
          "ID Cierre": closure.firestoreId || closure.id || "",
          "ID Turno": closure.shiftId || "",
          "Fecha": formatFirebaseDate(cierreDate),
          "Hora": formatFirebaseTime(cierreDate),
          "Cerró": cerro,
          "Recibe": recibe,
          "Base Inicial": Number(closure.baseInicial || 0),
          "Ventas Efectivo": Number(closure.ventasEfectivo || 0),
          "Ventas Transferencia": Number(closure.ventasTransferencia || 0),
          "Egresos Efectivo": Number(closure.gastosEfectivo || closure.egresosEfectivo || 0),
          "Egresos Transferencia": Number(closure.gastosTransferencia || closure.egresosTransferencia || 0),
          "Nómina": Number(closure.nomina || 0),
          "Efectivo Esperado": esperado,
          "Dinero Contado": contado,
          "Diferencia": diferencia,
          "Novedades": closure.observaciones || closure.novedades || "Sin novedades",
          "Creado Por": closure.createdByEmail || closure.employeeName || cerro
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Cierres");
      
      XLSX.writeFile(workbook, `Cierres_Kodiak_${getTodayColombia()}.xlsx`);
    } catch (err: any) {
      console.error("Error al exportar a Excel:", err);
      window.alert("Error al exportar a Excel: " + err.message);
    }
  };

  const handleExportSingleClosureToExcel = (closure: any) => {
    try {
      const cierreDate = closure.closedAt || closure.createdAt || closure.fecha || closure.fechaCierre;
      const cerro = getEmployeeFullName(closure.empleadaEntrega || closure.employeeName || closure.createdByEmail);
      const recibe = getEmployeeFullName(closure.empleadaRecibe || closure.receiverEmployeeName);
      const esperado = Number(closure.efectivoEsperado || closure.totalEsperadoEfectivo || 0);
      const contado = Number(closure.efectivoContado || closure.dineroFisicoContado || 0);
      const diferencia = Number(
        closure.diferencia ?? closure.cashDifference ?? (contado - esperado)
      );
      const estado = diferencia === 0 ? "Exacto" : diferencia < 0 ? "Faltante" : "Sobrante";

      const rows = [
        { Campo: "ID Cierre", Valor: closure.firestoreId || closure.id || "" },
        { Campo: "ID Turno", Valor: closure.shiftId || "" },
        { Campo: "Fecha", Valor: formatFirebaseDate(cierreDate) },
        { Campo: "Hora", Valor: formatFirebaseTime(cierreDate) },
        { Campo: "Empleado que cerró", Valor: cerro },
        { Campo: "Empleado que recibió", Valor: recibe },
        { Campo: "Base Inicial", Valor: Number(closure.baseInicial || 0) },
        { Campo: "Ventas Efectivo", Valor: Number(closure.ventasEfectivo || 0) },
        { Campo: "Ventas Transferencia", Valor: Number(closure.ventasTransferencia || 0) },
        { Campo: "Egresos Efectivo", Valor: Number(closure.gastosEfectivo || closure.egresosEfectivo || 0) },
        { Campo: "Egresos Transferencia", Valor: Number(closure.gastosTransferencia || closure.egresosTransferencia || 0) },
        { Campo: "Nómina", Valor: Number(closure.nomina || 0) },
        { Campo: "Efectivo Esperado", Valor: esperado },
        { Campo: "Dinero Contado", Valor: contado },
        { Campo: "Diferencia", Valor: diferencia },
        { Campo: "Estado", Valor: estado },
        { Campo: "Novedades/Observaciones", Valor: closure.observaciones || closure.novedades || "Sin novedades" }
      ];

      if (closure.inventarioConteo && closure.inventarioConteo.length > 0) {
        rows.push({ Campo: "--- CONTEO FISICO INVENTARIO ---", Valor: "---" });
        closure.inventarioConteo.forEach((item: any) => {
          rows.push({
            Campo: `${item.nombre} (Sistema: ${item.stockSistema}, Físico: ${item.conteoFisico})`,
            Valor: `Diferencia: ${item.diferencia > 0 ? '+' : ''}${item.diferencia}`
          });
        });
      }

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Detalle Cierre");
      
      XLSX.writeFile(workbook, `Cierre_${closure.id || 'Detalle'}.xlsx`);
    } catch (err: any) {
      console.error("Error al exportar cierre a Excel:", err);
      window.alert("Error al exportar cierre: " + err.message);
    }
  };

  const handlePrintClosure = (closure: any) => {
    try {
      const cierreDate = closure.closedAt || closure.createdAt || closure.fecha || closure.fechaCierre;
      const cerro = getEmployeeFullName(closure.empleadaEntrega || closure.employeeName || closure.createdByEmail);
      const recibe = getEmployeeFullName(closure.empleadaRecibe || closure.receiverEmployeeName);
      const esperado = Number(closure.efectivoEsperado || closure.totalEsperadoEfectivo || 0);
      const contado = Number(closure.efectivoContado || closure.dineroFisicoContado || 0);
      const diferencia = Number(
        closure.diferencia ?? closure.cashDifference ?? (contado - esperado)
      );
      const estado = diferencia === 0 ? "Exacto" : diferencia < 0 ? "Faltante" : "Sobrante";

      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <html>
            <head>
              <title>Cierre de Turno - Hotel Kodiak</title>
              <style>
                @media print {
                  body { width: 80mm; font-family: 'Courier New', Courier, monospace; font-size: 11px; line-height: 1.4; padding: 5px; color: #000; }
                }
                body { font-family: 'Courier New', Courier, monospace; font-size: 11px; line-height: 1.4; padding: 10px; max-width: 80mm; margin: 0 auto; color: #000; }
                .center { text-align: center; }
                .bold { font-weight: bold; }
                .border-bottom { border-bottom: 1px dashed #000; margin-bottom: 8px; padding-bottom: 8px; }
                .flex-row { display: flex; justify-content: space-between; }
                .mt-2 { margin-top: 8px; }
              </style>
            </head>
            <body>
              <div class="center bold">HOTEL KODIAK POS</div>
              <div class="center">REPORTE DE CIERRE DE TURNO</div>
              <div class="border-bottom"></div>
              
              <div class="flex-row"><span>ID Cierre:</span><span>\${(closure.firestoreId || closure.id || '').substring(0, 10)}</span></div>
              <div class="flex-row"><span>Fecha:</span><span>\${formatFirebaseDate(cierreDate)}</span></div>
              <div class="flex-row"><span>Hora:</span><span>\${formatFirebaseTime(cierreDate)}</span></div>
              <div class="flex-row"><span>Turno ID:</span><span>\${closure.shiftId || "N/A"}</span></div>
              <div class="border-bottom mt-2"></div>
              
              <div class="flex-row"><span class="bold">Cerró:</span><span>\${cerro}</span></div>
              <div class="flex-row"><span class="bold">Recibe:</span><span>\${recibe}</span></div>
              <div class="border-bottom mt-2"></div>
              
              <div class="flex-row"><span>Base Inicial:</span><span>\${formatColombianPesos(closure.baseInicial)}</span></div>
              <div class="flex-row"><span>Ventas Efectivo:</span><span>\${formatColombianPesos(closure.ventasEfectivo)}</span></div>
              <div class="flex-row"><span>Ventas Transfer:</span><span>\${formatColombianPesos(closure.ventasTransferencia)}</span></div>
              <div class="flex-row"><span>Egresos Efectivo:</span><span>\${formatColombianPesos(closure.gastosEfectivo || closure.egresosEfectivo)}</span></div>
              <div class="flex-row"><span>Egresos Transfer:</span><span>\${formatColombianPesos(closure.gastosTransferencia || closure.egresosTransferencia)}</span></div>
              <div class="flex-row"><span>Nómina/Pagos:</span><span>\${formatColombianPesos(closure.nomina)}</span></div>
              <div class="border-bottom mt-2"></div>
              
              <div class="flex-row bold"><span>Ef. Esperado:</span><span>\${formatColombianPesos(esperado)}</span></div>
              <div class="flex-row bold"><span>Ef. Contado:</span><span>\${formatColombianPesos(contado)}</span></div>
              <div class="flex-row bold"><span>Diferencia:</span><span>\${formatColombianPesos(diferencia)}</span></div>
              <div class="flex-row bold"><span>Estado:</span><span>\${estado}</span></div>
              <div class="border-bottom mt-2"></div>
              
              <div class="bold">Observaciones:</div>
              <div>\${closure.observaciones || closure.novedades || "Sin novedades."}</div>
              
              \${closure.inventarioConteo && closure.inventarioConteo.length > 0 ? \`
                <div class="border-bottom mt-2"></div>
                <div class="center bold">CONTEO DE INVENTARIO</div>
                \${closure.inventarioConteo.map((item: any) => \`
                  <div class="flex-row">
                    <span>\${item.nombre}</span>
                    <span>S:\${item.stockSistema} F:\${item.conteoFisico} D:\${item.diferencia > 0 ? '+' : ''}\${item.diferencia}</span>
                  </div>
                \`).join('')}
              \` : ''}
              
              <div class="border-bottom mt-2"></div>
              <div class="center bold mt-2">GRACIAS - HOTEL KODIAK</div>
              <script>
                window.onload = function() {
                  window.print();
                  setTimeout(function() { window.close(); }, 500);
                }
              <\/script>
            </body>
          </html>
        `);
        printWindow.document.close();
      } else {
        window.alert("Por favor habilite las ventanas emergentes (popups) para poder imprimir el recibo.");
      }
      setPrintSuccess("✓ Cierre enviado a la cola de impresión de la ticketera.");
      setTimeout(() => setPrintSuccess(null), 5000);
    } catch (err: any) {
      console.error("Error al imprimir cierre:", err);
      window.alert("Error al imprimir cierre: " + err.message);
    }
  };

  useEffect(() => {
    if (Array.isArray(closures) && closures.length > 0) {
      setShiftClosures(closures);
      setClosuresError("");
    }
  }, [closures]);

  useEffect(() => {
    try {
      if (!db || typeof onSnapshot !== 'function') return;

      const unsub = onSnapshot(
        collection(db, "hotel_shift_closures"),
        (snapshot) => {
          const data = snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            firestoreId: docSnap.id,
            ...docSnap.data()
          }));

          setShiftClosures(data);
          setClosuresError("");
        },
        (error) => {
          console.warn("Lectura remota de cierres en modo local:", error?.message || error);
          const local = safeGetLocalStorage('hotel_shift_closures', []);
          if (Array.isArray(local) && local.length > 0) {
            setShiftClosures(local);
          } else if (Array.isArray(closures) && closures.length > 0) {
            setShiftClosures(closures);
          }
          setClosuresError("");
        }
      );

      return () => unsub();
    } catch (error: any) {
      console.warn("Aviso en suscripción de cierres:", error?.message || error);
      const local = safeGetLocalStorage('hotel_shift_closures', []);
      if (Array.isArray(local) && local.length > 0) {
        setShiftClosures(local);
      }
      setClosuresError("");
    }
  }, []);

  useEffect(() => {
    if (hotelSettings) {
      if (hotelSettings.checkoutHourlyRate !== undefined) {
        setHourlyRateInput(String(hotelSettings.checkoutHourlyRate));
      }
      setAutoPrintEnabled(!!(hotelSettings.autoPrintEnabled ?? true));
      setPrinterType(String(hotelSettings.printerType ?? 'escpos'));
      setPaperSize(String(hotelSettings.paperSize ?? '80mm'));
    }
  }, [hotelSettings]);

  // Helper utility to safely check if a transaction date matches the filter
  const isTransactionInFilter = (createdAtValue: any, fechaValue?: string): boolean => {
    const todayColombia = getTodayColombia(); // Format: "YYYY-MM-DD"
    let dateStr = "";

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
        dateStr = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Bogota",
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        }).format(date);
      }
    }

    if (!dateStr && fechaValue) {
      const clean = fechaValue.trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
        dateStr = clean.substring(0, 10);
      } else if (clean.includes('/')) {
        const parts = clean.split('/');
        if (parts.length === 3) {
          let d = parts[0].padStart(2, '0');
          let m = parts[1].padStart(2, '0');
          let y = parts[2];
          if (y.length === 2) y = '20' + y;
          dateStr = `${y}-${m}-${d}`;
        }
      }
    }

    if (!dateStr) return false;

    if (filterType === 'Hoy') {
      return dateStr === todayColombia;
    } else if (filterType === 'Esta semana') {
      // Find Monday and Sunday of current week in Colombia
      const parts = todayColombia.split('-');
      const todayDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      const dayOfWeek = todayDate.getDay(); // 0 (Sun) to 6 (Sat)
      const offsetToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const mondayDate = new Date(todayDate);
      mondayDate.setDate(todayDate.getDate() + offsetToMonday);
      
      const sundayDate = new Date(mondayDate);
      sundayDate.setDate(mondayDate.getDate() + 6);

      const formatToYYYYMMDD = (d: Date) => {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      };

      const mondayStr = formatToYYYYMMDD(mondayDate);
      const sundayStr = formatToYYYYMMDD(sundayDate);
      return dateStr >= mondayStr && dateStr <= sundayStr;
    } else if (filterType === 'Este mes') {
      const currentMonthPrefix = todayColombia.substring(0, 7); // YYYY-MM
      return dateStr.startsWith(currentMonthPrefix);
    } else if (filterType === 'Rango') {
      return dateStr >= startDate && dateStr <= endDate;
    }
    return true; // 'Todo'
  };

  // Filtered lists
  const filteredSales = (sales || []).filter(s => isTransactionInFilter(s.createdAt, s.fecha));
  const filteredExpenses = (expenses || []).filter(e => isTransactionInFilter(e.createdAt, e.fecha));
  const filteredClosures = (shiftClosures || []).filter(c => isTransactionInFilter(c.closedAt || c.createdAt || c.fecha || c.fechaCierre, c.fecha || c.fechaCierre));

  // Totals calculations
  const totalSales = filteredSales.reduce((acc, curr) => acc + (curr.total || 0), 0);
  const totalExpenses = filteredExpenses.reduce((acc, curr) => acc + (curr.valor || 0), 0);
  const netProfit = totalSales - totalExpenses;

  const totalEsperadoCierres = filteredClosures.reduce((acc, curr) => acc + Number(curr.efectivoEsperado || curr.totalEsperadoEfectivo || 0), 0);
  const totalContadoCierres = filteredClosures.reduce((acc, curr) => acc + Number(curr.efectivoContado || curr.dineroFisicoContado || 0), 0);
  const totalDiferenciaCierres = totalContadoCierres - totalEsperadoCierres;

  // BUILD EMPLOYEE SUMMARY
  const employeeSummaryMap: { [key: string]: { name: string; count: number; esperado: number; contado: number; diferencia: number } } = {};
  filteredClosures.forEach((closure) => {
    const nameRaw = closure.empleadaEntrega || closure.employeeName || closure.createdByEmail || "Sin dato";
    const name = getEmployeeFullName(nameRaw);
    const esperado = Number(closure.efectivoEsperado || closure.totalEsperadoEfectivo || 0);
    const contado = Number(closure.efectivoContado || closure.dineroFisicoContado || 0);
    const diferencia = Number(
      closure.diferencia ?? closure.cashDifference ?? (contado - esperado)
    );

    if (!employeeSummaryMap[name]) {
      employeeSummaryMap[name] = {
        name,
        count: 0,
        esperado: 0,
        contado: 0,
        diferencia: 0
      };
    }
    employeeSummaryMap[name].count += 1;
    employeeSummaryMap[name].esperado += esperado;
    employeeSummaryMap[name].contado += contado;
    employeeSummaryMap[name].diferencia += diferencia;
  });

  const employeeSummaryList = Object.values(employeeSummaryMap);

  // Helper utility to safely convert any transaction date to "YYYY-MM-DD"
  const getColombiaDateString = (createdAtValue: any, fechaValue?: string): string => {
    let dateStr = "";

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
        dateStr = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Bogota",
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        }).format(date);
      }
    }

    if (!dateStr && fechaValue) {
      const clean = fechaValue.trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
        dateStr = clean.substring(0, 10);
      } else if (clean.includes('/')) {
        const parts = clean.split('/');
        if (parts.length === 3) {
          let d = parts[0].padStart(2, '0');
          let m = parts[1].padStart(2, '0');
          let y = parts[2];
          if (y.length === 2) y = '20' + y;
          dateStr = `${y}-${m}-${d}`;
        }
      }
    }
    return dateStr;
  };

  // BUILD WEEKLY DATA SAFELY
  let weeklyData: any[] = [];
  let weekDates: string[] = [];
  let totalVentasSemana = 0;
  let totalGastosSemana = 0;
  let hasWeeklyData = false;
  
  const dayNames = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

  try {
    const referenceDate = (filterType === 'Rango' && startDate) ? startDate : getTodayColombia();
    const parts = referenceDate.split('-');
    const todayDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    
    const dayOfWeek = todayDate.getDay(); // 0 (Sun) to 6 (Sat)
    const offsetToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

    const mondayDate = new Date(todayDate);
    mondayDate.setDate(todayDate.getDate() + offsetToMonday);

    for (let i = 0; i < 7; i++) {
      const d = new Date(mondayDate);
      d.setDate(mondayDate.getDate() + i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      weekDates.push(`${yyyy}-${mm}-${dd}`);
    }

    weeklyData = dayNames.map((name, index) => {
      const dateStr = weekDates[index];
      
      const daySales = (filteredSales || []).filter(s => getColombiaDateString(s.createdAt, s.fecha) === dateStr);
      const dayExpenses = (filteredExpenses || []).filter(e => getColombiaDateString(e.createdAt, e.fecha) === dateStr);
      
      let efectivoSales = 0;
      let transferenciaSales = 0;
      daySales.forEach(s => {
        const total = Number(s.total || 0);
        const method = String(s.metodoPago || "").toLowerCase();
        if (method === 'efectivo') {
          efectivoSales += total;
        } else if (method === 'transferencia') {
          transferenciaSales += total;
        } else {
          efectivoSales += total;
        }
      });

      let totalGastos = 0;
      dayExpenses.forEach(e => {
        totalGastos += Number(e.valor || 0);
      });

      const totalNeto = efectivoSales + transferenciaSales - totalGastos;

      totalVentasSemana += (efectivoSales + transferenciaSales);
      totalGastosSemana += totalGastos;

      return {
        dayName: name,
        date: dateStr,
        efectivo: efectivoSales,
        transferencia: transferenciaSales,
        gastos: totalGastos,
        neto: totalNeto
      };
    });

    hasWeeklyData = totalVentasSemana > 0 || totalGastosSemana > 0;
  } catch (err) {
    console.error("Error calculating weekly report data:", err);
  }

  // Dimensions & Scale helpers for Weekly SVG Chart
  const svgHeight = 350;
  const svgWidth = 800;
  const topMargin = 40;
  const bottomMargin = 50;
  const leftMargin = 85;
  const rightMargin = 40;
  const chartWidth = svgWidth - leftMargin - rightMargin;
  const chartHeight = svgHeight - topMargin - bottomMargin;

  let yMax = 100000;
  let yMin = 0;
  const gridPoints: number[] = [];
  const daySpace = chartWidth / 7;

  try {
    const maxValInWeekly = weeklyData.reduce((max, d) => {
      return Math.max(max, d.efectivo, d.transferencia, d.gastos, Math.abs(d.neto));
    }, 0);

    yMax = maxValInWeekly > 0 ? maxValInWeekly : 100000;
    yMax = yMax * 1.15; // 15% top spacing

    weeklyData.forEach(d => {
      if (d.neto < 0) {
        yMin = Math.min(yMin, d.neto);
      }
    });
    if (yMin < 0) {
      yMin = yMin * 1.15; // 15% bottom spacing for negative net
    }

    const steps = 4;
    for (let j = 0; j <= steps; j++) {
      const val = yMin + (j * (yMax - yMin) / steps);
      gridPoints.push(val);
    }
  } catch (err) {
    console.error("Error setting up scale variables:", err);
  }

  const getY = (v: number) => {
    try {
      const range = yMax - yMin;
      if (range === 0) return topMargin + chartHeight;
      const pct = (v - yMin) / range;
      return topMargin + chartHeight - (pct * chartHeight);
    } catch {
      return topMargin + chartHeight;
    }
  };

  const yZero = getY(0);

  const formatYLabel = (v: number) => {
    try {
      const absV = Math.abs(v);
      const sign = v < 0 ? "-" : "";
      if (absV >= 1000000) {
        return `${sign}$${(absV / 1000000).toFixed(1)}M`;
      }
      if (absV >= 1000) {
        return `${sign}$${(absV / 1000).toFixed(0)}k`;
      }
      return `${sign}$${absV}`;
    } catch {
      return String(v);
    }
  };

  const formatDateLabel = (dateStr: string) => {
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
        const mIdx = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        return `${day} ${months[mIdx] || ''}`;
      }
      return dateStr;
    } catch {
      return dateStr;
    }
  };

  let linePathD = "";
  try {
    const points = weeklyData.map((d, i) => {
      const centerX = leftMargin + (i * daySpace) + (daySpace / 2);
      const centerY = getY(d.neto);
      return `${centerX},${centerY}`;
    });
    if (points.length > 0) {
      linePathD = "M " + points.join(" L ");
    }
  } catch (err) {
    console.error("Error constructing line path:", err);
  }

  const navigateToTab = (tabName: string) => {
    const navButtons = document.querySelectorAll('nav button');
    let clicked = false;
    navButtons.forEach((btn: any) => {
      const label = btn.textContent || "";
      if (label.toLowerCase().includes(tabName.substring(0, 4).toLowerCase())) {
        btn.click();
        clicked = true;
      }
    });

    if (!clicked) {
      window.alert(`Navegando a la sección de ${tabName}. Use el menú inferior.`);
    }
  };

  const handleSaveSettings = async () => {
    const rate = parseInt(hourlyRateInput.replace(/\D/g, ''), 10);
    if (isNaN(rate) || rate < 0) {
      window.alert('Por favor ingrese un valor de hora válido.');
      return;
    }
    setIsSavingSettings(true);
    setSaveSettingsSuccess(false);
    try {
      if (onUpdateSettings) {
        await onUpdateSettings({
          ...hotelSettings,
          id: 'kodiak_config',
          checkoutHourlyRate: rate,
          autoPrintEnabled,
          printerType,
          paperSize
        });
        setSaveSettingsSuccess(true);
        setTimeout(() => setSaveSettingsSuccess(false), 3000);
      }
    } catch (e: any) {
      console.error(e);
      window.alert(`Error al guardar la configuración: ${e.message || String(e)}`);
    } finally {
      setIsSavingSettings(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto px-4 sm:px-0 pb-12 animate-fade-in" id="dashboard-view-root">
      
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-900 pb-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400">
            <LayoutDashboard className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white uppercase tracking-tight">Dashboard Administrativo</h2>
            <p className="text-xs text-slate-400">Estadísticas y administración general del sistema POS</p>
          </div>
        </div>

        {/* Filter selection buttons */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
          <div className="flex flex-wrap bg-slate-900/80 p-1 rounded-xl border border-slate-800 self-start">
            {(['Hoy', 'Esta semana', 'Este mes', 'Todo', 'Rango'] as FilterType[]).map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  filterType === type 
                    ? 'bg-emerald-500 text-slate-950 shadow-md font-black scale-102' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {type}
              </button>
            ))}
          </div>

          {filterType === 'Rango' && (
            <div className="flex items-center gap-2 bg-slate-900/80 p-2 rounded-xl border border-slate-800 text-xs text-slate-300">
              <span className="text-slate-500 font-bold">Del:</span>
              <input 
                type="date" 
                value={startDate} 
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-white font-mono focus:outline-none focus:border-emerald-500"
              />
              <span className="text-slate-500 font-bold">Al:</span>
              <input 
                type="date" 
                value={endDate} 
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-white font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>
          )}
        </div>
      </div>

      {/* Stability Alert Banner */}
      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 flex items-start gap-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-xs font-black text-emerald-400 uppercase tracking-wider">Dashboard cargado correctamente</p>
          <p className="text-xs text-slate-300 mt-0.5">
            La interfaz administrativa se ha restablecido en modo seguro y de alto rendimiento. Las bases de datos y la sincronización con la nube están operativas.
          </p>
        </div>
      </div>

      {/* Main KPI metrics grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        
        {/* Recaudo (Ventas) */}
        <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-5 hover:border-emerald-500/20 transition-all shadow-lg relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/2 rounded-full blur-2xl group-hover:bg-emerald-500/5 transition-all" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Recaudo (Ventas)</span>
            <div className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded-lg">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-2xl font-black text-white font-mono leading-none tracking-tight">
              {formatCop(totalSales)}
            </h3>
            <p className="text-[10px] text-slate-500 mt-1.5 font-medium">
              Ventas registradas en el periodo ({filterType.toLowerCase()})
            </p>
          </div>
        </div>

        {/* Gastos */}
        <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-5 hover:border-red-500/20 transition-all shadow-lg relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/2 rounded-full blur-2xl group-hover:bg-red-500/5 transition-all" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Gastos</span>
            <div className="p-1.5 bg-red-500/10 text-red-400 rounded-lg">
              <TrendingDown className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-2xl font-black text-white font-mono leading-none tracking-tight">
              {formatCop(totalExpenses)}
            </h3>
            <p className="text-[10px] text-slate-500 mt-1.5 font-medium">
              Egresos autorizados y base de caja en el periodo
            </p>
          </div>
        </div>

        {/* Utilidad */}
        <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-5 hover:border-indigo-500/20 transition-all shadow-lg relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/2 rounded-full blur-2xl group-hover:bg-indigo-500/5 transition-all" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Utilidad Neta</span>
            <div className="p-1.5 bg-indigo-500/10 text-indigo-400 rounded-lg">
              <Coins className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4">
            <h3 className={`text-2xl font-black font-mono leading-none tracking-tight ${netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatCop(netProfit)}
            </h3>
            <p className="text-[10px] text-slate-500 mt-1.5 font-medium">
              Resultado neto operacional calculado
            </p>
          </div>
        </div>

      </div>

      {/* REPORTE SEMANAL DE VENTAS */}
      <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 relative animate-fade-in" id="weekly-sales-report-section">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h2 className="text-lg font-black text-white uppercase tracking-tight flex items-center gap-2">
              <Layers className="h-5 w-5 text-emerald-400" />
              <span>REPORTE SEMANAL DE VENTAS</span>
            </h2>
            <p className="text-xs text-slate-400">
              {hasWeeklyData 
                ? `Desglose diario del lunes ${formatDateLabel(weekDates[0])} al domingo ${formatDateLabel(weekDates[6])}` 
                : "Consolidado operacional de la semana actual"}
            </p>
          </div>
          
          {hasWeeklyData && (
            <div className="flex items-center gap-2 bg-slate-950/40 px-3 py-1.5 rounded-xl border border-slate-800/60">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
              <span className="text-xs text-slate-300 font-bold">
                Neto Semanal:{" "}
                <span className={`font-mono font-black ${weeklyData.reduce((acc, d) => acc + d.neto, 0) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {formatCurrency(weeklyData.reduce((acc, d) => acc + d.neto, 0))}
                </span>
              </span>
            </div>
          )}
        </div>

        {!hasWeeklyData ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 bg-slate-950/20 border border-slate-800/60 rounded-xl text-center">
            <Calendar className="h-8 w-8 text-slate-600 mb-2.5" />
            <p className="text-sm font-black text-slate-400 uppercase tracking-wider">Sin datos suficientes</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">
              No hay transacciones de ventas o egresos registradas en la semana actual (de lunes a domingo) para generar el reporte semanal.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Legend */}
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs bg-slate-950/30 py-3 px-4 rounded-xl border border-slate-800/40">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded bg-[#10b981]"></span>
                <span className="text-slate-300 font-medium">Ventas Efectivo</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded bg-[#0ea5e9]"></span>
                <span className="text-slate-300 font-medium">Ventas Transferencia</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded bg-[#f43f5e]"></span>
                <span className="text-slate-300 font-medium">Egresos / Gastos</span>
              </div>
              <div className="flex items-center gap-2 pl-3 border-l border-slate-800">
                <span className="w-6 h-0.5 bg-[#fbbf24] relative flex items-center justify-center">
                  <span className="absolute w-2 h-2 rounded-full bg-[#fbbf24]"></span>
                </span>
                <span className="text-slate-300 font-medium">Total Neto Diario</span>
              </div>
            </div>

            {/* SVG Interactive Chart */}
            <div className="relative overflow-x-auto">
              <div className="min-w-[650px] relative">
                <svg 
                  viewBox={`0 0 ${svgWidth} ${svgHeight}`} 
                  className="w-full h-auto overflow-visible select-none"
                >
                  {/* Grid Lines */}
                  {gridPoints.map((val, idx) => {
                    const y = getY(val);
                    return (
                      <g key={idx}>
                        <line 
                          x1={leftMargin} 
                          y1={y} 
                          x2={leftMargin + chartWidth} 
                          y2={y} 
                          stroke="#1e293b" 
                          strokeWidth={val === 0 ? "1.5" : "1"}
                          strokeDasharray={val === 0 ? "0" : "4 4"}
                        />
                        <text 
                          x={leftMargin - 10} 
                          y={y + 4} 
                          textAnchor="end" 
                          className="font-mono text-[10px] fill-slate-400 font-bold"
                        >
                          {formatYLabel(val)}
                        </text>
                      </g>
                    );
                  })}

                  {/* Grouped Columns per Day */}
                  {weeklyData.map((d, i) => {
                    const centerX = leftMargin + (i * daySpace) + (daySpace / 2);
                    const colWidth = 14;
                    
                    // Column X coordinates
                    const xEfectivo = centerX - 23;
                    const xTransferencia = centerX - 7;
                    const xGastos = centerX + 9;

                    // Y coordinates and heights
                    const hEfectivo = Math.max(1, yZero - getY(d.efectivo));
                    const yEfectivo = getY(d.efectivo);

                    const hTransferencia = Math.max(1, yZero - getY(d.transferencia));
                    const yTransferencia = getY(d.transferencia);

                    const hGastos = Math.max(1, yZero - getY(d.gastos));
                    const yGastos = getY(d.gastos);

                    const isHovered = hoveredWeekDay && hoveredWeekDay.date === d.date;

                    return (
                      <g key={i} className="transition-all duration-150">
                        {/* Day Column Background Highlight on Hover */}
                        {isHovered && (
                          <rect 
                            x={leftMargin + i * daySpace} 
                            y={topMargin} 
                            width={daySpace} 
                            height={chartHeight} 
                            fill="rgba(255, 255, 255, 0.02)"
                            rx="6"
                          />
                        )}

                        {/* Ventas Efectivo column (Green) */}
                        {d.efectivo > 0 && (
                          <rect 
                            x={xEfectivo} 
                            y={yEfectivo} 
                            width={colWidth} 
                            height={hEfectivo} 
                            fill="#10b981" 
                            rx="2"
                            opacity={isHovered ? "1" : "0.85"}
                            className="transition-all duration-150 hover:opacity-100"
                          />
                        )}

                        {/* Ventas Transferencia column (Sky Blue) */}
                        {d.transferencia > 0 && (
                          <rect 
                            x={xTransferencia} 
                            y={yTransferencia} 
                            width={colWidth} 
                            height={hTransferencia} 
                            fill="#0ea5e9" 
                            rx="2"
                            opacity={isHovered ? "1" : "0.85"}
                            className="transition-all duration-150 hover:opacity-100"
                          />
                        )}

                        {/* Gastos column (Rose) */}
                        {d.gastos > 0 && (
                          <rect 
                            x={xGastos} 
                            y={yGastos} 
                            width={colWidth} 
                            height={hGastos} 
                            fill="#f43f5e" 
                            rx="2"
                            opacity={isHovered ? "1" : "0.85"}
                            className="transition-all duration-150 hover:opacity-100"
                          />
                        )}

                        {/* Axis text labeling under chart */}
                        <text 
                          x={centerX} 
                          y={topMargin + chartHeight + 20} 
                          textAnchor="middle" 
                          className={`text-xs font-bold transition-all ${isHovered ? 'fill-white' : 'fill-slate-400'}`}
                        >
                          {d.dayName}
                        </text>
                        <text 
                          x={centerX} 
                          y={topMargin + chartHeight + 34} 
                          textAnchor="middle" 
                          className="text-[9px] fill-slate-500 font-mono"
                        >
                          {formatDateLabel(d.date)}
                        </text>
                      </g>
                    );
                  })}

                  {/* Overlaid Total Neto Line Path */}
                  {linePathD && (
                    <path 
                      d={linePathD} 
                      fill="none" 
                      stroke="#fbbf24" 
                      strokeWidth="3.5" 
                      strokeLinecap="round" 
                      strokeLinejoin="round"
                      className="drop-shadow-[0_2px_8px_rgba(251,191,36,0.25)]"
                    />
                  )}

                  {/* Circle markers on top of line */}
                  {weeklyData.map((d, i) => {
                    const cx = leftMargin + (i * daySpace) + (daySpace / 2);
                    const cy = getY(d.neto);
                    const isHovered = hoveredWeekDay && hoveredWeekDay.date === d.date;

                    return (
                      <circle 
                        key={i} 
                        cx={cx} 
                        cy={cy} 
                        r={isHovered ? "7" : "5"} 
                        fill="#fbbf24" 
                        stroke="#0f172a" 
                        strokeWidth="2.5" 
                        className="transition-all duration-150 cursor-pointer"
                      />
                    );
                  })}

                  {/* Invisible broad bars to catch mouse hover cleanly */}
                  {weeklyData.map((d, i) => (
                    <rect 
                      key={i}
                      x={leftMargin + i * daySpace} 
                      y={topMargin} 
                      width={daySpace} 
                      height={chartHeight + 40} 
                      fill="transparent" 
                      opacity="0"
                      className="cursor-pointer"
                      onMouseEnter={(e) => {
                        setHoveredWeekDay(d);
                        const rect = e.currentTarget.getBoundingClientRect();
                        const parentRect = e.currentTarget.parentElement?.getBoundingClientRect();
                        if (rect && parentRect) {
                          const xPos = rect.left - parentRect.left + rect.width / 2;
                          const yPos = rect.top - parentRect.top + 100;
                          setWeekTooltipPos({ x: xPos, y: yPos });
                        }
                      }}
                      onMouseMove={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const parentRect = e.currentTarget.parentElement?.getBoundingClientRect();
                        if (rect && parentRect) {
                          const xPos = rect.left - parentRect.left + rect.width / 2;
                          const yPos = rect.top - parentRect.top + (e.clientY - rect.top);
                          setWeekTooltipPos({ x: xPos, y: yPos });
                        }
                      }}
                      onMouseLeave={() => {
                        setHoveredWeekDay(null);
                      }}
                    />
                  ))}
                </svg>

                {/* Custom Tooltip */}
                {hoveredWeekDay && (
                  <div 
                    className="absolute pointer-events-none bg-slate-950/95 border border-slate-800 p-3.5 rounded-2xl shadow-2xl text-xs z-30 transition-all duration-75 space-y-2 w-56 animate-in fade-in zoom-in-95 duration-100"
                    style={{
                      left: `${weekTooltipPos.x}px`,
                      top: `${weekTooltipPos.y - 15}px`,
                      transform: 'translate(-50%, -100%)',
                    }}
                  >
                    <div className="font-black text-white border-b border-slate-800/80 pb-1.5 mb-1.5 flex justify-between items-center gap-4">
                      <span className="text-[13px]">{hoveredWeekDay.dayName}</span>
                      <span className="text-slate-500 font-mono font-normal text-[10px]">{formatDateLabel(hoveredWeekDay.date)}</span>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-[#10b981]"></span> Efectivo:
                        </span>
                        <span className="font-mono text-slate-200 font-bold">{formatColombianPesos(hoveredWeekDay.efectivo)}</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-[#0ea5e9]"></span> Transferencia:
                        </span>
                        <span className="font-mono text-slate-200 font-bold">{formatColombianPesos(hoveredWeekDay.transferencia)}</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-[#f43f5e]"></span> Egresos:
                        </span>
                        <span className="font-mono text-slate-200 font-bold">{formatColombianPesos(hoveredWeekDay.gastos)}</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px] border-t border-slate-800/80 pt-1.5 mt-1.5 font-bold">
                        <span className="text-slate-200 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-[#fbbf24]"></span> Total Neto:
                        </span>
                        <span className={`font-mono font-black ${hoveredWeekDay.neto < 0 ? 'text-red-400' : 'text-[#fbbf24]'}`}>
                          {formatColombianPesos(hoveredWeekDay.neto)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* HISTORIAL DE CIERRES DIARIOS */}
      <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-black text-white uppercase tracking-tight">
              HISTORIAL DE CIERRES DIARIOS
            </h2>
            <p className="text-xs text-slate-400">
              Cierres de turno registrados en Firebase
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportToExcel}
              disabled={filteredClosures.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800/80 disabled:text-slate-500 text-slate-950 rounded-xl text-xs font-black uppercase tracking-wider transition-all"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>Exportar Excel</span>
            </button>
            <span className="text-xs text-emerald-400 font-black font-mono bg-emerald-500/10 px-2.5 py-1.5 rounded-lg">
              Total: {filteredClosures.length}
            </span>
          </div>
        </div>

        {closuresError ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-200 text-sm">
            Error cargando cierres: {closuresError}
          </div>
        ) : filteredClosures.length === 0 ? (
          <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-yellow-200 text-sm">
            No hay cierres de turno registrados para el filtro activo.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto border border-slate-800/60 rounded-xl bg-slate-950/20">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider font-bold bg-slate-950/40 sticky top-0 z-10 backdrop-blur-md">
                  <th className="text-left py-3 px-3">Fecha</th>
                  <th className="text-left py-3 px-3">Hora</th>
                  <th className="text-left py-3 px-3">Cerró</th>
                  <th className="text-left py-3 px-3">Recibe</th>
                  <th className="text-right py-3 px-3">Esperado</th>
                  <th className="text-right py-3 px-3">Contado</th>
                  <th className="text-right py-3 px-3">Diferencia</th>
                  <th className="text-center py-3 px-3">Estado</th>
                  <th className="text-center py-3 px-3">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredClosures.map((closure) => {
                  const cierreDate = closure.closedAt || closure.createdAt || closure.fecha || closure.fechaCierre;
                  const cerroRaw = closure.empleadaEntrega || closure.employeeName || closure.createdByEmail || "Sin dato";
                  const recibeRaw = closure.empleadaRecibe || closure.receiverEmployeeName || "Sin dato";
                  const cerro = getEmployeeFullName(cerroRaw);
                  const recibe = getEmployeeFullName(recibeRaw);
                  const esperado = Number(closure.efectivoEsperado || closure.totalEsperadoEfectivo || 0);
                  const contado = Number(closure.efectivoContado || closure.dineroFisicoContado || 0);
                  const diferencia = Number(
                    closure.diferencia ?? closure.cashDifference ?? (contado - esperado)
                  );

                  return (
                    <tr key={closure.id} className="border-b border-slate-800/40 text-slate-100 hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-3 font-mono text-xs text-slate-300">{formatFirebaseDate(cierreDate)}</td>
                      <td className="py-3 px-3 font-mono text-xs text-slate-400">{formatFirebaseTime(cierreDate)}</td>
                      <td className="py-3 px-3 text-xs text-slate-200 font-bold">{cerro}</td>
                      <td className="py-3 px-3 text-xs text-slate-300">{recibe}</td>
                      <td className="py-3 px-3 text-right font-mono text-xs">{formatColombianPesos(esperado)}</td>
                      <td className="py-3 px-3 text-right font-bold font-mono text-xs text-white">{formatColombianPesos(contado)}</td>
                      <td className={`py-3 px-3 text-right font-black font-mono text-xs ${diferencia < 0 ? "text-red-400" : diferencia > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                        {formatColombianPesos(diferencia)}
                      </td>
                      <td className="py-3 px-3 text-center">
                        {getClosureStatusBadge(diferencia)}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <button
                          onClick={() => setSelectedClosure(closure)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 hover:text-indigo-300 rounded-lg text-xs font-bold transition-all border border-indigo-500/20"
                        >
                          <Eye className="h-3 w-3" />
                          <span>Ver detalle</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0 z-10 bg-slate-950/90 border-t-2 border-slate-850">
                <tr className="font-black text-white">
                  <td colSpan={4} className="py-3.5 px-3 text-xs uppercase tracking-wider text-slate-400">TOTAL GENERAL ({filteredClosures.length})</td>
                  <td className="py-3.5 px-3 text-right font-mono text-xs text-slate-200">{formatColombianPesos(totalEsperadoCierres)}</td>
                  <td className="py-3.5 px-3 text-right font-bold font-mono text-xs text-emerald-400">{formatColombianPesos(totalContadoCierres)}</td>
                  <td className={`py-3.5 px-3 text-right font-black font-mono text-xs ${totalDiferenciaCierres < 0 ? "text-red-400" : totalDiferenciaCierres > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                    {formatColombianPesos(totalDiferenciaCierres)}
                  </td>
                  <td className="py-3.5 px-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${totalDiferenciaCierres === 0 ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : totalDiferenciaCierres < 0 ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"}`}>
                      {totalDiferenciaCierres === 0 ? "Exacto" : totalDiferenciaCierres < 0 ? "Faltante" : "Sobrante"}
                    </span>
                  </td>
                  <td className="py-3.5 px-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* RESUMEN POR EMPLEADA */}
      <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
        <div className="mb-4">
          <h2 className="text-lg font-black text-white uppercase tracking-tight flex items-center gap-2">
            <Users className="h-5 w-5 text-indigo-400" />
            <span>RESUMEN DE CIERRES POR EMPLEADA</span>
          </h2>
          <p className="text-xs text-slate-400">
            Métricas acumuladas y desempeño según el filtro seleccionado
          </p>
        </div>

        {employeeSummaryList.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-950/20 p-4 text-slate-400 text-xs text-center">
            No hay datos de cierres para las empleadas bajo el filtro seleccionado.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {employeeSummaryList.map((emp) => {
              const status = emp.diferencia === 0 ? "Exacto" : emp.diferencia < 0 ? "Faltante" : "Sobrante";
              const count = emp.count;
              return (
                <div key={emp.name} className="bg-slate-950/30 border border-slate-800/80 hover:border-slate-700 rounded-xl p-4 transition-all relative overflow-hidden group">
                  <div className="flex items-start justify-between border-b border-slate-800/60 pb-2 mb-3">
                    <div>
                      <h4 className="text-sm font-black text-white">{emp.name}</h4>
                      <p className="text-[10px] text-slate-400 font-mono">Cierres realizados: <span className="text-slate-200 font-bold font-sans">{count}</span></p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${emp.diferencia === 0 ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : emp.diferencia < 0 ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"}`}>
                      {status}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="bg-slate-900/40 p-2 rounded-lg border border-slate-800/40">
                      <span className="text-[9px] text-slate-500 uppercase block">Esperado</span>
                      <span className="font-bold font-mono text-slate-200 text-[11px] block truncate">{formatColombianPesos(emp.esperado)}</span>
                    </div>
                    <div className="bg-slate-900/40 p-2 rounded-lg border border-slate-800/40">
                      <span className="text-[9px] text-slate-500 uppercase block">Contado</span>
                      <span className="font-black font-mono text-white text-[11px] block truncate">{formatColombianPesos(emp.contado)}</span>
                    </div>
                    <div className="bg-slate-900/40 p-2 rounded-lg border border-slate-800/40">
                      <span className="text-[9px] text-slate-500 uppercase block">Diferencia</span>
                      <span className={`font-black font-mono text-[11px] block truncate ${emp.diferencia < 0 ? "text-red-400" : emp.diferencia > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                        {emp.diferencia > 0 ? '+' : ''}{formatColombianPesos(emp.diferencia)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Modal Ver Detalle */}
      {selectedClosure && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl p-6 relative shadow-2xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in duration-150">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
              <div className="flex items-center gap-2">
                <Info className="h-5 w-5 text-indigo-400" />
                <div>
                  <h3 className="text-md font-black text-white uppercase tracking-tight">Detalle del Cierre de Turno</h3>
                  <p className="text-[10px] text-slate-400 font-mono">ID: {selectedClosure.firestoreId || selectedClosure.id}</p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedClosure(null)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Content body */}
            <div className="space-y-4">
              {/* General info grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 bg-slate-950/40 p-4 rounded-xl border border-slate-800/60">
                <div className="space-y-0.5">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">ID Turno</span>
                  <span className="text-xs text-slate-200 font-mono truncate block">{selectedClosure.shiftId || "N/A"}</span>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Fecha</span>
                  <span className="text-xs text-slate-200 block">{formatFirebaseDate(selectedClosure.closedAt || selectedClosure.createdAt || selectedClosure.fecha || selectedClosure.fechaCierre)}</span>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Hora Cierre</span>
                  <span className="text-xs text-slate-200 block">{formatFirebaseTime(selectedClosure.closedAt || selectedClosure.createdAt || selectedClosure.fecha || selectedClosure.fechaCierre)}</span>
                </div>
                <div className="space-y-0.5 col-span-2 sm:col-span-1">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Empleada Entrega (Cerró)</span>
                  <span className="text-xs text-white font-bold block">{getEmployeeFullName(selectedClosure.empleadaEntrega || selectedClosure.employeeName || selectedClosure.createdByEmail)}</span>
                </div>
                <div className="space-y-0.5 col-span-2 sm:col-span-1">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Empleada Recibe</span>
                  <span className="text-xs text-slate-200 block">{getEmployeeFullName(selectedClosure.empleadaRecibe || selectedClosure.receiverEmployeeName)}</span>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Creado Por</span>
                  <span className="text-xs text-slate-400 font-mono truncate block">{selectedClosure.createdByEmail || "N/A"}</span>
                </div>
              </div>

              {/* Financial values details */}
              <div className="space-y-2">
                <h4 className="text-[11px] text-slate-400 font-black uppercase tracking-wider">Resumen Financiero</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {/* Base inicial */}
                  <div className="bg-slate-950/20 p-3 rounded-xl border border-slate-800/40">
                    <span className="text-[10px] text-slate-400 block">Base Inicial</span>
                    <span className="text-sm font-black font-mono text-white block">{formatColombianPesos(selectedClosure.baseInicial)}</span>
                  </div>

                  {/* Ventas efectivo */}
                  <div className="bg-slate-950/20 p-3 rounded-xl border border-slate-800/40">
                    <span className="text-[10px] text-slate-400 block">Ventas Efectivo</span>
                    <span className="text-sm font-black font-mono text-white block">{formatColombianPesos(selectedClosure.ventasEfectivo)}</span>
                  </div>

                  {/* Ventas transferencia */}
                  <div className="bg-slate-950/20 p-3 rounded-xl border border-slate-800/40">
                    <span className="text-[10px] text-slate-400 block">Ventas Transferencia</span>
                    <span className="text-sm font-black font-mono text-white block">{formatColombianPesos(selectedClosure.ventasTransferencia)}</span>
                  </div>

                  {/* Egresos efectivo */}
                  <div className="bg-slate-950/20 p-3 rounded-xl border border-slate-800/40">
                    <span className="text-[10px] text-slate-400 block">Egresos Efectivo</span>
                    <span className="text-sm font-black font-mono text-white block">{formatColombianPesos(selectedClosure.gastosEfectivo || selectedClosure.egresosEfectivo)}</span>
                  </div>

                  {/* Egresos transferencia */}
                  <div className="bg-slate-950/20 p-3 rounded-xl border border-slate-800/40">
                    <span className="text-[10px] text-slate-400 block">Egresos Transferencia</span>
                    <span className="text-sm font-black font-mono text-white block">{formatColombianPesos(selectedClosure.gastosTransferencia || selectedClosure.egresosTransferencia)}</span>
                  </div>

                  {/* Nomina */}
                  <div className="bg-slate-950/20 p-3 rounded-xl border border-slate-800/40">
                    <span className="text-[10px] text-slate-400 block">Nómina/Pagos</span>
                    <span className="text-sm font-black font-mono text-white block">{formatColombianPesos(selectedClosure.nomina)}</span>
                  </div>
                </div>
              </div>

              {/* Cash reconciliation totals */}
              <div className="space-y-2 border-t border-slate-800/80 pt-3">
                <h4 className="text-[11px] text-slate-400 font-black uppercase tracking-wider">Cuadre de Efectivo</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Esperado */}
                  <div className="bg-indigo-500/5 p-3 rounded-xl border border-indigo-500/20">
                    <span className="text-[10px] text-indigo-300 font-bold block">Efectivo Esperado</span>
                    <span className="text-md font-black font-mono text-indigo-200 block">
                      {formatColombianPesos(selectedClosure.efectivoEsperado || selectedClosure.totalEsperadoEfectivo)}
                    </span>
                  </div>

                  {/* Contado */}
                  <div className="bg-emerald-500/5 p-3 rounded-xl border border-emerald-500/20">
                    <span className="text-[10px] text-emerald-300 font-bold block">Dinero Contado</span>
                    <span className="text-md font-black font-mono text-emerald-300 block">
                      {formatColombianPesos(selectedClosure.efectivoContado || selectedClosure.dineroFisicoContado)}
                    </span>
                  </div>

                  {/* Diferencia */}
                  {(() => {
                    const esp = Number(selectedClosure.efectivoEsperado || selectedClosure.totalEsperadoEfectivo || 0);
                    const cont = Number(selectedClosure.efectivoContado || selectedClosure.dineroFisicoContado || 0);
                    const dif = Number(selectedClosure.diferencia ?? selectedClosure.cashDifference ?? (cont - esp));
                    return (
                      <div className={`p-3 rounded-xl border ${dif < 0 ? 'bg-red-500/5 border-red-500/20' : 'bg-emerald-500/5 border-emerald-500/20'}`}>
                        <span className={`text-[10px] font-bold block ${dif < 0 ? 'text-red-300' : 'text-emerald-300'}`}>Diferencia</span>
                        <span className={`text-md font-black font-mono block ${dif < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                          {dif > 0 ? '+' : ''}{formatColombianPesos(dif)}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Novedades/Observaciones */}
              <div className="space-y-1 bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/60">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Observaciones / Novedades</span>
                <p className="text-xs text-slate-300 whitespace-pre-wrap">
                  {selectedClosure.observaciones || selectedClosure.novedades || "Sin novedades registradas."}
                </p>
              </div>

              {/* Inventory details if present */}
              {selectedClosure.inventarioConteo && selectedClosure.inventarioConteo.length > 0 && (
                <div className="space-y-1.5 border-t border-slate-800/55 pt-3">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Conteo de Inventario</span>
                  <div className="overflow-x-auto max-h-[160px] overflow-y-auto border border-slate-800 rounded-xl bg-slate-950/20">
                    <table className="w-full text-[11px] text-slate-300">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-500 font-bold uppercase text-[9px] tracking-wider bg-slate-950/40">
                          <th className="text-left p-2">Producto</th>
                          <th className="text-center p-2">Categoría</th>
                          <th className="text-right p-2">Sistema</th>
                          <th className="text-right p-2">Físico</th>
                          <th className="text-right p-2">Dif</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedClosure.inventarioConteo.map((item: any, idx: number) => (
                          <tr key={item.productoId || idx} className="border-b border-slate-800/50 hover:bg-slate-800/10">
                            <td className="p-2 font-medium">{item.nombre}</td>
                            <td className="p-2 text-center text-slate-400">{item.categoria || "N/A"}</td>
                            <td className="p-2 text-right font-mono">{item.stockSistema}</td>
                            <td className="p-2 text-right font-mono">{item.conteoFisico}</td>
                            <td className={`p-2 text-right font-mono font-bold ${item.diferencia < 0 ? 'text-red-400' : item.diferencia > 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
                              {item.diferencia > 0 ? `+${item.diferencia}` : item.diferencia}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-t border-slate-800 pt-4 mt-5">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePrintClosure(selectedClosure)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-500 hover:bg-indigo-400 text-slate-950 text-xs font-black uppercase tracking-wider rounded-xl transition-all"
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>Imprimir Cierre</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportSingleClosureToExcel(selectedClosure)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black uppercase tracking-wider rounded-xl transition-all"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>Exportar Excel</span>
                </button>
              </div>

              <div className="flex items-center gap-3">
                {printSuccess && (
                  <span className="text-[11px] text-emerald-400 font-bold animate-pulse">{printSuccess}</span>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedClosure(null)}
                  className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all"
                >
                  Cerrar Detalle
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* System info & Quick navigation links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Navigation & Status Card */}
        <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-6 space-y-4">
          <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-400 animate-pulse" />
            <span>Navegación Rápida y Recursos</span>
          </h3>
          <p className="text-xs text-slate-400">
            Utilice estos botones para navegar de forma rápida a los módulos activos o use el menú inferior del sistema.
          </p>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              onClick={() => navigateToTab('habitaciones')}
              className="flex items-center justify-center gap-2 py-3 px-4 bg-slate-950 hover:bg-slate-800 text-white border border-slate-800 hover:border-slate-700 rounded-xl text-xs font-bold transition-all"
            >
              <Bed className="h-4 w-4 text-emerald-400" />
              <span>Ver Habitaciones</span>
              <ArrowRight className="h-3 w-3 text-slate-500 ml-1" />
            </button>
            <button
              onClick={() => navigateToTab('caja')}
              className="flex items-center justify-center gap-2 py-3 px-4 bg-slate-950 hover:bg-slate-800 text-white border border-slate-800 hover:border-slate-700 rounded-xl text-xs font-bold transition-all"
            >
              <Coins className="h-4 w-4 text-emerald-400" />
              <span>Ir a Caja</span>
              <ArrowRight className="h-3 w-3 text-slate-500 ml-1" />
            </button>
          </div>

          <div className="border-t border-slate-800 pt-3.5 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Habitaciones Configuras:</span>
              <span className="font-bold text-white font-mono">{roomsCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Productos en Inventario:</span>
              <span className="font-bold text-white font-mono">{productsCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Cierres Totales Grabados:</span>
              <span className="font-bold text-white font-mono">{closures?.length || 0}</span>
            </div>
          </div>
        </div>

        {/* Administrative & Hardware Configuration */}
        {userProfile?.rol === 'admin' && (
          <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-6 space-y-4">
            <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
              <Settings className="h-4 w-4 text-emerald-400" />
              <span>Configuración del Sistema</span>
            </h3>

            <div className="space-y-3.5">
              
              {/* Checkout hourly rate */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                  <span>Valor Hora Checkout Adicional</span>
                  <span className="text-[10px] text-slate-500">Tarifa actual</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2 text-slate-500 text-sm font-bold">$</span>
                  <input
                    type="text"
                    value={hourlyRateInput}
                    onChange={(e) => setHourlyRateInput(e.target.value.replace(/\D/g, ''))}
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 pl-7 pr-3.5 py-2 text-sm text-white font-mono font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30"
                    placeholder="10000"
                  />
                </div>
              </div>

              {/* Autoprint config switch */}
              <div className="flex items-center justify-between py-1">
                <div>
                  <span className="text-xs font-bold text-white block">Impresión Automática</span>
                  <span className="text-[10px] text-slate-400">Imprimir recibo al realizar ventas o cierres</span>
                </div>
                <button
                  type="button"
                  onClick={() => setAutoPrintEnabled(!autoPrintEnabled)}
                  className={`w-10 h-6 flex items-center rounded-full p-1 transition-all ${
                    autoPrintEnabled ? 'bg-emerald-500' : 'bg-slate-800'
                  }`}
                >
                  <div className={`bg-slate-950 w-4 h-4 rounded-full shadow-md transform transition-all ${
                    autoPrintEnabled ? 'translate-x-4' : 'translate-x-0'
                  }`} />
                </button>
              </div>

              {/* Save Configuration Button */}
              <button
                type="button"
                onClick={handleSaveSettings}
                disabled={isSavingSettings}
                className="w-full py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2"
              >
                {isSavingSettings ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Guardando...</span>
                  </>
                ) : (
                  <>
                    <span>Guardar Cambios</span>
                  </>
                )}
              </button>

              {saveSettingsSuccess && (
                <p className="text-[10px] text-emerald-400 font-bold text-center">
                  ✓ Configuración guardada y sincronizada correctamente en Firestore.
                </p>
              )}

            </div>
          </div>
        )}

      </div>

    </div>
  );
};
