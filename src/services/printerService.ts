import { savePrinterError, savePrinterLog, saveCashDrawerLog } from './firebaseService';

// Connection States
let connectedUSBDevice: any = null;
let usbEndpoint: any = null;
let connectedSerialPort: any = null;
let serialWriter: any = null;

let activePrintWindow: Window | null = null;

// =========================================================
// FORMATO UNICO DE IMPRESION HOTEL KODIAK
// Todas las impresiones del sistema deben usar el mismo ancho.
// Esto evita recibos pequenos, mochos o con columnas cortadas.
// =========================================================
const KODIAK_THERMAL_PAPER_SIZE = '48mm';
const KODIAK_RECEIPT_CONTENT_WIDTH = '42mm';
const KODIAK_RECEIPT_CHAR_WIDTH = 32;
const KODIAK_PRINT_WINDOW_FEATURES = 'width=360,height=700';

export function setBrowserPrintWindow(win: Window | null) {
  activePrintWindow = win;
}

export function getBrowserPrintWindow(): Window | null {
  return activePrintWindow;
}

export const DEFAULT_KODIAK_CONFIG_PRINTER = {
  autoPrintEnabled: false,
  printerType: 'browser', // default for web MUST be browser, not escpos
  paperSize: '48mm', // FORMATO UNICO HOTEL KODIAK: impresora MiniPOS / papel 48mm
  windowsPrinterName: 'MiniPOS-58',
  autoOpenDrawer: false, // default for web MUST be false
  openDrawerCashOnly: true,
  useBrowserPrintFallback: true,
  allowManualReprint: true,
  printOnSale: false,
  printOnRoomCharge: false,
  printOnExtraHours: false,
  printOnShiftClose: false,
  cashDrawerCommand: '1B700019FA', // HEX: 1B 70 00 19 FA (ESC p 0 25 250)
  hotelName: 'HOTEL KODIAK'
};

// Clean accents & spanish characters to avoid printing garbled text on low-cost thermal printers
export function cleanAccents(text: string): string {
  if (!text) return "";
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // removes accents
    .replace(/ñ/g, "n")
    .replace(/Ñ/g, "N")
    .replace(/[^\x20-\x7E\n\r\t]/g, ""); // keeps printable ASCII characters
}

export function getHasRealHardwareConnection(): boolean {
  if (typeof window === 'undefined') return false;
  const isElectron = !!((window as any).electronAPI || (window as any).ipcRenderer);
  const mode = localStorage.getItem('printer_connection_mode');
  const hasRealHardwareConnection =
    mode === 'usb' ||
    mode === 'serial' ||
    isElectron;
  return !!hasRealHardwareConnection;
}

// Get setting values merged with defaults
export function getSettings() {
  let settings: any = { ...DEFAULT_KODIAK_CONFIG_PRINTER };
  try {
    const raw = localStorage.getItem('hotel_settings');
    if (raw) {
      const parsed = JSON.parse(raw);
      settings = { ...settings, ...parsed };
    }
  } catch (e) {
    console.error("Error reading hotel_settings for printer:", e);
  }

  // Force browser mode if no real hardware connection exists
  const hasHardware = getHasRealHardwareConnection();
  if (!hasHardware) {
    settings.printerType = 'browser';
    settings.autoOpenDrawer = false;
  }

  // FORMATO UNICO: aunque Firebase/localStorage tenga 58mm u 80mm,
  // todo comprobante del Hotel Kodiak se genera en 48mm.
  settings.paperSize = KODIAK_THERMAL_PAPER_SIZE;

  return settings;
}

// Convert Hex String to Uint8Array
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.replace(/[^0-9A-Fa-f]/g, '');
  const bytes = new Uint8Array(Math.floor(cleanHex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

// Line alignment formatting helpers
export function formatLine(left: string, right: string, width: number): string {
  const leftClean = cleanAccents(left);
  const rightClean = cleanAccents(right);
  const spacesNeeded = width - leftClean.length - rightClean.length;
  if (spacesNeeded <= 0) {
    const spaceToKeep = Math.max(1, width - rightClean.length - 2);
    return leftClean.substring(0, spaceToKeep) + " " + rightClean;
  }
  return leftClean + " ".repeat(spacesNeeded) + rightClean;
}

export function formatCenter(text: string, width: number): string {
  const textClean = cleanAccents(text);
  if (textClean.length >= width) return textClean.substring(0, width);
  const leftSpaces = Math.floor((width - textClean.length) / 2);
  return " ".repeat(leftSpaces) + textClean;
}

export function formatDivider(width: number, char: string = "-"): string {
  return char.repeat(width);
}


function compactReceiptText(value: any, max: number = 22): string {
  const cleaned = cleanAccents(String(value || '').replace(/\s+/g, ' ').trim());
  if (cleaned.length <= max) return cleaned;
  return cleaned.substring(0, Math.max(0, max - 1)) + '.';
}

function closureMoney(value: any): string {
  const n = Number(value || 0);
  return `$${Number.isFinite(n) ? n.toLocaleString('es-CO') : '0'}`;
}

function normalizeClosureText(value: any): string {
  return cleanAccents(String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  );
}

function saleLooksLikeProduct(v: any): boolean {
  const t = normalizeClosureText(`${v?.tipoVenta || ''} ${v?.type || ''} ${v?.concepto || ''} ${v?.productoNombre || ''}`);
  return t.includes('producto') || !!v?.productoNombre || !!v?.productName;
}

function saleLooksLikeRoom(v: any): boolean {
  const t = normalizeClosureText(`${v?.tipoVenta || ''} ${v?.type || ''} ${v?.concepto || ''} ${v?.habitacionNombre || ''} ${v?.roomName || ''}`);
  return t.includes('habitacion') || t.includes('hospedaje') || t.includes('rato') || !!v?.habitacionNombre || !!v?.roomName;
}

function saleLooksLikeReservation(v: any): boolean {
  const t = normalizeClosureText(`${v?.tipoVenta || ''} ${v?.type || ''} ${v?.concepto || ''}`);
  return t.includes('reserva') || t.includes('abono') || t.includes('saldo');
}

function addReceiptWrappedLine(textLines: string[], label: string, value: any, width: number, maxValue: number = 22) {
  const valueText = compactReceiptText(value, maxValue);
  if (!valueText) return;
  textLines.push(formatLine(label, valueText, width));
}

function addClosureTotalReceiptTextLines(textLines: string[], closure: any, width: number) {
  const ventas = Array.isArray(closure.detalleVentas) ? closure.detalleVentas : [];
  const gastos = Array.isArray(closure.detalleGastos) ? closure.detalleGastos : [];
  const inventario = Array.isArray(closure.inventarioConteo)
    ? closure.inventarioConteo
    : (Array.isArray(closure.inventoryCountsList) ? closure.inventoryCountsList : []);
  const diferencias = Array.isArray(closure.productosConDiferencia)
    ? closure.productosConDiferencia
    : inventario.filter((p: any) => Number(p.diferencia || 0) !== 0);

  const habitaciones = ventas.filter((v: any) => saleLooksLikeRoom(v));
  const productos = ventas.filter((v: any) => saleLooksLikeProduct(v));
  const reservas = ventas.filter((v: any) => saleLooksLikeReservation(v));
  const otrosIngresos = ventas.filter((v: any) => !saleLooksLikeRoom(v) && !saleLooksLikeProduct(v) && !saleLooksLikeReservation(v));

  const sum = (arr: any[], field: string) => arr.reduce((acc, item) => acc + Number(item?.[field] || 0), 0);
  const totalHabitaciones = sum(habitaciones, 'total');
  const totalProductos = sum(productos, 'total');
  const totalReservas = sum(reservas, 'total');
  const totalOtros = sum(otrosIngresos, 'total');
  const totalGastos = sum(gastos, 'valor');
  const habitacionesUnicas = Array.from(new Set(habitaciones.map((v: any) => v.habitacionNombre || v.roomName || '').filter(Boolean)));
  const totalProductosVendidos = productos.reduce((acc: number, v: any) => acc + Number(v?.cantidad || v?.quantity || 0), 0);

  textLines.push(formatDivider(width, '-'));
  textLines.push(formatCenter('RESUMEN OPERATIVO', width));
  textLines.push(formatLine('Usos habitac.:', String(habitaciones.length), width));
  textLines.push(formatLine('Hab. distintas:', String(habitacionesUnicas.length), width));
  textLines.push(formatLine('Prod. vendidos:', String(totalProductosVendidos || productos.length), width));
  textLines.push(formatLine('Gastos:', String(gastos.length), width));
  textLines.push(formatLine('Inventario:', String(inventario.length), width));

  textLines.push(formatDivider(width, '-'));
  textLines.push(formatCenter('TOTALES POR CONCEPTO', width));
  textLines.push(formatLine('Hospedajes:', closureMoney(totalHabitaciones), width));
  textLines.push(formatLine('Productos:', closureMoney(totalProductos), width));
  if (reservas.length > 0) textLines.push(formatLine('Reservas:', closureMoney(totalReservas), width));
  if (otrosIngresos.length > 0) textLines.push(formatLine('Otros ingr.:', closureMoney(totalOtros), width));
  textLines.push(formatLine('Gastos:', closureMoney(totalGastos), width));

  if (habitaciones.length > 0) {
    textLines.push(formatDivider(width, '-'));
    textLines.push(formatCenter('HABITACIONES USADAS', width));
    habitaciones.slice(0, 30).forEach((v: any, index: number) => {
      const room = compactReceiptText(v.habitacionNombre || v.roomName || v.concepto || `Hab ${index + 1}`, 15);
      textLines.push(formatLine(`${String(index + 1).padStart(2, '0')}. ${room}`, closureMoney(v.total), width));
      const cliente = compactReceiptText(v.clienteNombre || v.clientName || 'Sin cliente', 20);
      const pago = compactReceiptText(v.metodoPago || v.paymentMethod || '', 5);
      const hora = compactReceiptText(v.hora || '', 8);
      textLines.push(`   ${hora} ${pago} ${cliente}`.substring(0, width));
    });
    if (habitaciones.length > 30) textLines.push(`... ${habitaciones.length - 30} habitaciones mas`);
  }

  if (productos.length > 0) {
    textLines.push(formatDivider(width, '-'));
    textLines.push(formatCenter('PRODUCTOS VENDIDOS', width));
    productos.slice(0, 30).forEach((v: any, index: number) => {
      const product = compactReceiptText(v.productoNombre || v.productName || v.concepto || `Producto ${index + 1}`, 16);
      const qty = Number(v.cantidad || v.quantity || 1);
      textLines.push(formatLine(`${String(index + 1).padStart(2, '0')}. ${product} x${qty}`, closureMoney(v.total), width));
    });
    if (productos.length > 30) textLines.push(`... ${productos.length - 30} productos mas`);
  }

  if (reservas.length > 0) {
    textLines.push(formatDivider(width, '-'));
    textLines.push(formatCenter('RESERVAS / ABONOS', width));
    reservas.slice(0, 20).forEach((v: any, index: number) => {
      const concepto = compactReceiptText(v.concepto || `Reserva ${index + 1}`, 18);
      textLines.push(formatLine(`${String(index + 1).padStart(2, '0')}. ${concepto}`, closureMoney(v.total), width));
    });
  }

  if (otrosIngresos.length > 0) {
    textLines.push(formatDivider(width, '-'));
    textLines.push(formatCenter('OTROS INGRESOS', width));
    otrosIngresos.slice(0, 20).forEach((v: any, index: number) => {
      const concepto = compactReceiptText(v.concepto || `Ingreso ${index + 1}`, 18);
      textLines.push(formatLine(`${String(index + 1).padStart(2, '0')}. ${concepto}`, closureMoney(v.total), width));
    });
  }

  if (gastos.length > 0) {
    textLines.push(formatDivider(width, '-'));
    textLines.push(formatCenter('GASTOS DEL TURNO', width));
    gastos.slice(0, 30).forEach((g: any, index: number) => {
      const concepto = compactReceiptText(g.concepto || `Gasto ${index + 1}`, 17);
      textLines.push(formatLine(`${String(index + 1).padStart(2, '0')}. ${concepto}`, closureMoney(g.valor), width));
      const categoria = compactReceiptText(g.categoria || '', 12);
      const pago = compactReceiptText(g.metodoPago || '', 5);
      if (categoria || pago) textLines.push(`   ${categoria} ${pago}`.substring(0, width));
    });
    if (gastos.length > 30) textLines.push(`... ${gastos.length - 30} gastos mas`);
  }

  if (inventario.length > 0) {
    textLines.push(formatDivider(width, '-'));
    textLines.push(formatCenter('INVENTARIO FISICO', width));
    inventario.slice(0, 40).forEach((p: any) => {
      const nombre = compactReceiptText(p.nombre || 'Producto', 13);
      const sistema = Number(p.stockSistema || p.stockSistemaActual || 0);
      const fisico = Number(p.conteoFisico || p.fisico || 0);
      const diff = Number(p.diferencia || (fisico - sistema));
      textLines.push(formatLine(nombre, `S${sistema} F${fisico} D${diff}`, width));
      if (p.observacion) textLines.push(`   Obs: ${compactReceiptText(p.observacion, 24)}`);
    });
    if (inventario.length > 40) textLines.push(`... ${inventario.length - 40} productos mas`);
  }

  if (diferencias.length > 0) {
    textLines.push(formatDivider(width, '-'));
    textLines.push(formatCenter('ALERTA DIF. INVENTARIO', width));
    diferencias.slice(0, 20).forEach((p: any) => {
      const diff = Number(p.diferencia || 0);
      textLines.push(formatLine(compactReceiptText(p.nombre || 'Producto', 18), diff > 0 ? `+${diff}` : `${diff}`, width));
    });
  }

  textLines.push(formatDivider(width, '-'));
  textLines.push(formatCenter('FIRMAS', width));
  textLines.push('Entrega: ____________________');
  textLines.push('Recibe : ____________________');
}

function addClosureTotalReceiptBuilderLines(builder: any, closure: any, width: number) {
  const lines: string[] = [];
  addClosureTotalReceiptTextLines(lines, closure, width);
  lines.forEach((line) => builder.line(line));
}


// ESC/POS Command Builder
export class EscPosBuilder {
  private buffer: number[] = [];
  private encoder = new TextEncoder();

  init() {
    this.buffer.push(0x1B, 0x40); // ESC @ (Initialize printer)
    return this;
  }

  alignCenter() {
    this.buffer.push(0x1B, 0x61, 0x01); // ESC a 1
    return this;
  }

  alignLeft() {
    this.buffer.push(0x1B, 0x61, 0x00); // ESC a 0
    return this;
  }

  alignRight() {
    this.buffer.push(0x1B, 0x61, 0x02); // ESC a 2
    return this;
  }

  bold(on: boolean) {
    this.buffer.push(0x1B, 0x45, on ? 0x01 : 0x00); // ESC E n
    return this;
  }

  doubleSize(on: boolean) {
    this.buffer.push(0x1D, 0x21, on ? 0x11 : 0x00); // GS ! n (Double width and double height)
    return this;
  }

  text(str: string) {
    const cleaned = cleanAccents(str);
    const bytes = this.encoder.encode(cleaned);
    for (const b of bytes) {
      this.buffer.push(b);
    }
    return this;
  }

  line(str: string = "") {
    this.text(str);
    this.buffer.push(0x0A); // LF
    return this;
  }

  feed(lines: number = 1) {
    for (let i = 0; i < lines; i++) {
      this.buffer.push(0x0A);
    }
    return this;
  }

  cut() {
    this.feed(3);
    this.buffer.push(0x1D, 0x56, 0x42, 0x00); // GS V 66 0 (feed and partial cut)
    return this;
  }

  drawer(commandHex: string = "1B700019FA") {
    const bytes = hexToBytes(commandHex);
    for (const b of bytes) {
      this.buffer.push(b);
    }
    return this;
  }

  getBuffer(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}

// Connect via WebUSB
export async function connectUSBPrinter(): Promise<boolean> {
  const nav = navigator as any;
  if (typeof navigator === 'undefined' || !nav.usb) {
    throw new Error("WebUSB no está soportado en este navegador o contexto de seguridad.");
  }
  try {
    const device = await nav.usb.requestDevice({ filters: [] });
    await device.open();
    await device.selectConfiguration(1);

    let foundInterface: any = null;
    let foundEndpoint: any = null;

    for (const iface of device.configuration?.interfaces || []) {
      for (const alternate of iface.alternates) {
        const bulkOut = alternate.endpoints.find(
          ep => ep.direction === "out" && ep.type === "bulk"
        );
        if (bulkOut) {
          foundInterface = iface;
          foundEndpoint = bulkOut;
          break;
        }
      }
      if (foundEndpoint) break;
    }

    if (!foundInterface || !foundEndpoint) {
      throw new Error("No se encontró un canal (endpoint) compatible para impresora.");
    }

    await device.claimInterface(foundInterface.interfaceNumber);
    connectedUSBDevice = device;
    usbEndpoint = foundEndpoint;

    localStorage.setItem('printer_connection_mode', 'usb');
    return true;
  } catch (error: any) {
    console.error("Error conectando impresora por USB:", error);
    throw new Error(error.message || "Fallo al conectar impresora por USB.");
  }
}

// Connect via WebSerial
export async function connectSerialPrinter(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !("serial" in navigator)) {
    throw new Error("WebSerial no está soportado en este navegador.");
  }
  try {
    const port = await (navigator as any).serial.requestPort();
    await port.open({ baudRate: 9600 });
    connectedSerialPort = port;
    serialWriter = port.writable.getWriter();

    localStorage.setItem('printer_connection_mode', 'serial');
    return true;
  } catch (error: any) {
    console.error("Error conectando impresora por puerto serie:", error);
    throw new Error(error.message || "Fallo al conectar por Puerto Serie.");
  }
}

// Auto-Reconnect Saved Connections
export async function autoConnectPrinter(): Promise<boolean> {
  const mode = localStorage.getItem('printer_connection_mode');
  if (!mode) return false;

  try {
    const nav = navigator as any;
    if (mode === 'usb' && typeof navigator !== 'undefined' && nav.usb) {
      const devices = await nav.usb.getDevices();
      if (devices.length > 0) {
        const device = devices[0];
        await device.open();
        await device.selectConfiguration(1);

        let foundInterface: any = null;
        let foundEndpoint: any = null;

        for (const iface of device.configuration?.interfaces || []) {
          for (const alternate of iface.alternates) {
            const bulkOut = alternate.endpoints.find(
              ep => ep.direction === "out" && ep.type === "bulk"
            );
            if (bulkOut) {
              foundInterface = iface;
              foundEndpoint = bulkOut;
              break;
            }
          }
          if (foundEndpoint) break;
        }

        if (foundInterface && foundEndpoint) {
          await device.claimInterface(foundInterface.interfaceNumber);
          connectedUSBDevice = device;
          usbEndpoint = foundEndpoint;
          console.log("Auto-conectado exitosamente a impresora USB.");
          return true;
        }
      }
    } else if (mode === 'serial' && typeof navigator !== 'undefined' && ("serial" in navigator)) {
      const ports = await (navigator as any).serial.getPorts();
      if (ports.length > 0) {
        const port = ports[0];
        await port.open({ baudRate: 9600 });
        connectedSerialPort = port;
        serialWriter = port.writable.getWriter();
        console.log("Auto-conectado exitosamente a impresora Serial.");
        return true;
      }
    }
  } catch (e) {
    console.warn("No se pudo auto-conectar la impresora guardada:", e);
  }
  return false;
}

// Send Raw Commands
export async function sendEscPosCommand(command: Uint8Array): Promise<void> {
  const mode = localStorage.getItem('printer_connection_mode') || 'none';
  const settings = getSettings();
  const hasHardware = getHasRealHardwareConnection();

  if (settings.printerType === 'browser' || !hasHardware) {
    console.log("IMPRIMIENDO POR NAVEGADOR window.print()");
    return;
  }

  // 1. Electron compatibility
  const isElectron = typeof window !== 'undefined' && (((window as any).electronAPI) || ((window as any).ipcRenderer));
  if (isElectron) {
    const electron = (window as any).electronAPI || (window as any).ipcRenderer;
    try {
      if (electron.send) {
        electron.send('print-escpos', { command: Array.from(command), printerName: settings.windowsPrinterName });
        return;
      } else if (electron.printEscPos) {
        await electron.printEscPos(command, settings.windowsPrinterName);
        return;
      }
    } catch (err: any) {
      console.error("Electron ESC/POS printing error:", err);
      throw new Error(`Error en Electron: ${err.message}`);
    }
  }

  // 2. WebUSB
  if (mode === 'usb' && connectedUSBDevice && usbEndpoint) {
    try {
      await connectedUSBDevice.transferOut(usbEndpoint.endpointNumber, command);
      return;
    } catch (e) {
      console.error("USB error, trying to re-claim:", e);
      const reconnected = await autoConnectPrinter();
      if (reconnected && connectedUSBDevice && usbEndpoint) {
        await connectedUSBDevice.transferOut(usbEndpoint.endpointNumber, command);
        return;
      }
      throw new Error("Impresora USB desconectada o no responde.");
    }
  }

  // 3. WebSerial
  if (mode === 'serial' && connectedSerialPort && serialWriter) {
    try {
      await serialWriter.write(command);
      return;
    } catch (e) {
      console.error("Serial error, trying to re-open:", e);
      const reconnected = await autoConnectPrinter();
      if (reconnected && serialWriter) {
        await serialWriter.write(command);
        return;
      }
      throw new Error("Impresora Serial desconectada o no responde.");
    }
  }

  // Fallback / Mock preview behavior
  console.log("ESC/POS Comando enviado (Simulación):", command);
  const textDecoder = new TextDecoder();
  const simulatedText = textDecoder.decode(command);
  console.log("%c[Impresora Térmica Simulación]:\n" + simulatedText, "color: #10B981; font-family: monospace; font-size: 11px; line-height: 1.1;");
}

export function parseReceiptTextToHtml(plainText: string): string {
  const lines = plainText.split('\n');
  return lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) {
      return '<div style="height: 3px;"></div>'; // small spacer for empty lines
    }

    // Check if it is a divider
    if (/^[=\-_*]+$/.test(trimmed)) {
      return '<div class="line"></div>';
    }

    // Check if it is a row (key-value split by multiple spaces)
    const match = line.match(/^(\s*)(.*?)\s{2,}(.*)$/);
    if (match) {
      const left = match[2].trim();
      const right = match[3].trim();

      const isTotal = left.toLowerCase().includes('total') || left.toLowerCase().includes('cambio') || left.toLowerCase().includes('recibido');
      const rowClass = isTotal ? 'row total' : 'row';
      const leftClass = isTotal ? 'bold' : '';
      const rightClass = isTotal ? 'bold' : '';

      return `<div class="${rowClass}"><span class="${leftClass}">${left}</span><span class="${rightClass}">${right}</span></div>`;
    }

    // Check if it is centered (typically has leading spaces)
    const leadingSpaces = line.match(/^(\s+)/);
    const isCentered = leadingSpaces && leadingSpaces[1].length >= 2;
    if (isCentered) {
      const isHeader = trimmed.includes('HOTEL') || trimmed.includes('NIT') || trimmed.includes('COMPROBANTE') || trimmed.includes('ARQUEO') || trimmed.includes('GRACIAS') || trimmed.includes('Gracias') || trimmed.includes('¡Hasta pronto!');
      const isHotelName = trimmed.includes('HOTEL KODIAK');
      const headerClass = isHotelName ? 'header-title bold' : (isHeader ? 'bold' : '');
      return `<div class="center ${headerClass}">${trimmed}</div>`;
    }

    // Normal text line
    const isBold = trimmed.toLowerCase().includes('detalle') || trimmed.toLowerCase().includes('concepto');
    const smallClass = trimmed.startsWith('Obs:') ? 'small' : '';
    const boldClass = isBold ? 'bold' : '';
    return `<div class="${boldClass} ${smallClass}">${trimmed}</div>`;
  }).join('\n');
}

export function buildReceiptHtml(plainText: string, paperSize: string = KODIAK_THERMAL_PAPER_SIZE): string {
  const size = KODIAK_THERMAL_PAPER_SIZE;
  const usefulWidth = KODIAK_RECEIPT_CONTENT_WIDTH;
  const htmlElements = parseReceiptTextToHtml(plainText);

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Comprobante de Pago - Hotel Kodiak</title>
        <style>
          * {
            box-sizing: border-box !important;
          }
          @page {
            size: ${size} auto;
            margin: 0;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            width: ${size} !important;
            max-width: ${size} !important;
            background: white !important;
            color: black !important;
            font-family: Arial, Helvetica, sans-serif !important;
            font-size: 10px !important;
            line-height: 1.2 !important;
            overflow: hidden !important;
            writing-mode: horizontal-tb;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          body.print-mode,
          .print-root,
          .print-wrapper {
            margin: 0 !important;
            padding: 0 !important;
            display: block !important;
            width: ${size} !important;
            max-width: ${size} !important;
          }
          .receipt {
            box-sizing: border-box !important;
            width: ${usefulWidth} !important;
            max-width: ${usefulWidth} !important;
            margin: 0 !important;
            padding: 1.5mm 2mm 2mm 2mm !important;
            text-align: left !important;
            font-size: 10px !important;
            line-height: 1.2 !important;
            overflow: hidden !important;
          }
          .center {
            text-align: center !important;
          }
          .row {
            display: flex !important;
            justify-content: space-between !important;
            align-items: flex-start !important;
            gap: 4px !important;
            width: 100% !important;
            box-sizing: border-box !important;
          }
          .row span:first-child {
            text-align: left !important;
            word-break: break-word !important;
            flex-shrink: 1 !important;
            flex-grow: 1 !important;
          }
          .row span:last-child {
            text-align: right !important;
            word-break: normal !important;
            white-space: nowrap !important;
            flex-shrink: 0 !important;
          }
          .line {
            border-top: 1px dashed #000 !important;
            margin: 4px 0 !important;
            height: 0 !important;
          }
          .small {
            font-size: 9px !important;
          }
          .bold {
            font-weight: bold !important;
          }
          .header-title {
            font-size: 11px !important;
            font-weight: bold !important;
          }
          .total {
            font-size: 11px !important;
            font-weight: bold !important;
          }
          .no-print {
            text-align: center !important;
            margin: 10px 0 !important;
          }
          .no-print button {
            padding: 6px 12px !important;
            background-color: #3b82f6 !important;
            color: white !important;
            border: none !important;
            border-radius: 4px !important;
            font-weight: bold !important;
            cursor: pointer !important;
            font-family: sans-serif !important;
            font-size: 11px !important;
          }
          @media print {
            html, body {
              width: ${size} !important;
              max-width: ${size} !important;
              margin: 0 !important;
              padding: 0 !important;
              overflow: hidden !important;
            }
            .receipt {
              width: ${usefulWidth} !important;
              max-width: ${usefulWidth} !important;
              margin: 0 !important;
              padding: 1.5mm 2mm 2mm 2mm !important;
            }
            .no-print {
              display: none !important;
            }
          }
        </style>
      </head>
      <body>
        <div class="no-print">
          <button onclick="window.print()">Imprimir Comprobante</button>
        </div>
        <div class="receipt">
          ${htmlElements}
        </div>
      </body>
    </html>
  `;
}

export function openBrowserPrintWindow(): Window | null {
  if (typeof window === 'undefined') return null;
  const printWindow = window.open("", "_blank", KODIAK_PRINT_WINDOW_FEATURES);

  if (!printWindow) {
    console.warn("El navegador bloqueó la ventana de impresión.");
    return null;
  }

  printWindow.document.open();
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Preparando comprobante...</title>
        <style>
          body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            text-align: center;
            padding-top: 50px;
            color: #4b5563;
            background: #fff;
          }
          .loader {
            border: 4px solid #f3f3f3;
            border-top: 4px solid #3b82f6;
            border-radius: 50%;
            width: 32px;
            height: 32px;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="loader"></div>
        <p style="font-size: 14px; font-weight: 500;">Generando comprobante de pago...</p>
        <p style="font-size: 12px; color: #9ca3af;">Por favor espere un momento.</p>
      </body>
    </html>
  `);
  printWindow.document.close();
  return printWindow;
}

export async function printViaBrowserWindow(plainText: string, printWindow: Window, paperSize: string = KODIAK_THERMAL_PAPER_SIZE): Promise<boolean> {
  if (!printWindow || printWindow.closed) {
    console.warn("La ventana de impresión fue cerrada o no está disponible.");
    return false;
  }

  const receiptHtml = buildReceiptHtml(plainText, paperSize);

  try {
    printWindow.document.open();
    printWindow.document.write(receiptHtml);
    printWindow.document.close();

    printWindow.focus();

    // Trigger Chrome print dialog
    setTimeout(() => {
      printWindow.print();
    }, 300);

    return true;
  } catch (error: any) {
    console.error("Error al imprimir en ventana:", error);
    return false;
  }
}

// Trigger browser's print window with a custom-styled receipt
async function printViaBrowser(plainText: string = '', paperSize: string = KODIAK_THERMAL_PAPER_SIZE): Promise<void> {
  const printSection = document.createElement('div');
  printSection.id = 'thermal-print-section';
  printSection.className = 'receipt';
  printSection.innerHTML = parseReceiptTextToHtml(plainText);
  document.body.appendChild(printSection);

  const size = KODIAK_THERMAL_PAPER_SIZE;
  const usefulWidth = KODIAK_RECEIPT_CONTENT_WIDTH;

  const style = document.createElement('style');
  style.id = 'thermal-print-style';
  style.textContent = `
    @media print {
      body > *:not(#thermal-print-section) {
        display: none !important;
      }
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        width: ${size} !important;
        max-width: ${size} !important;
        overflow: hidden !important;
      }
      #thermal-print-section {
        display: block !important;
        box-sizing: border-box !important;
        width: ${usefulWidth} !important;
        max-width: ${usefulWidth} !important;
        margin: 0 !important;
        padding: 1.5mm 2mm 2mm 2mm !important;
        background: #fff !important;
        font-family: Arial, Helvetica, sans-serif !important;
        font-size: 10px !important;
        line-height: 1.2 !important;
        color: black !important;
        text-align: left !important;
        overflow: hidden !important;
      }
      #thermal-print-section .center {
        text-align: center !important;
      }
      #thermal-print-section .row {
        display: flex !important;
        justify-content: space-between !important;
        align-items: flex-start !important;
        gap: 4px !important;
        width: 100% !important;
        box-sizing: border-box !important;
      }
      #thermal-print-section .row span:first-child {
        text-align: left !important;
        word-break: break-word !important;
        flex-shrink: 1 !important;
        flex-grow: 1 !important;
      }
      #thermal-print-section .row span:last-child {
        text-align: right !important;
        word-break: normal !important;
        white-space: nowrap !important;
        flex-shrink: 0 !important;
      }
      #thermal-print-section .line {
        border-top: 1px dashed #000 !important;
        margin: 4px 0 !important;
        height: 0 !important;
      }
      #thermal-print-section .small {
        font-size: 9px !important;
      }
      #thermal-print-section .bold {
        font-weight: bold !important;
      }
      #thermal-print-section .header-title {
        font-size: 11px !important;
        font-weight: bold !important;
      }
      #thermal-print-section .total {
        font-size: 11px !important;
        font-weight: bold !important;
      }
      @page {
        margin: 0 !important;
        size: ${size} auto !important;
      }
    }
  `;
  document.head.appendChild(style);

  try {
    window.print();
  } finally {
    // Clean up DOM after print window is closed
    if (document.getElementById('thermal-print-section')) {
      document.body.removeChild(printSection);
    }
    if (document.getElementById('thermal-print-style')) {
      document.head.removeChild(style);
    }
  }
}

// Open Cash Drawer Command
export async function openCashDrawer(
  source: string = 'automatic',
  saleId: string = '',
  amount: number = 0,
  paymentMethod: string = 'Efectivo',
  employeeName: string = 'Sistema',
  createdBy: string = 'system'
): Promise<void> {
  const settings = getSettings();
  const hasHardware = getHasRealHardwareConnection();

  if (!settings.autoOpenDrawer || settings.printerType === 'browser' || !hasHardware) {
    console.log("Cajón monedero no se abre: autoOpenDrawer desactivado, modo browser, o sin conexión de hardware.");
    return;
  }

  const commandHex = settings.cashDrawerCommand || '1B700019FA';
  console.log("Iniciando comando openCashDrawer():", commandHex);

  try {
    const commandBytes = hexToBytes(commandHex);
    await sendEscPosCommand(commandBytes);

    await saveCashDrawerLog({
      type: "cash_drawer_opened",
      source,
      ...(source === 'expense' ? { expenseId: saleId } : { saleId }),
      amount,
      paymentMethod,
      employeeName,
      createdBy,
      success: true,
      error: null
    });
  } catch (error: any) {
    console.error("Error abriendo cajón monedero:", error);
    await savePrinterError({
      message: `No se pudo abrir el cajón automáticamente. Revise que el cajón esté conectado a la impresora. Detalle: ${error.message || String(error)}`,
      operation: 'Apertura Cajon',
      usuario: employeeName || 'Sistema',
      fecha: new Date().toLocaleDateString(),
      hora: new Date().toLocaleTimeString()
    });

    await saveCashDrawerLog({
      type: "cash_drawer_opened",
      source,
      ...(source === 'expense' ? { expenseId: saleId } : { saleId }),
      amount,
      paymentMethod,
      employeeName,
      createdBy,
      success: false,
      error: error.message || String(error)
    });

    throw new Error("No se pudo abrir el cajón automáticamente. Revise que el cajón esté conectado a la impresora.");
  }
}

// Print Receipt logic
function firstReceiptText(...values: any[]): string {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text && text !== '-' && text.toLowerCase() !== 'undefined' && text.toLowerCase() !== 'null') return text;
  }
  return '';
}

function resolveReceiptCompanyName(raw: any): string {
  return firstReceiptText(
    raw?.empresa,
    raw?.empresaNombre,
    raw?.nombreEmpresa,
    raw?.razonSocial,
    raw?.companyName,
    raw?.facturacion?.empresa,
    raw?.facturacion?.empresaNombre,
    raw?.datosEmpresa?.empresa,
    raw?.datosEmpresa?.nombre,
    raw?.clienteDetails?.empresa,
    raw?.clienteDetails?.empresaNombre,
    raw?.clienteDetails?.nombreEmpresa,
    raw?.client?.empresa,
    raw?.client?.empresaNombre,
    raw?.cliente?.empresa,
    raw?.cliente?.empresaNombre
  );
}

function resolveReceiptCompanyNit(raw: any): string {
  return firstReceiptText(
    raw?.nitEmpresa,
    raw?.empresaNit,
    raw?.nitFacturacion,
    raw?.clientNit,
    raw?.companyNit,
    raw?.nit,
    raw?.facturacion?.nit,
    raw?.facturacion?.empresaNit,
    raw?.facturacion?.nitEmpresa,
    raw?.datosEmpresa?.nit,
    raw?.datosEmpresa?.empresaNit,
    raw?.clienteDetails?.nit,
    raw?.clienteDetails?.empresaNit,
    raw?.clienteDetails?.nitEmpresa,
    raw?.client?.nit,
    raw?.client?.empresaNit,
    raw?.cliente?.nit,
    raw?.cliente?.empresaNit
  );
}

export async function printReceipt(rawReceiptData: any, printWindow?: Window | null): Promise<void> {
  const settings = getSettings();
  const width = KODIAK_RECEIPT_CHAR_WIDTH;

  const empresaRecibo = String(
    rawReceiptData?.empresaNombre ||
    rawReceiptData?.empresa ||
    rawReceiptData?.razonSocial ||
    rawReceiptData?.empresaFacturacion ||
    rawReceiptData?.companyName ||
    rawReceiptData?.clienteDetails?.empresaNombre ||
    rawReceiptData?.clienteDetails?.empresa ||
    rawReceiptData?.clienteDetails?.razonSocial ||
    resolveReceiptCompanyName(rawReceiptData) ||
    ''
  ).trim();

  const nitEmpresaRecibo = String(
    rawReceiptData?.nitEmpresa ||
    rawReceiptData?.empresaNit ||
    rawReceiptData?.nitFacturacion ||
    rawReceiptData?.companyNit ||
    rawReceiptData?.clientNit ||
    rawReceiptData?.clienteDetails?.nitEmpresa ||
    rawReceiptData?.clienteDetails?.empresaNit ||
    rawReceiptData?.clienteDetails?.nit ||
    resolveReceiptCompanyNit(rawReceiptData) ||
    ''
  ).trim();

  const debeMostrarEmpresa = Boolean(
    empresaRecibo ||
    nitEmpresaRecibo ||
    rawReceiptData?.facturarEmpresa ||
    rawReceiptData?.facturarAEmpresa ||
    rawReceiptData?.esEmpresa
  );

  console.log('[PRINTER EMPRESA/NIT]', {
    empresaRecibo,
    nitEmpresaRecibo,
    debeMostrarEmpresa,
    receipt: rawReceiptData
  });

  // Normalize data fields so we support both direct receipt structures
  const receiptData = {
    id: rawReceiptData.id || rawReceiptData.saleId || '',
    fecha: rawReceiptData.fecha || new Date().toLocaleDateString('es-CO'),
    hora: rawReceiptData.hora || new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
    employeeName: rawReceiptData.employeeName || rawReceiptData.empleada || 'Sistema',
    turno: rawReceiptData.turno || 'N/A',
    cliente: rawReceiptData.cliente || rawReceiptData.clienteNombre || 'Cliente General',
    empresa: empresaRecibo,
    nitEmpresa: nitEmpresaRecibo,
    debeMostrarEmpresa,
    habitacion: rawReceiptData.habitacion || rawReceiptData.habitacionNombre || '',
    metodoPago: rawReceiptData.metodoPago || rawReceiptData.metodo || 'Efectivo',
    total: rawReceiptData.total !== undefined ? rawReceiptData.total : (rawReceiptData.valor !== undefined ? rawReceiptData.valor : 0),
    pagadoWith: rawReceiptData.pagadoWith !== undefined ? rawReceiptData.pagadoWith : (rawReceiptData.recibido !== undefined ? rawReceiptData.recibido : 0),
    cambio: rawReceiptData.cambio !== undefined ? rawReceiptData.cambio : 0,
    tipo: rawReceiptData.tipo || rawReceiptData.tipoVenta || 'Venta',
    conceptos: rawReceiptData.conceptos || [],
    concepto: rawReceiptData.concepto || '',
    observaciones: rawReceiptData.observaciones || rawReceiptData.observacion || '',
    tipoVenta: rawReceiptData.tipoVenta || rawReceiptData.tipo || 'Venta',
    createdBy: rawReceiptData.createdBy || 'system'
  };

  try {
    const formattedDate = receiptData.fecha;
    const formattedTime = receiptData.hora;

    // 1. Build text layout
    const textLines: string[] = [];
    textLines.push(formatCenter(settings.hotelName || "HOTEL KODIAK", width));
    textLines.push(formatCenter("NIT: 901.234.567-8", width));
    textLines.push(formatCenter("SOPORTE DE COMPROBANTE", width));
    textLines.push(formatDivider(width, "="));

    textLines.push(formatLine("Fecha:", formattedDate, width));
    textLines.push(formatLine("Hora:", formattedTime, width));
    
    if (receiptData.employeeName) {
      textLines.push(formatLine("Atendido por:", receiptData.employeeName, width));
    }
    if (receiptData.turno) {
      textLines.push(formatLine("Turno:", receiptData.turno, width));
    }
    textLines.push(formatDivider(width, "-"));

    if (receiptData.cliente) {
      textLines.push(formatLine("Cliente:", receiptData.cliente, width));
    }
    if (debeMostrarEmpresa) {
      textLines.push(formatDivider(width, "-"));
      textLines.push("FACTURAR A EMPRESA");
      if (empresaRecibo) {
        textLines.push(`Empresa: ${cleanAccents(empresaRecibo)}`.substring(0, width));
      }
      if (nitEmpresaRecibo) {
        textLines.push(formatLine("NIT Empresa:", nitEmpresaRecibo, width));
      }
    }
    if (receiptData.habitacion) {
      textLines.push(formatLine("Habitacion:", receiptData.habitacion, width));
    }
    if (receiptData.tipo) {
      textLines.push(formatLine("Operacion:", receiptData.tipo, width));
    }
    if (rawReceiptData.diasPagados && Number(rawReceiptData.diasPagados) > 1) {
      textLines.push(formatLine("Estadia:", `${rawReceiptData.diasPagados} dias/noches`, width));
      if (rawReceiptData.tarifaDiaria) {
        textLines.push(formatLine("Tarifa diaria:", `$${Number(rawReceiptData.tarifaDiaria).toLocaleString('es-CO')}`, width));
      }
      if (rawReceiptData.subtotalSinDescuento) {
        textLines.push(formatLine("Subtotal:", `$${Number(rawReceiptData.subtotalSinDescuento).toLocaleString('es-CO')}`, width));
      }
      if (rawReceiptData.descuentoEstadiaLarga && Number(rawReceiptData.descuentoEstadiaLarga) > 0) {
        textLines.push(formatLine("Desc. 10% (3+ d):", `-$${Number(rawReceiptData.descuentoEstadiaLarga).toLocaleString('es-CO')}`, width));
      }
    }
    if (rawReceiptData.salidaProgramada) {
      textLines.push(formatLine("Salida prog.:", cleanAccents(String(rawReceiptData.salidaProgramada)), width));
    }
    textLines.push(formatDivider(width, "-"));

    // Dynamic Items / Concepts
    if (receiptData.conceptos && receiptData.conceptos.length > 0) {
      textLines.push("Detalle de Items:");
      for (const item of receiptData.conceptos) {
        const qtyDesc = `${item.cantidad}x ${item.descripcion}`;
        const itemTotal = `$${(item.total || 0).toLocaleString()}`;
        textLines.push(formatLine(qtyDesc, itemTotal, width));
      }
      textLines.push(formatDivider(width, "-"));
    } else if (receiptData.concepto) {
      textLines.push(`Concepto: ${receiptData.concepto}`);
      textLines.push(formatDivider(width, "-"));
    }

    textLines.push(formatLine("Metodo Pago:", receiptData.metodoPago || "Efectivo", width));
    textLines.push(formatDivider(width, "-"));

    textLines.push(formatLine("TOTAL:", `$${(receiptData.total || 0).toLocaleString()}`, width));

    const isCash = (receiptData.metodoPago || '').toLowerCase().includes('efectivo') || (receiptData.metodoPago || '').toLowerCase().includes('cash');
    if (isCash) {
      if (receiptData.pagadoWith !== undefined && receiptData.pagadoWith !== null) {
        textLines.push(formatLine("Recibido:", `$${(receiptData.pagadoWith || 0).toLocaleString()}`, width));
      }
      if (receiptData.cambio !== undefined && receiptData.cambio !== null) {
        textLines.push(formatLine("Cambio:", `$${(receiptData.cambio || 0).toLocaleString()}`, width));
      }
    }

    if (receiptData.observaciones) {
      textLines.push(formatDivider(width, "-"));
      textLines.push(`Obs: ${receiptData.observaciones}`);
    }

    textLines.push(formatDivider(width, "="));
    textLines.push(formatCenter("Gracias por preferir", width));
    textLines.push(formatCenter(settings.hotelName || "Hotel Kodiak", width));
    textLines.push(formatCenter("¡Hasta pronto!", width));
    textLines.push("\n\n\n");

    const plainText = textLines.join("\n");

    console.log("CONFIG IMPRESORA ACTIVA:", settings);

    const hasHardware = getHasRealHardwareConnection();
    // 2. Decide Print Method
    if (settings.printerType === 'browser' || !hasHardware) {
      console.log("IMPRIMIENDO POR NAVEGADOR window.print()");
      const finalPrintWindow = printWindow || getBrowserPrintWindow();
      if (finalPrintWindow) {
        setBrowserPrintWindow(null);
        await printViaBrowserWindow(plainText, finalPrintWindow, KODIAK_THERMAL_PAPER_SIZE);
      } else {
        await printViaBrowser(plainText, KODIAK_THERMAL_PAPER_SIZE);
      }
      return;
    }

    // Standard ESC/POS formatting
    const builder = new EscPosBuilder().init();
    
    // Header double height/width bold
    builder.alignCenter().doubleSize(true).bold(true).line(settings.hotelName || "HOTEL KODIAK").doubleSize(false).bold(false);
    builder.line("NIT: 901.234.567-8").line("SOPORTE DE COMPROBANTE").line(formatDivider(width, "="));

    // General Meta Left-aligned
    builder.alignLeft();
    builder.line(formatLine("Fecha:", formattedDate, width));
    builder.line(formatLine("Hora:", formattedTime, width));
    
    if (receiptData.employeeName) {
      builder.line(formatLine("Atendido por:", receiptData.employeeName, width));
    }
    if (receiptData.turno) {
      builder.line(formatLine("Turno:", receiptData.turno, width));
    }
    builder.line(formatDivider(width, "-"));

    if (receiptData.cliente) {
      builder.line(formatLine("Cliente:", receiptData.cliente, width));
    }
    if (debeMostrarEmpresa) {
      builder.line(formatDivider(width, "-"));
      builder.line("FACTURAR A EMPRESA");
      if (empresaRecibo) {
        builder.line(`Empresa: ${cleanAccents(empresaRecibo)}`.substring(0, width));
      }
      if (nitEmpresaRecibo) {
        builder.line(formatLine("NIT Empresa:", nitEmpresaRecibo, width));
      }
    }
    if (receiptData.habitacion) {
      builder.line(formatLine("Habitacion:", receiptData.habitacion, width));
    }
    if (receiptData.tipo) {
      builder.line(formatLine("Operacion:", receiptData.tipo, width));
    }
    if (rawReceiptData.diasPagados && Number(rawReceiptData.diasPagados) > 1) {
      builder.line(formatLine("Estadia:", `${rawReceiptData.diasPagados} dias/noches`, width));
      if (rawReceiptData.tarifaDiaria) {
        builder.line(formatLine("Tarifa diaria:", `$${Number(rawReceiptData.tarifaDiaria).toLocaleString('es-CO')}`, width));
      }
      if (rawReceiptData.subtotalSinDescuento) {
        builder.line(formatLine("Subtotal:", `$${Number(rawReceiptData.subtotalSinDescuento).toLocaleString('es-CO')}`, width));
      }
      if (rawReceiptData.descuentoEstadiaLarga && Number(rawReceiptData.descuentoEstadiaLarga) > 0) {
        builder.line(formatLine("Desc. 10% (3+ d):", `-$${Number(rawReceiptData.descuentoEstadiaLarga).toLocaleString('es-CO')}`, width));
      }
    }
    if (rawReceiptData.salidaProgramada) {
      builder.line(formatLine("Salida prog.:", cleanAccents(String(rawReceiptData.salidaProgramada)), width));
    }
    builder.line(formatDivider(width, "-"));

    // Details list
    if (receiptData.conceptos && receiptData.conceptos.length > 0) {
      builder.line("Detalle de Items:");
      for (const item of receiptData.conceptos) {
        const qtyDesc = `${item.cantidad}x ${item.descripcion}`;
        const itemTotal = `$${(item.total || 0).toLocaleString()}`;
        builder.line(formatLine(qtyDesc, itemTotal, width));
      }
      builder.line(formatDivider(width, "-"));
    } else if (receiptData.concepto) {
      builder.line(`Concepto: ${receiptData.concepto}`);
      builder.line(formatDivider(width, "-"));
    }

    // Payment Info
    builder.line(formatLine("Metodo Pago:", receiptData.metodoPago || "Efectivo", width));
    builder.line(formatDivider(width, "-"));

    // Total Bold
    builder.bold(true).line(formatLine("TOTAL:", `$${(receiptData.total || 0).toLocaleString()}`, width)).bold(false);

    if (isCash) {
      if (receiptData.pagadoWith !== undefined && receiptData.pagadoWith !== null) {
        builder.line(formatLine("Recibido:", `$${(receiptData.pagadoWith || 0).toLocaleString()}`, width));
      }
      if (receiptData.cambio !== undefined && receiptData.cambio !== null) {
        builder.line(formatLine("Cambio:", `$${(receiptData.cambio || 0).toLocaleString()}`, width));
      }
    }

    if (receiptData.observaciones) {
      builder.line(formatDivider(width, "-"));
      builder.line(`Obs: ${receiptData.observaciones}`);
    }

    builder.line(formatDivider(width, "="));
    builder.alignCenter().line("Gracias por preferir").line(settings.hotelName || "Hotel Kodiak").line("¡Hasta pronto!");
    builder.cut();

    await sendEscPosCommand(builder.getBuffer());

    // Save printer audit log
    await savePrinterLog({
      type: "receipt_printed",
      saleId: receiptData.id || '',
      source: receiptData.tipoVenta || receiptData.tipo || 'Venta',
      printerMode: settings.printerType === 'browser' ? 'browser' : (settings.printerType || 'simulacion'),
      employeeName: receiptData.employeeName || 'Sistema',
      createdBy: receiptData.createdBy || 'system',
      success: true,
      error: null
    });

    // 3. Auto-Open Drawer if Cash
    if (settings.autoOpenDrawer && (!settings.openDrawerCashOnly || isCash)) {
      await openCashDrawer(
        'automatic_sale',
        receiptData.id || '',
        receiptData.total || 0,
        receiptData.metodoPago || 'Efectivo',
        receiptData.employeeName || 'Sistema',
        receiptData.createdBy || 'system'
      );
    }
  } catch (error: any) {
    console.error("Fallo durante el flujo de impresión de recibo:", error);
    await savePrinterError({
      message: `No se pudo imprimir el recibo. Revise conexión de la impresora. Detalle: ${error.message || String(error)}`,
      operation: receiptData.tipo || 'Venta',
      usuario: receiptData.employeeName || 'Sistema',
      fecha: new Date().toLocaleDateString(),
      hora: new Date().toLocaleTimeString()
    });

    await savePrinterLog({
      type: "receipt_printed",
      saleId: receiptData.id || '',
      source: receiptData.tipoVenta || receiptData.tipo || 'Venta',
      printerMode: settings.printerType === 'browser' ? 'browser' : (settings.printerType || 'simulacion'),
      employeeName: receiptData.employeeName || 'Sistema',
      createdBy: receiptData.createdBy || 'system',
      success: false,
      error: error.message || String(error)
    });

    throw new Error("No se pudo imprimir el recibo. Revise conexión de la impresora.");
  }
}

// Test printer function
export async function testPrinter(): Promise<void> {
  const settings = getSettings();
  const width = KODIAK_RECEIPT_CHAR_WIDTH;

  try {
    const hasHardware = getHasRealHardwareConnection();
    if (settings.printerType === 'browser' || !hasHardware) {
      const textLines = [
        formatCenter(settings.hotelName || "HOTEL KODIAK", width),
        formatCenter("PRUEBA DE IMPRESION", width),
        formatDivider(width, "="),
        formatLine("Tipo:", "Navegador / Preview", width),
        formatLine("Papel:", settings.paperSize, width),
        formatDivider(width, "-"),
        formatCenter("¡Impresion de prueba correcta!", width),
        formatCenter("Hotel Kodiak", width),
        "\n\n\n"
      ].join("\n");
      await printViaBrowser(textLines, settings.paperSize);
      return;
    }

    const builder = new EscPosBuilder().init();
    builder.alignCenter().doubleSize(true).bold(true).line(settings.hotelName || "HOTEL KODIAK").doubleSize(false).bold(false);
    builder.line("PRUEBA DE IMPRESION ESC/POS").line(formatDivider(width, "="));
    builder.alignLeft();
    builder.line(formatLine("Tipo:", "Termica ESC/POS", width));
    builder.line(formatLine("Papel:", settings.paperSize, width));
    builder.line(formatLine("Puerto Windows:", settings.windowsPrinterName, width));
    builder.line(formatDivider(width, "-"));
    builder.alignCenter().bold(true).line("¡IMPRESORA ACTIVA Y OK!").bold(false).line("Hotel Kodiak");
    builder.cut();

    await sendEscPosCommand(builder.getBuffer());
  } catch (error: any) {
    console.error("Error en testPrinter:", error);
    await savePrinterError({
      message: `Fallo en autodiagnóstico: ${error.message || String(error)}`,
      operation: 'Test Impresora',
      usuario: 'Sistema',
      fecha: new Date().toLocaleDateString(),
      hora: new Date().toLocaleTimeString()
    });
    throw new Error("No se pudo imprimir el recibo. Revise conexión de la impresora.");
  }
}

// Test cash drawer function
export async function testCashDrawer(): Promise<void> {
  await openCashDrawer();
}

// Get general printer status
export function getPrinterStatus() {
  const mode = localStorage.getItem('printer_connection_mode') || 'none';
  const settings = getSettings();

  const isElectron = typeof window !== 'undefined' && (((window as any).electronAPI) || ((window as any).ipcRenderer));
  let isConnected = false;
  if (mode === 'usb' && connectedUSBDevice) isConnected = true;
  if (mode === 'serial' && connectedSerialPort) isConnected = true;

  return {
    connected: isConnected || isElectron,
    mode: isElectron ? 'electron' : mode,
    type: settings.printerType,
    paperSize: settings.paperSize,
  };
}

// Print Shift Closure Receipt
export async function printShiftClosureReceipt(closure: any, printWindow?: Window | null): Promise<void> {
  const settings = getSettings();
  const width = KODIAK_RECEIPT_CHAR_WIDTH;

  try {
    const formattedDate = closure.fechaCierre || new Date().toLocaleDateString();
    const formattedTime = closure.horaCierre || new Date().toLocaleTimeString();

    const textLines: string[] = [];
    textLines.push(formatCenter(settings.hotelName || "HOTEL KODIAK", width));
    textLines.push(formatCenter("NIT: 901.234.567-8", width));
    textLines.push(formatCenter("ARQUEO & CIERRE DE TURNO", width));
    textLines.push(formatDivider(width, "="));

    textLines.push(formatLine("Fecha:", formattedDate, width));
    textLines.push(formatLine("Hora:", formattedTime, width));
    textLines.push(formatLine("Entrega:", closure.empleadaEntrega || "N/A", width));
    textLines.push(formatLine("Recibe:", closure.empleadoRecibe || "N/A", width));
    textLines.push(formatDivider(width, "-"));

    textLines.push(formatLine("Base Inicial:", `$${(closure.baseInicial || 0).toLocaleString()}`, width));
    textLines.push(formatLine("(+) Ventas Efec:", `$${(closure.ventasEfectivo || 0).toLocaleString()}`, width));
    textLines.push(formatLine("(+) Ventas Tran:", `$${(closure.ventasTransferencia || 0).toLocaleString()}`, width));
    textLines.push(formatDivider(width, "-"));
    textLines.push(formatLine("Total Ventas:", `$${(closure.totalVentas || 0).toLocaleString()}`, width));
    textLines.push(formatDivider(width, "-"));

    textLines.push(formatLine("(-) Gastos Efec:", `$${(closure.gastosEfectivo || 0).toLocaleString()}`, width));
    textLines.push(formatLine("(-) Gastos Tran:", `$${(closure.gastosTransferencia || 0).toLocaleString()}`, width));
    if (closure.nomina > 0) {
      textLines.push(formatLine("(-) Nomina:", `$${(closure.nomina || 0).toLocaleString()}`, width));
    }
    textLines.push(formatDivider(width, "-"));

    textLines.push(formatLine("Esperado Caja:", `$${(closure.totalEsperadoEfectivo || 0).toLocaleString()}`, width));
    textLines.push(formatLine("Contado Caja:", `$${(closure.dineroFisicoContado || 0).toLocaleString()}`, width));
    
    const diff = closure.diferenciaCaja || 0;
    const diffLabel = diff >= 0 ? "Sobrante:" : "Faltante:";
    textLines.push(formatLine(diffLabel, `$${diff.toLocaleString()}`, width));

    if (closure.observaciones) {
      textLines.push(formatDivider(width, "-"));
      textLines.push(`Obs: ${closure.observaciones}`);
    }

    addClosureTotalReceiptTextLines(textLines, closure, width);

    textLines.push(formatDivider(width, "="));
    textLines.push(formatCenter("Turno cerrado con exito", width));
    textLines.push(formatCenter(settings.hotelName || "Hotel Kodiak", width));
    textLines.push(formatCenter("¡Hasta pronto!", width));
    textLines.push("\n\n\n");

    const plainText = textLines.join("\n");

    const hasHardware = getHasRealHardwareConnection();
    if (settings.printerType === 'browser' || !hasHardware) {
      console.log("IMPRIMIENDO POR NAVEGADOR window.print()");
      const finalPrintWindow = printWindow || getBrowserPrintWindow();
      if (finalPrintWindow) {
        setBrowserPrintWindow(null);
        await printViaBrowserWindow(plainText, finalPrintWindow, KODIAK_THERMAL_PAPER_SIZE);
      } else {
        await printViaBrowser(plainText, KODIAK_THERMAL_PAPER_SIZE);
      }
      return;
    }

    // ESC/POS Command Builder
    const builder = new EscPosBuilder().init();
    builder.alignCenter().doubleSize(true).bold(true).line(settings.hotelName || "HOTEL KODIAK").doubleSize(false).bold(false);
    builder.line("NIT: 901.234.567-8").line("ARQUEO & CIERRE DE TURNO").line(formatDivider(width, "="));

    builder.alignLeft();
    builder.line(formatLine("Fecha:", formattedDate, width));
    builder.line(formatLine("Hora:", formattedTime, width));
    builder.line(formatLine("Entrega:", closure.empleadaEntrega || "N/A", width));
    builder.line(formatLine("Recibe:", closure.empleadoRecibe || "N/A", width));
    builder.line(formatDivider(width, "-"));

    builder.line(formatLine("Base Inicial:", `$${(closure.baseInicial || 0).toLocaleString()}`, width));
    builder.line(formatLine("(+) Ventas Efec:", `$${(closure.ventasEfectivo || 0).toLocaleString()}`, width));
    builder.line(formatLine("(+) Ventas Tran:", `$${(closure.ventasTransferencia || 0).toLocaleString()}`, width));
    builder.line(formatDivider(width, "-"));
    builder.line(formatLine("Total Ventas:", `$${(closure.totalVentas || 0).toLocaleString()}`, width));
    builder.line(formatDivider(width, "-"));

    builder.line(formatLine("(-) Gastos Efec:", `$${(closure.gastosEfectivo || 0).toLocaleString()}`, width));
    builder.line(formatLine("(-) Gastos Tran:", `$${(closure.gastosTransferencia || 0).toLocaleString()}`, width));
    if (closure.nomina > 0) {
      builder.line(formatLine("(-) Nomina:", `$${(closure.nomina || 0).toLocaleString()}`, width));
    }
    builder.line(formatDivider(width, "-"));

    builder.bold(true).line(formatLine("Esperado Caja:", `$${(closure.totalEsperadoEfectivo || 0).toLocaleString()}`, width));
    builder.line(formatLine("Contado Caja:", `$${(closure.dineroFisicoContado || 0).toLocaleString()}`, width));
    builder.line(formatLine(diffLabel, `$${diff.toLocaleString()}`, width)).bold(false);

    if (closure.observaciones) {
      builder.line(formatDivider(width, "-"));
      builder.line(`Obs: ${closure.observaciones}`);
    }

    addClosureTotalReceiptBuilderLines(builder, closure, width);

    builder.line(formatDivider(width, "="));
    builder.alignCenter().line("Turno cerrado con exito").line(settings.hotelName || "Hotel Kodiak");
    builder.cut();

    await sendEscPosCommand(builder.getBuffer());

    await savePrinterLog({
      type: "receipt_printed",
      saleId: closure.id || 'cierre',
      source: 'cierre_turno',
      printerMode: settings.printerType === 'browser' ? 'browser' : (settings.printerType || 'simulacion'),
      employeeName: closure.empleadaEntrega || 'Sistema',
      createdBy: closure.createdBy || 'system',
      success: true,
      error: null
    });
  } catch (error: any) {
    console.error("Fallo durante el flujo de impresión de arqueo:", error);
    await savePrinterError({
      message: `No se pudo imprimir el arqueo de cierre. Detalle: ${error.message || String(error)}`,
      operation: 'Cierre Turno',
      usuario: closure.empleadaEntrega || 'Sistema',
      fecha: new Date().toLocaleDateString(),
      hora: new Date().toLocaleTimeString()
    });

    await savePrinterLog({
      type: "receipt_printed",
      saleId: closure.id || 'cierre',
      source: 'cierre_turno',
      printerMode: settings.printerType === 'browser' ? 'browser' : (settings.printerType || 'simulacion'),
      employeeName: closure.empleadaEntrega || 'Sistema',
      createdBy: closure.createdBy || 'system',
      success: false,
      error: error.message || String(error)
    });
  }
}

// Print Expense (Egreso) Receipt
export async function printExpenseReceipt(expense: any, printWindow?: Window | null): Promise<void> {
  const settings = getSettings();
  const width = KODIAK_RECEIPT_CHAR_WIDTH;

  try {
    const formattedDate = expense.fecha || new Date().toLocaleDateString('es-CO');
    const formattedTime = expense.hora || new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

    const textLines: string[] = [];
    textLines.push(formatCenter(settings.hotelName || "HOTEL KODIAK", width));
    textLines.push(formatCenter("COMPROBANTE DE EGRESO", width));
    textLines.push(formatDivider(width, "="));

    textLines.push(formatLine("Fecha:", formattedDate, width));
    textLines.push(formatLine("Hora:", formattedTime, width));
    textLines.push(formatLine("Turno:", expense.shiftId || expense.turnoId || "N/A", width));
    textLines.push(formatLine("Empleada:", expense.empleada || "N/A", width));
    textLines.push(formatDivider(width, "-"));

    textLines.push(`Concepto: ${expense.concepto || "GASTO GENERAL"}`);
    textLines.push(formatLine("Categoria:", expense.categoria || "Otros", width));
    textLines.push(formatLine("Metodo Pago:", expense.metodoPago || "Efectivo", width));
    textLines.push(formatDivider(width, "-"));

    textLines.push(formatLine("VALOR EGRESO:", `$${(expense.valor || 0).toLocaleString()}`, width));
    textLines.push(formatDivider(width, "-"));

    if (expense.observacion || expense.observaciones) {
      textLines.push(`Obs: ${expense.observacion || expense.observaciones}`);
      textLines.push(formatDivider(width, "-"));
    }

    textLines.push("\nFirma / recibido por:\n\n\n");
    textLines.push("________________________________\n");
    textLines.push(formatCenter("Dinero retirado de caja", width));
    textLines.push("\n\n\n");

    const plainText = textLines.join("\n");

    const hasHardware = getHasRealHardwareConnection();
    if (settings.printerType === 'browser' || !hasHardware) {
      console.log("IMPRIMIENDO EGRESO POR NAVEGADOR window.print()");
      const finalPrintWindow = printWindow || getBrowserPrintWindow();
      if (finalPrintWindow) {
        setBrowserPrintWindow(null);
        await printViaBrowserWindow(plainText, finalPrintWindow, KODIAK_THERMAL_PAPER_SIZE);
      } else {
        await printViaBrowser(plainText, KODIAK_THERMAL_PAPER_SIZE);
      }
      return;
    }

    // ESC/POS Command Builder
    const builder = new EscPosBuilder().init();
    builder.alignCenter().doubleSize(true).bold(true).line(settings.hotelName || "HOTEL KODIAK").doubleSize(false).bold(false);
    builder.line("COMPROBANTE DE EGRESO").line(formatDivider(width, "="));

    builder.alignLeft();
    builder.line(formatLine("Fecha:", formattedDate, width));
    builder.line(formatLine("Hora:", formattedTime, width));
    builder.line(formatLine("Turno:", expense.shiftId || expense.turnoId || "N/A", width));
    builder.line(formatLine("Empleada:", expense.empleada || "N/A", width));
    builder.line(formatDivider(width, "-"));

    builder.line(`Concepto: ${expense.concepto || "GASTO GENERAL"}`);
    builder.line(formatLine("Categoria:", expense.categoria || "Otros", width));
    builder.line(formatLine("Metodo Pago:", expense.metodoPago || "Efectivo", width));
    builder.line(formatDivider(width, "-"));

    builder.bold(true).line(formatLine("VALOR EGRESO:", `$${(expense.valor || 0).toLocaleString()}`, width)).bold(false);
    builder.line(formatDivider(width, "-"));

    if (expense.observacion || expense.observaciones) {
      builder.line(`Obs: ${expense.observacion || expense.observaciones}`);
      builder.line(formatDivider(width, "-"));
    }

    builder.line("\nFirma / recibido por:\n\n\n");
    builder.line("________________________________\n");
    builder.alignCenter().line("Dinero retirado de caja");
    builder.cut();

    await sendEscPosCommand(builder.getBuffer());

    await savePrinterLog({
      type: "receipt_printed",
      saleId: expense.id || 'egreso',
      source: 'egreso_caja',
      printerMode: settings.printerType === 'browser' ? 'browser' : (settings.printerType || 'simulacion'),
      employeeName: expense.empleada || 'Sistema',
      createdBy: expense.createdBy || 'system',
      success: true,
      error: null
    });
  } catch (error: any) {
    console.error("Fallo durante el flujo de impresión de egreso:", error);
    await savePrinterError({
      message: `No se pudo imprimir el comprobante de egreso. Detalle: ${error.message || String(error)}`,
      operation: 'Egreso Caja',
      usuario: expense.empleada || 'Sistema',
      fecha: new Date().toLocaleDateString('es-CO'),
      hora: new Date().toLocaleTimeString('es-CO')
    });

    await savePrinterLog({
      type: "receipt_printed",
      saleId: expense.id || 'egreso',
      source: 'egreso_caja',
      printerMode: settings.printerType === 'browser' ? 'browser' : (settings.printerType || 'simulacion'),
      employeeName: expense.empleada || 'Sistema',
      createdBy: expense.createdBy || 'system',
      success: false,
      error: error.message || String(error)
    });
  }
}

export async function printAndOpenDrawerForShiftCount(
  shift: any,
  salesCash: number,
  expensesCash: number,
  payrollAmount: number,
  expectedCash: number,
  employeeName: string,
  createdBy: string,
  printWindow?: Window | null
): Promise<void> {
  const settings = getSettings();
  const width = KODIAK_RECEIPT_CHAR_WIDTH;

  const now = new Date();
  const formattedDate = now.toLocaleDateString('es-CO');
  const formattedTime = now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

  // 1. Send Cash Drawer Open Command if hardware is real
  const hasHardware = getHasRealHardwareConnection();
  if (settings.printerType !== 'browser' && hasHardware) {
    try {
      const commandHex = settings.cashDrawerCommand || '1B700019FA';
      const commandBytes = hexToBytes(commandHex);
      await sendEscPosCommand(commandBytes);
    } catch (err) {
      console.error("Error abriendo el cajon fisico para conteo:", err);
    }
  }

  // 2. Log audit to hotel_cash_drawer_logs
  try {
    await saveCashDrawerLog({
      type: "cash_drawer_opened",
      source: "shift_close_count",
      reason: "Apertura de caja para conteo físico de cierre",
      shiftId: shift.id || "",
      employeeName,
      createdBy,
      createdAt: now.toISOString(),
      fecha: formattedDate,
      hora: formattedTime
    });
  } catch (err) {
    console.error("Error guardando auditoria de cajon:", err);
  }

  // 3. Print the receipt
  try {
    const textLines: string[] = [];
    textLines.push(formatCenter(settings.hotelName || "HOTEL KODIAK", width));
    textLines.push(formatCenter("APERTURA DE CAJA", width));
    textLines.push(formatCenter("PARA CONTEO", width));
    textLines.push(formatDivider(width, "="));

    textLines.push(formatLine("Fecha:", formattedDate, width));
    textLines.push(formatLine("Hora:", formattedTime, width));
    textLines.push(formatLine("Turno:", shift.id || "N/A", width));
    textLines.push(formatLine("Emp. Entrega:", employeeName || shift.empleada || "N/A", width));
    textLines.push(formatDivider(width, "-"));

    textLines.push(formatLine("Base Inicial:", `$${(shift.baseInicial || 0).toLocaleString()}`, width));
    textLines.push(formatLine("Ventas Efectivo:", `$${(salesCash || 0).toLocaleString()}`, width));
    textLines.push(formatLine("Egresos Efectivo:", `-$${(expensesCash || 0).toLocaleString()}`, width));
    textLines.push(formatLine("Nomina:", `-$${(payrollAmount || 0).toLocaleString()}`, width));
    textLines.push(formatDivider(width, "-"));
    textLines.push(formatLine("Efectivo Esperado:", `$${(expectedCash || 0).toLocaleString()}`, width));
    textLines.push(formatDivider(width, "-"));
    textLines.push("Motivo: Conteo fisico para");
    textLines.push("cierre de turno");
    textLines.push("\n\n\n");

    const plainText = textLines.join("\n");

    if (settings.printerType === 'browser' || !hasHardware) {
      console.log("IMPRIMIENDO COMPROBANTE CONTEO POR NAVEGADOR");
      const finalPrintWindow = printWindow || getBrowserPrintWindow();
      if (finalPrintWindow) {
        setBrowserPrintWindow(null);
        await printViaBrowserWindow(plainText, finalPrintWindow, KODIAK_THERMAL_PAPER_SIZE);
      } else {
        await printViaBrowser(plainText, KODIAK_THERMAL_PAPER_SIZE);
      }
      return;
    }

    // ESC/POS Print Receipt
    const builder = new EscPosBuilder().init();
    builder.alignCenter().doubleSize(true).bold(true).line(settings.hotelName || "HOTEL KODIAK").doubleSize(false).bold(false);
    builder.line("APERTURA DE CAJA PARA CONTEO").line(formatDivider(width, "="));

    builder.alignLeft();
    builder.line(formatLine("Fecha:", formattedDate, width));
    builder.line(formatLine("Hora:", formattedTime, width));
    builder.line(formatLine("Turno:", shift.id || "N/A", width));
    builder.line(formatLine("Emp. Entrega:", employeeName || shift.empleada || "N/A", width));
    builder.line(formatDivider(width, "-"));

    builder.line(formatLine("Base Inicial:", `$${(shift.baseInicial || 0).toLocaleString()}`, width));
    builder.line(formatLine("Ventas Efectivo:", `$${(salesCash || 0).toLocaleString()}`, width));
    builder.line(formatLine("Egresos Efectivo:", `-$${(expensesCash || 0).toLocaleString()}`, width));
    builder.line(formatLine("Nomina:", `-$${(payrollAmount || 0).toLocaleString()}`, width));
    builder.line(formatDivider(width, "-"));
    builder.bold(true).line(formatLine("Efectivo Esperado:", `$${(expectedCash || 0).toLocaleString()}`, width)).bold(false);
    builder.line(formatDivider(width, "-"));
    builder.line("Motivo: Conteo fisico para");
    builder.line("cierre de turno");
    builder.cut();

    await sendEscPosCommand(builder.getBuffer());
  } catch (error: any) {
    console.error("Fallo durante el flujo de impresión de apertura conteo:", error);
  }
}

export async function printAndOpenDrawerForPayrollWithdrawal(data: any, printWindow?: Window | null): Promise<void> {
  const settings = getSettings();
  const width = KODIAK_RECEIPT_CHAR_WIDTH;
  const now = new Date();
  const formattedDate = now.toLocaleDateString('es-CO');
  const formattedTime = now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  const employeeName = data.employeeName || data.shift?.empleada || 'Recepcionista';

  const textLines: string[] = [];
  textLines.push(formatCenter(settings.hotelName || 'HOTEL KODIAK', width));
  textLines.push(formatCenter('RETIRO PAGO DE TURNO', width));
  textLines.push(formatDivider(width, '='));
  textLines.push(formatLine('Fecha:', formattedDate, width));
  textLines.push(formatLine('Hora:', formattedTime, width));
  textLines.push(formatLine('Entrega:', employeeName, width));
  textLines.push(formatLine('Recibe:', data.receivingEmployee || 'N/A', width));
  textLines.push(formatLine('Turno:', String(data.shift?.id || '').slice(-8), width));
  textLines.push(formatDivider(width, '-'));
  textLines.push(formatLine('Pago base:', `${Number(data.payrollBase || 0).toLocaleString('es-CO')}`, width));
  textLines.push(formatLine('Venta prod:', `${Number(data.productSalesTotal || 0).toLocaleString('es-CO')}`, width));
  textLines.push(formatLine('Comision 10%:', `+${Number(data.productCommission || 0).toLocaleString('es-CO')}`, width));
  textLines.push(formatLine('Desc. invent:', `-${Number(data.inventoryDiscount || 0).toLocaleString('es-CO')}`, width));
  textLines.push(formatDivider(width, '-'));
  textLines.push(formatLine('RETIRAR SOLO:', `${Number(data.authorizedPayroll || 0).toLocaleString('es-CO')}`, width));
  textLines.push(formatDivider(width, '='));
  textLines.push('Este recibo autoriza la apertura');
  textLines.push('del cajon y el retiro indicado.');
  textLines.push('Firma empleada: _____________');
  textLines.push('\n\n\n');

  const plainText = textLines.join('\n');
  const hasHardware = getHasRealHardwareConnection();
  if (settings.printerType === 'browser' || !hasHardware) {
    const finalPrintWindow = printWindow || getBrowserPrintWindow();
    if (finalPrintWindow) {
      setBrowserPrintWindow(null);
      await printViaBrowserWindow(plainText, finalPrintWindow, KODIAK_THERMAL_PAPER_SIZE);
    } else {
      await printViaBrowser(plainText, KODIAK_THERMAL_PAPER_SIZE);
    }
  } else {
    const builder = new EscPosBuilder().init();
    plainText.split('\n').forEach((line) => builder.line(line));
    builder.drawer(settings.cashDrawerCommand || '1B700019FA');
    builder.cut();
    await sendEscPosCommand(builder.getBuffer());
  }

  await saveCashDrawerLog({
    type: 'cash_drawer_opened',
    source: 'payroll_withdrawal',
    reason: 'Retiro autorizado de pago de turno',
    shiftId: data.shift?.id || '',
    employeeName,
    authorizedAmount: Number(data.authorizedPayroll || 0),
    payrollBase: Number(data.payrollBase || 0),
    productCommission: Number(data.productCommission || 0),
    inventoryDiscount: Number(data.inventoryDiscount || 0),
    createdBy: data.createdBy || 'system',
    createdAt: now.toISOString(),
    fecha: formattedDate,
    hora: formattedTime
  });
}

export async function printAndOpenDrawerForInitialCashCount(data: any, printWindow?: Window | null): Promise<void> {
  const settings = getSettings();
  const width = KODIAK_RECEIPT_CHAR_WIDTH;
  const now = new Date();
  const formattedDate = now.toLocaleDateString('es-CO');
  const formattedTime = now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  const employeeName = data.employeeName || data.employeeAlias || 'Recepcionista';

  const textLines: string[] = [];
  textLines.push(formatCenter(settings.hotelName || 'HOTEL KODIAK', width));
  textLines.push(formatCenter('APERTURA CAJA INICIAL', width));
  textLines.push(formatDivider(width, '='));
  textLines.push(formatLine('Fecha:', formattedDate, width));
  textLines.push(formatLine('Hora:', formattedTime, width));
  textLines.push(formatLine('Empleada:', employeeName, width));
  textLines.push(formatLine('Base inicial:', `${Number(data.baseInicial || 0).toLocaleString('es-CO')}`, width));
  if (data.observaciones) {
    textLines.push(formatDivider(width, '-'));
    textLines.push('OBS:');
    textLines.push(String(data.observaciones).slice(0, 80));
  }
  textLines.push(formatDivider(width, '='));
  textLines.push('Caja abierta para contar base.');
  textLines.push('Firma empleada: _____________');
  textLines.push('\n\n\n');

  const plainText = textLines.join('\n');
  const hasHardware = getHasRealHardwareConnection();
  if (settings.printerType === 'browser' || !hasHardware) {
    const finalPrintWindow = printWindow || getBrowserPrintWindow();
    if (finalPrintWindow) {
      setBrowserPrintWindow(null);
      await printViaBrowserWindow(plainText, finalPrintWindow, KODIAK_THERMAL_PAPER_SIZE);
    } else {
      await printViaBrowser(plainText, KODIAK_THERMAL_PAPER_SIZE);
    }
  } else {
    const builder = new EscPosBuilder().init();
    plainText.split('\n').forEach((line) => builder.line(line));
    builder.drawer(settings.cashDrawerCommand || '1B700019FA');
    builder.cut();
    await sendEscPosCommand(builder.getBuffer());
  }

  await saveCashDrawerLog({
    type: 'cash_drawer_opened',
    source: 'initial_shift_cash_count',
    reason: 'Conteo inicial de caja para apertura de turno',
    employeeName,
    baseInicial: Number(data.baseInicial || 0),
    createdBy: data.createdBy || 'system',
    createdAt: now.toISOString(),
    fecha: formattedDate,
    hora: formattedTime
  });
}
