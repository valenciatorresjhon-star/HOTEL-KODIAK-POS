import { doc, updateDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase';
import { safeGetLocalStorage, safeSetLocalStorage } from '../utils/storage';

export function formatFirebaseDate(value: any): string {
  if (!value) return "Sin fecha";

  try {
    let date: Date | null = null;

    if (value && typeof value.toDate === 'function') {
      date = value.toDate();
    } else if (value && typeof value.seconds === 'number') {
      date = new Date(value.seconds * 1000);
    } else if (typeof value === "string") {
      date = new Date(value);
    } else if (value instanceof Date) {
      date = value;
    }

    if (!date || isNaN(date.getTime())) {
      return "Sin fecha";
    }

    return date.toLocaleDateString("es-CO", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
  } catch (error) {
    console.warn("Error formateando fecha:", error);
    return "Sin fecha";
  }
}

export function formatFirebaseTime(value: any): string {
  if (!value) return "Sin hora";

  try {
    let date: Date | null = null;

    if (value && typeof value.toDate === 'function') {
      date = value.toDate();
    } else if (value && typeof value.seconds === 'number') {
      date = new Date(value.seconds * 1000);
    } else if (typeof value === "string") {
      date = new Date(value);
    } else if (value instanceof Date) {
      date = value;
    }

    if (!date || isNaN(date.getTime())) {
      return "Sin hora";
    }

    return date.toLocaleTimeString("es-CO", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
  } catch (error) {
    console.warn("Error formateando hora:", error);
    return "Sin hora";
  }
}

export function formatCurrencyCOP(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

export function formatClosureStatus(difference: number): string {
  if (difference === 0) return "Exacto";
  return difference > 0 ? "Sobrante" : "Faltante";
}

export async function syncClosureToGoogleSheets(closure: any, settings: any): Promise<{ success: boolean; error?: string }> {
  if (!settings?.googleSheetsEnabled || !settings?.googleSheetsWebhookUrl) {
    return { success: false, error: "Sincronización con Google Sheets no habilitada o sin URL de Webhook." };
  }

  try {
    const expectedCash = Number(closure.efectivoEsperado !== undefined ? closure.efectivoEsperado : (closure.expectedCash !== undefined ? closure.expectedCash : (closure.totalEsperadoEfectivo || 0)));
    const countedCash = Number(closure.efectivoContado !== undefined ? closure.efectivoContado : (closure.countedCash !== undefined ? closure.countedCash : (closure.dineroFisicoContado || 0)));
    const diff = Number(closure.diferencia !== undefined ? closure.diferencia : (closure.cashDifference !== undefined ? closure.cashDifference : (closure.diferenciaCaja !== undefined ? closure.diferenciaCaja : (countedCash - expectedCash))));

    const closureDate = closure.closedAt || closure.createdAt || closure.fecha || closure.fechaCierre || "";

    const payload: any = {
      id: closure.id || "",
      shiftId: closure.shiftId || "",
      fechaCierre: formatFirebaseDate(closureDate),
      horaCierre: formatFirebaseTime(closureDate),
      empleadaEntrega: closure.empleadaEntregaNombreCompleto || closure.empleadaEntrega || closure.employeeName || closure.empleada || "Sin dato",
      empleadaEntregaFechaNacimiento: closure.empleadaEntregaFechaNacimiento || "",
      empleadoRecibe: closure.empleadaRecibeNombreCompleto || closure.empleadoRecibe || closure.receiverEmployeeName || "Sin dato",
      empleadaRecibeFechaNacimiento: closure.empleadaRecibeFechaNacimiento || "",
      baseInicial: Number(closure.baseInicial || 0),
      ventasEfectivo: Number(closure.ventasEfectivo || 0),
      ventasTransferencia: Number(closure.ventasTransferencia || 0),
      gastosEfectivo: Number(closure.gastosEfectivo || 0),
      gastosTransferencia: Number(closure.gastosTransferencia || 0),
      nomina: Number(closure.nomina || 0),
      totalEsperadoEfectivo: expectedCash,
      dineroFisicoContado: countedCash,
      diferenciaCaja: diff,
      estadoCaja: formatClosureStatus(diff),
      observaciones: closure.observaciones || closure.notes || "",
      cierreEmergencia: (closure.cierreEmergencia || closure.emergencyClose) ? "SÍ" : "NO",
      creadoPorEmail: closure.createdByEmail || closure.createdBy || "",
      fechaCreacion: formatFirebaseDate(closure.createdAt || closure.closedAt),
      spreadsheetName: settings.googleSheetsSpreadsheetName || "Cierres Hotel Kodiak"
    };

    // Add flattened inventory stock counts
    const inventory = closure.inventarioConteo || closure.conteoInventario || closure.inventoryCounts || [];
    if (Array.isArray(inventory)) {
      inventory.forEach((item: any, idx: number) => {
        const pName = item.nombre || item.productName || item.productoId || `Prod_${idx}`;
        const cleanName = pName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
        payload[`stock_sistema_${cleanName}`] = Number(item.stockSistema !== undefined ? item.stockSistema : item.systemStock || 0);
        payload[`stock_fisico_${cleanName}`] = Number(item.conteoFisico !== undefined ? item.conteoFisico : item.physicalCount || 0);
        payload[`diff_${cleanName}`] = Number(item.diferencia !== undefined ? item.diferencia : 0);
      });
    }

    // We send it using text/plain and no-cors to prevent CORS blocks inside nested iframes/proxies
    await fetch(settings.googleSheetsWebhookUrl, {
      method: "POST",
      mode: "no-cors",
      headers: {
        "Content-Type": "text/plain"
      },
      body: JSON.stringify(payload)
    });

    return { success: true };
  } catch (error: any) {
    console.error("Error syncing with Google Sheets:", error);
    return { success: false, error: error.message || String(error) };
  }
}

export async function updateClosureSyncStatus(closureId: string, status: 'synced' | 'failed' | 'pending', errorMsg?: string) {
  try {
    const list = safeGetLocalStorage<any[]>('hotel_shift_closures', []);
    const idx = list.findIndex(c => c.id === closureId);
    if (idx >= 0) {
      list[idx].googleSheetsSyncStatus = status;
      list[idx].googleSheetsSyncedAt = status === 'synced' ? new Date().toISOString() : null;
      list[idx].googleSheetsError = errorMsg || null;
      safeSetLocalStorage('hotel_shift_closures', list);
    }

    if (db && isFirebaseConfigured) {
      const ref = doc(db, "hotel_shift_closures", closureId);
      await updateDoc(ref, {
        googleSheetsSyncStatus: status,
        googleSheetsSyncedAt: status === 'synced' ? new Date().toISOString() : null,
        googleSheetsError: errorMsg || null
      });
    }
  } catch (error) {
    console.error("Error actualizando estado de Sheets:", error);
  }
}
