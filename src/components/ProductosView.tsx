import React, { useState, useEffect, useMemo } from 'react';
import { Package, Plus, ShoppingCart, ShieldAlert, ArrowDown, ListFilter, Trash2, Edit3, CheckCircle, RefreshCw, X, Printer, FileText, Zap, Sparkles, AlertCircle } from 'lucide-react';
import { Product, Sale, Shift, PaymentMethod, FirebaseUser, getEmployeeFullName, OFFICIAL_KODIAK_PRODUCTS, getCanonicalProductName, matchOfficialProduct, isProductVisible, isProductArchivedOrHidden } from '../types';
import { formatCop, isInvalidValue } from '../utils/storage';
import { AdminPasswordModal } from './AdminPasswordModal';
import { auth } from '../firebase';
import { getPrinterStatus, printReceipt, openCashDrawer as realOpenCashDrawer, getSettings, openBrowserPrintWindow, setBrowserPrintWindow } from '../services/printerService';
import { archiveProductToFirestore } from '../services/firebaseService';
import { PriceRecoveryPanel } from './PriceRecoveryPanel';
function normalizePaymentMethod(method: any): string {
  return String(method || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isCashPayment(method: any): boolean {
  const value = normalizePaymentMethod(method);

  return (
    value === "efectivo" ||
    value === "cash" ||
    value.includes("efectivo de caja")
  );
}

function isTransferPayment(method: any): boolean {
  const value = normalizePaymentMethod(method);

  return (
    value.includes("transferencia") ||
    value.includes("transf") ||
    value.includes("banco") ||
    value.includes("nequi") ||
    value.includes("daviplata")
  );
}

function cleanIntegerInput(value: any): number {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return 0;
  return Number(digits.replace(/^0+/, '') || '0');
}

function formatIntegerInput(value: any): string {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '';
  return String(n);
}

function parseMoneyInput(value: any): number {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return 0;
  return Number(digits);
}

function formatMoneyInput(value: any): string {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '';
  return n.toLocaleString('es-CO');
}

function normalizeKodiakProductText(value: any): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

interface ProductosProps {
  activeShift: Shift;
  products: Product[];
  sales?: Sale[];
  onUpdateProducts: (updated: Product[]) =>
    void | Promise<void | 'synced' | 'pending'>;
  onAddSale: (sale: Sale) => void | Promise<void>;
  userProfile?: FirebaseUser | null;
  hotelSettings?: any;
}

export const ProductosView: React.FC<ProductosProps> = ({
  activeShift,
  products,
  sales = [],
  onUpdateProducts,
  onAddSale,
  userProfile,
  hotelSettings
}) => {
  const safeProducts = useMemo(() => {
    return Array.isArray(products) ? products : [];
  }, [products]);

  // Mostrar una sola ficha por referencia, incluso si una lectura antigua de
  // Firebase envía variantes del nombre (p. ej. JUGO DEL VALLE PET 400 ML).
  // Esto no fusiona existencias ni cambia precios, ventas o documentos remotos.
  const visibleProducts = useMemo(() => {
    const byName = new Map<string, Product>();
    const ms = (p: any) => {
      const values = [p?.lastMovementAt, p?.clientUpdatedAt, p?.updatedAt];
      return Math.max(0, ...values.map((value) => {
        const time = Date.parse(String(value || ''));
        return Number.isFinite(time) ? time : 0;
      }));
    };
    for (const product of safeProducts) {
      if (!isProductVisible(product)) continue;
      const canonical = getCanonicalProductName(product.nombre);
      if (!matchOfficialProduct(canonical)) continue;
      const existing = byName.get(canonical);
      if (!existing || ms(product) > ms(existing)) {
        byName.set(canonical, { ...product, nombre: canonical });
      }
    }
    return [...byName.values()];
  }, [safeProducts]);

  const safeSales = Array.isArray(sales) ? sales : [];

  // Password validation state
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [pendingAdminAction, setPendingAdminAction] = useState<(() => void) | null>(null);

  const requireAdminPassword = (action: () => void) => {
    setPendingAdminAction(() => action);
    setAdminModalOpen(true);
  };

  const confirmAdminPassword = (password: string): boolean => {
    const cleanPassword = String(password || '').trim().toUpperCase();
    if (cleanPassword !== '4321' && cleanPassword !== 'ADMIN4321') {
      return false;
    }
    setAdminModalOpen(false);
    if (typeof pendingAdminAction === 'function') {
      pendingAdminAction();
    }
    setPendingAdminAction(null);
    return true;
  };

  // Local actions state
  const [sellProduct, setSellProduct] = useState<Product | null>(null);
  const [addStockProduct, setAddStockProduct] = useState<Product | null>(null);
  const [selectedHistoryProduct, setSelectedHistoryProduct] = useState<Product | null>(null);
  const [showCreateProduct, setShowCreateProduct] = useState<boolean>(false);

  // Edit Product States
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editNombre, setEditNombre] = useState<string>('');
  const [editCategoria, setEditCategoria] = useState<string>('Bebidas');
  const [editPrecio, setEditPrecio] = useState<number>(2000);
  const [editStock, setEditStock] = useState<number>(10);
  const [editStockMinimo, setEditStockMinimo] = useState<number>(3);
  const [editSaving, setEditSaving] = useState<boolean>(false);

  // Form states
  const [sellCantidad, setSellCantidad] = useState<number>(1);
  const [sellSaving, setSellSaving] = useState<boolean>(false);
  const [sellMetodoPago, setSellMetodoPago] = useState<PaymentMethod>('Efectivo');
  const [sellEfectivoRecibido, setSellEfectivoRecibido] = useState<number>(0);
  const [sellTransferValue, setSellTransferValue] = useState<number>(0);
  const [sellRef, setSellRef] = useState<string>('');

  // Receipt states
  const [showReceipt, setShowReceipt] = useState<boolean>(false);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [receiptAlreadyPrinted, setReceiptAlreadyPrinted] = useState<boolean>(false);

  const handleAutoPrintReceipt = async (data: any) => {
    const detectedPaymentMethod =
      data?.metodoPago ||
      data?.paymentMethod ||
      data?.metodo ||
      '';

    // REGLA HOTEL KODIAK:
    // Solo los pagos en EFECTIVO generan recibo automático, impresión y apertura de cajón.
    // Las TRANSFERENCIAS solo se guardan. No recibo, no impresión, no cajón.
    if (!isCashPayment(detectedPaymentMethod)) {
      console.log("Auto-impresión cancelada: el pago no es en efectivo.", detectedPaymentMethod);
      return;
    }

    if (hotelSettings && hotelSettings.autoPrintEnabled === false) {
      console.log("Impresión automática desactivada en configuración.");
      return;
    }

    try {
      console.log("AUTO IMPRIMIENDO RECIBO SOLO EFECTIVO", data);

      const status = getPrinterStatus();
      const isRealHardware = status.connected && status.type === 'escpos';

      // Normalize product receipt fields into standard format
      const normalizedReceipt = data.conceptos ? data : {
        id: data.id || '',
        fecha: data.fecha,
        hora: data.hora,
        employeeName: data.empleada || 'Sistema',
        turno: data.turno || 'N/A',
        cliente: 'Cliente General',
        habitacion: '',
        metodoPago: detectedPaymentMethod || 'Efectivo',
        total: data.total,
        pagadoWith: data.recibido || 0,
        cambio: data.cambio || 0,
        tipo: 'Venta Producto',
        conceptos: [
          {
            descripcion: data.producto,
            cantidad: data.cantidad,
            total: data.total
          }
        ]
      };

      if (isRealHardware) {
        await printReceipt(normalizedReceipt);
      } else {
        // Modo web / preview: solo efectivo llega aquí
        window.print();
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

  // Synchronize default amounts based on subtotal
  useEffect(() => {
    if (sellProduct) {
      const subtotal = sellProduct.precio * sellCantidad;
      setSellEfectivoRecibido(subtotal);
      setSellTransferValue(subtotal);
    } else {
      setSellEfectivoRecibido(0);
      setSellTransferValue(0);
    }
  }, [sellProduct, sellCantidad]);

  const [addStockQty, setAddStockQty] = useState<number>(10);

  // Create Product States
  const [newNombre, setNewNombre] = useState<string>('');
  const [newCategoria, setNewCategoria] = useState<string>('Bebidas');
  const [newPrecio, setNewPrecio] = useState<number>(2000);
  const [newStock, setNewStock] = useState<number>(10);
  const [newStockMinimo, setNewStockMinimo] = useState<number>(3);

  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');

  const getProductMovements = (product: Product | null) => {
    if (!product) return [];
    return safeSales
      .filter((sale: any) => {
        const saleProductId = sale.productoId || sale.productId;
        const saleProductName = String(sale.productoNombre || sale.productName || '').toLowerCase();
        return saleProductId === product.id || saleProductName === String(product.nombre || '').toLowerCase();
      })
      .map((sale: any) => {
        let quantityChange = 0;
        let movementLabel = sale.tipoMovimiento || sale.inventoryMovementType || sale.type || 'venta';

        if (sale.type === 'stock_add' || sale.tipoMovimiento === 'abastecimiento_inventario') {
          quantityChange = Number(sale.cantidadAgregada || sale.quantityChange || 0);
          movementLabel = 'Entrada de mercancía';
        } else if (sale.tipoMovimiento === 'creacion_producto') {
          quantityChange = Number(sale.stockNuevo || sale.quantityChange || 0);
          movementLabel = 'Creación de producto';
        } else if (sale.tipoMovimiento === 'ajuste_inventario') {
          quantityChange = Number(sale.quantityChange || 0);
          movementLabel = 'Ajuste / modificación';
        } else if (sale.tipoVenta === 'producto') {
          quantityChange = -Math.abs(Number(sale.cantidad || 0));
          movementLabel = 'Venta';
        }

        return {
          id: sale.id,
          fecha: sale.fecha,
          hora: sale.hora,
          createdAt: sale.createdAt,
          movimiento: movementLabel,
          concepto: sale.concepto || sale.concept || '',
          cantidad: quantityChange,
          stockAnterior: sale.stockAnterior,
          stockNuevo: sale.stockNuevo,
          empleado: sale.empleada || sale.employeeName || 'Sistema',
          total: Number(sale.total || 0)
        };
      })
      .sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  };


  // Handle Edit product save
  const handleConfirmEditProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!editingProduct || editSaving) return;

    if (isInvalidValue(editNombre)) {
      setErrorMsg('El nombre de producto es requerido.');
      return;
    }

    if (editPrecio <= 0 || editStock < 0 || editStockMinimo < 0) {
      setErrorMsg('Valores numéricos no pueden ser negativos.');
      return;
    }

    const now = new Date();
    let status: 'Disponible' | 'Bajo stock' | 'Agotado' = 'Disponible';
    if (editStock <= 0) status = 'Agotado';
    else if (editStock <= editStockMinimo) status = 'Bajo stock';

    const finalNombre = getCanonicalProductName(editNombre);
    if (!matchOfficialProduct(finalNombre)) {
      setErrorMsg('Este nombre no figura entre los 27 productos del inventario.');
      return;
    }
    if (safeProducts.some((p) => p.id !== editingProduct.id &&
      getCanonicalProductName(p.nombre) === finalNombre && !isProductArchivedOrHidden(p))) {
      setErrorMsg('Ya existe un producto con ese nombre o alias.');
      return;
    }

    const updated = safeProducts.map((p) => {
      if (p.id === editingProduct.id) {
        return {
          ...p,
          nombre: finalNombre,
          categoria: editCategoria,
          precio: editPrecio,
          stock: editStock,
          stockMinimo: editStockMinimo,
          estado: status,
          updatedAt: now.toISOString()
        };
      }
      return p;
    });

    // Esperar realmente a que App guarde el cambio antes de cerrar el modal.
    // La versión anterior cerraba el modal y mostraba “éxito” aunque Firebase todavía
    // no hubiese terminado (o incluso aunque el snapshot remoto revirtiera el cambio).
    setEditSaving(true);
    let result: void | 'synced' | 'pending';
    try {
      result = await Promise.resolve(onUpdateProducts(updated));
    } catch (error: any) {
      console.error('[ProductosView] No se pudo guardar la modificación del producto:', error);
      setErrorMsg(error?.message || 'No fue posible guardar el producto. Revise la conexión e intente nuevamente.');
      setEditSaving(false);
      return;
    }

    if (editingProduct.stock !== editStock || editingProduct.precio !== editPrecio || editingProduct.stockMinimo !== editStockMinimo || editingProduct.nombre !== finalNombre || editingProduct.categoria !== editCategoria) {
      const auditMovement: Sale = {
        id: `mov-prod-edit-${now.getTime()}`,
        shiftId: activeShift?.id || '',
        fecha: now.toLocaleDateString('es-CO'),
        hora: now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true }),
        createdAt: now.toISOString(),
        empleada: activeShift?.empleada || userProfile?.nombre || 'Sistema',
        tipoVenta: 'producto' as any,
        concepto: `Ajuste inventario/precio: ${finalNombre}`,
        total: 0,
        metodoPago: 'N/A',
        type: 'stock_adjust',
        tipoMovimiento: 'ajuste_inventario',
        productId: editingProduct.id,
        productName: finalNombre,
        stockAnterior: editingProduct.stock,
        stockNuevo: editStock,
        quantityChange: editStock - editingProduct.stock,
        precioAnterior: editingProduct.precio,
        precioNuevo: editPrecio,
        motivoInventario: 'Modificación administrativa de producto',
        employeeName: activeShift?.empleada || userProfile?.nombre || 'Sistema',
        createdBy: auth?.currentUser?.uid || userProfile?.uid || ''
      } as any;
      Promise.resolve(onAddSale(auditMovement)).catch((error) => {
        console.warn('[ProductosView] No se pudo sincronizar el registro de auditoría:', error);
      });
    }

    setEditSaving(false);
    setEditingProduct(null);
    setSuccessMsg(result === 'pending'
      ? 'Cambio guardado en este equipo. Pendiente de confirmar en Firebase.'
      : 'Producto modificado y confirmado.');
    setTimeout(() => setSuccessMsg(''), 8000);
  };

  // Function to open the cash drawer
  const openCashDrawer = async (saleId: string = '', amount: number = 0, paymentMethod: string = 'Efectivo') => {
    // Seguridad: el cajón solo se abre cuando entra dinero físico a caja.
    if (!isCashPayment(paymentMethod)) {
      console.log("No se abre cajón: el método de pago no es efectivo.", paymentMethod);
      return;
    }

    try {
      console.log("Abriendo caja registradora solo por pago en efectivo...");
      await realOpenCashDrawer(
        'product_sell',
        saleId,
        amount,
        paymentMethod,
        activeShift?.empleada || 'Sistema',
        userProfile?.uid || 'system'
      );
      window.dispatchEvent(new Event("cash_drawer_opened"));
    } catch (error) {
      console.error("Error al abrir caja:", error);
      alert("No se pudo abrir la caja automáticamente. Revise la conexión de la impresora/cajón.");
    }
  };

  // Handle direct sell
  const handleConfirmSell = async () => {
    if (sellSaving) return;
    setErrorMsg('');
    if (!sellProduct) return;

    if (!sellProduct.precio || sellProduct.precio <= 0) {
      setErrorMsg('Este producto tiene "Precio pendiente". Por favor modifique el producto y asigne un precio antes de venderlo.');
      return;
    }

    if (sellCantidad <= 0 || isNaN(sellCantidad)) {
      setErrorMsg('La cantidad a vender debe ser mayor a 0.');
      return;
    }

    if (sellCantidad > sellProduct.stock) {
      setErrorMsg(`No hay suficiente inventario en stock (${sellProduct.stock} disponibles).`);
      return;
    }

    const subtotal = sellProduct.precio * sellCantidad;

    if (sellMetodoPago === 'Efectivo') {
      if (sellEfectivoRecibido < subtotal) {
        setErrorMsg('El dinero recibido no alcanza para cubrir el total.');
        return;
      }
    } else {
      if (sellTransferValue < subtotal) {
        setErrorMsg('El dinero transferido no alcanza para cubrir el total.');
        return;
      }
      if (isInvalidValue(sellRef)) {
        setErrorMsg('Debe registrar la referencia de la transferencia.');
        return;
      }
    }

    // Pre-open print window ONLY for cash payments.
    // Transfers must never open receipt windows, print dialogs, or cash drawers.
    const shouldPrintReceipt = isCashPayment(sellMetodoPago);
    const settings = getSettings();
    if (shouldPrintReceipt && settings.printerType === 'browser' && settings.autoPrintEnabled) {
      if (hotelSettings?.printOnSale ?? true) {
        const win = openBrowserPrintWindow();
        setBrowserPrintWindow(win);
      }
    }

    const now = new Date();

    // La venta y el descuento de stock se confirman juntos en App/Firebase.
    // No actualizamos el inventario local antes del guardado remoto.

    // 2. Registrar en hotel_sales
    const newSale: Sale = {
      id: `sale-prod-${now.getTime()}`,
      shiftId: activeShift.id,
      fecha: now.toLocaleDateString('es-CO'),
      hora: now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true }),
      createdAt: now.toISOString(),
      empleada: activeShift.empleada,
      tipoVenta: 'producto',
      concepto: `Venta Directa: ${sellProduct.nombre} (x${sellCantidad})`,
      total: subtotal,
      metodoPago: sellMetodoPago,
      efectivoRecibido: sellMetodoPago === 'Efectivo' ? sellEfectivoRecibido : undefined,
      cambioEntregado: sellMetodoPago === 'Efectivo' ? (sellEfectivoRecibido - subtotal) : undefined,
      valorTransferido: sellMetodoPago === 'Transferencia' ? sellTransferValue : undefined,
      referenciaTransferencia: sellMetodoPago === 'Transferencia' ? sellRef : undefined,
      productoId: sellProduct.id,
      productoFirestoreId: String((sellProduct as any).firestoreId || (sellProduct as any).documentId || (sellProduct as any).docId || sellProduct.id),
      productoNombre: sellProduct.nombre,
      cantidad: sellCantidad
    };
    setSellSaving(true);
    try {
      await Promise.resolve(onAddSale(newSale));
    } catch (error: any) {
      // Se conserva la pantalla para reintentar: no se descuenta stock ni se
      // muestra recibo o mensaje de éxito cuando Firestore rechaza la venta.
      console.error('[ProductosView] Venta sin registrar:', error);
      setErrorMsg(error?.message || 'No se pudo registrar la venta. Intente de nuevo.');
      return;
    } finally {
      setSellSaving(false);
    }

    // 3. Si es efectivo, abrir caja registradora de forma independiente.
    // En transferencia NO se abre cajón.
    if (shouldPrintReceipt) {
      openCashDrawer(newSale.id, subtotal, sellMetodoPago);
    } else if (isTransferPayment(sellMetodoPago)) {
      console.log("Transferencia registrada: no se abre cajón.");
    }

    // 4. Preparar datos para el recibo de venta
    const newReceiptData = {
      hotel: 'SISTEMA POS HOTEL KODIAK',
      nit: '901429000',
      fecha: now.toLocaleDateString('es-CO'),
      hora: now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true }),
      empleada: getEmployeeFullName(activeShift.empleada),
      turno: activeShift.id,
      producto: sellProduct.nombre,
      cantidad: sellCantidad,
      precioUnitario: sellProduct.precio,
      total: subtotal,
      metodoPago: sellMetodoPago,
      recibido: sellMetodoPago === 'Efectivo' ? sellEfectivoRecibido : 0,
      cambio: sellMetodoPago === 'Efectivo' ? (sellEfectivoRecibido - subtotal) : 0,
      valorTransferido: sellMetodoPago === 'Transferencia' ? sellTransferValue : 0,
      referencia: sellMetodoPago === 'Transferencia' ? sellRef : '',
    };

    // Close direct sell form and clear fields
    setSellProduct(null);
    setSellCantidad(1);
    setSellEfectivoRecibido(0);
    setSellTransferValue(0);
    setSellRef('');

    // 5. Recibo:
    // EFECTIVO: muestra recibo e imprime.
    // TRANSFERENCIA: NO muestra recibo, NO imprime y NO bloquea el sistema.
    if (shouldPrintReceipt) {
      setReceiptData(newReceiptData);
      setShowReceipt(true);
      setSuccessMsg('Venta en efectivo registrada con éxito.');
    } else {
      setReceiptData(null);
      setShowReceipt(false);
      console.log("Venta por transferencia guardada correctamente sin recibo ni impresión.");
      setSuccessMsg('Transferencia registrada correctamente. No se imprimió recibo ni se abrió cajón.');
    }

    setTimeout(() => setSuccessMsg(''), 4000);
  };

  // Add stock to an existing product
  const handleConfirmAddStock = () => {
    if (!addStockProduct) return;

    if (userProfile?.rol === 'visor') {
      alert('Su rol de visor/propietario no tiene permiso para abastecer inventario.');
      return;
    }

    if (addStockQty <= 0 || isNaN(addStockQty)) {
      setErrorMsg('La cantidad a ingresar debe ser mayor a 0.');
      return;
    }

    const now = new Date();
    const finalStock = addStockProduct.stock + addStockQty;
    let status: 'Disponible' | 'Bajo stock' | 'Agotado' = 'Disponible';
    if (finalStock <= 0) status = 'Agotado';
    else if (finalStock <= addStockProduct.stockMinimo) status = 'Bajo stock';

    const updated = safeProducts.map((p) => {
      if (p.id === addStockProduct.id) {
        return {
          ...p,
          stock: finalStock,
          estado: status,
          lastMovementAt: now.toISOString(),
          lastMovementType: 'entrada' as any,
          lastMovementBy: activeShift?.empleada || userProfile?.nombre || 'Sistema',
          updatedAt: now.toISOString()
        };
      }
      return p;
    });

    // 1. Update products list (syncs to Firestore & other nodes)
    onUpdateProducts(updated);

    // 2. Audit movement recording
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const yyyymmdd = `${year}-${month}-${day}`;
    const formattedHora = now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true });

    const auditMovement: Sale = {
      id: `mov-prod-${now.getTime()}`,
      shiftId: activeShift?.id || '',
      fecha: yyyymmdd,
      hora: formattedHora,
      createdAt: now.toISOString(),
      empleada: activeShift?.empleada || userProfile?.nombre || 'Sistema',
      tipoVenta: 'inventario' as any,
      concepto: `Abastecimiento: ${addStockProduct.nombre} (+${addStockQty})`,
      total: 0,
      metodoPago: 'N/A',
      type: "stock_add",
      tipoMovimiento: "abastecimiento_inventario",
      productId: addStockProduct.id,
      productName: addStockProduct.nombre,
      productoId: addStockProduct.id,
      productoNombre: addStockProduct.nombre,
      cantidadAgregada: addStockQty,
      quantityChange: addStockQty,
      inventoryMovementType: 'entrada' as any,
      stockAnterior: addStockProduct.stock,
      stockNuevo: finalStock,
      stockActual: finalStock,
      updatedAt: now.toISOString(),
      motivoInventario: 'Entrada de mercancía / abastecimiento',
      employeeName: activeShift?.empleada || userProfile?.nombre || 'Sistema',
      createdBy: auth?.currentUser?.uid || userProfile?.uid || ""
    };

    onAddSale(auditMovement);

    setAddStockProduct(null);
    setSuccessMsg('Stock actualizado correctamente.');
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  // Create brand new product
  const handleCreateProduct = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (isInvalidValue(newNombre)) {
      setErrorMsg('El nombre de producto es requerido.');
      return;
    }

    const nameCanonical = getCanonicalProductName(newNombre);
    const target = matchOfficialProduct(nameCanonical);
    if (!target) {
      setErrorMsg('El catálogo solo admite los 27 productos del inventario del 31/10/2026.');
      return;
    }
    const existing = safeProducts.find((p) =>
      getCanonicalProductName(p.nombre) === nameCanonical && !isProductArchivedOrHidden(p)
    );
    if (existing) {
      setErrorMsg('Este producto ya está registrado, incluso si escribió otro alias.');
      return;
    }

    if (newPrecio <= 0 || newStock < 0 || newStockMinimo < 0) {
      setErrorMsg('Valores numéricos no pueden ser negativos.');
      return;
    }

    const now = new Date();
    let status: 'Disponible' | 'Bajo stock' | 'Agotado' = 'Disponible';
    if (newStock <= 0) status = 'Agotado';
    else if (newStock <= newStockMinimo) status = 'Bajo stock';

    const newProd: Product = {
      id: target.id,
      nombre: target.nombre,
      categoria: newCategoria,
      precio: newPrecio,
      stock: newStock,
      stockMinimo: newStockMinimo,
      estado: status,
      activo: true,
      lastMovementAt: now.toISOString(),
      lastMovementType: 'creacion' as any,
      lastMovementBy: activeShift?.empleada || userProfile?.nombre || 'Sistema',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    onUpdateProducts([...safeProducts, newProd]);

    const auditMovement: Sale = {
      id: `mov-prod-create-${now.getTime()}`,
      shiftId: activeShift?.id || '',
      fecha: now.toLocaleDateString('es-CO'),
      hora: now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true }),
      createdAt: now.toISOString(),
      empleada: activeShift?.empleada || userProfile?.nombre || 'Sistema',
      tipoVenta: 'producto' as any,
      concepto: `Creación producto: ${newProd.nombre}`,
      total: 0,
      metodoPago: 'N/A',
      type: 'stock_create',
      tipoMovimiento: 'creacion_producto',
      productId: newProd.id,
      productName: newProd.nombre,
      stockAnterior: 0,
      stockNuevo: newProd.stock,
      quantityChange: newProd.stock,
      precioNuevo: newProd.precio,
      motivoInventario: 'Creación inicial en catálogo',
      employeeName: activeShift?.empleada || userProfile?.nombre || 'Sistema',
      createdBy: auth?.currentUser?.uid || userProfile?.uid || ''
    } as any;
    onAddSale(auditMovement);

    setShowCreateProduct(false);

    // Reset fields
    setNewNombre('');
    setNewPrecio(2000);
    setNewStock(10);
    setNewStockMinimo(3);
    setSuccessMsg('Producto registrado correctamente.');
    setTimeout(() => setSuccessMsg(''), 4000);
  };


  const handleArchiveProduct = async (p: Product) => {
    setErrorMsg('');

    const confirmDelete = window.confirm(
      `¿Ocultar/desactivar el producto "${p.nombre}" del inventario?\n\n` +
      `No se borrará el historial de ventas ni cierres. El producto desaparecerá de la pantalla, ventas y conteo de cierre.`
    );

    if (!confirmDelete) return;

    const now = new Date();
    const nowIso = now.toISOString();
    const targetName = normalizeKodiakProductText(p?.nombre || '');

    console.log("[ProductosView] Archivar/Ocultar producto:", p.id, p.nombre);

    const makeArchivedProduct = (item: any) => ({
      ...item,
      activo: false,
      archivado: true,
      oculto: true,
      visible: false,
      eliminado: true,
      deleted: true,
      isDeleted: true,
      estado: 'Archivado',
      status: 'archived',
      lastMovementAt: nowIso,
      lastMovementType: 'desactivacion',
      lastMovementBy: activeShift?.empleada || userProfile?.nombre || auth?.currentUser?.email || 'Sistema',
      desactivadoAt: nowIso,
      deletedAt: nowIso,
      desactivadoPor: userProfile?.email || userProfile?.nombre || auth?.currentUser?.email || 'admin',
      motivoDesactivacion: 'Producto ocultado/desactivado desde inventario por administrador',
      updatedAt: nowIso,
      clientUpdatedAt: nowIso
    });

    const archivedProduct = makeArchivedProduct(p);

    // 2) Actualizar la lista padre por ID y por nombre para cubrir duplicados.
    const updated = safeProducts.map((item: any) => {
      const itemName = normalizeKodiakProductText(item?.nombre || '');
      const sameId = String(item?.id || '') === String(p?.id || '');
      const sameName = targetName && itemName === targetName;
      return sameId || sameName ? makeArchivedProduct(item) : item;
    });

    onUpdateProducts(updated);

    // 3) Guardar directo en Firebase/cache. Si falla, la pantalla igual ya queda limpia.
    try {
      await archiveProductToFirestore(archivedProduct, userProfile || activeShift);
    } catch (err) {
      console.error('No se pudo archivar producto en Firebase/cache:', err);
      setErrorMsg('Se ocultó en pantalla, pero Firebase no confirmó el cambio. Revise permisos/conexión.');
    }

    // 4) Movimiento de auditoría, sin imprimir ni abrir caja.
    const auditMovement: Sale = {
      id: `mov-prod-disable-${now.getTime()}`,
      shiftId: activeShift?.id || '',
      fecha: now.toLocaleDateString('es-CO'),
      hora: now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true }),
      createdAt: nowIso,
      empleada: activeShift?.empleada || userProfile?.nombre || 'Sistema',
      tipoVenta: 'inventario' as any,
      concepto: `Desactivación producto: ${p.nombre}`,
      total: 0,
      metodoPago: 'N/A',
      type: 'stock_disable',
      tipoMovimiento: 'desactivacion_producto',
      productId: p.id,
      productName: p.nombre,
      productoId: p.id,
      productoNombre: p.nombre,
      stockAnterior: p.stock,
      stockNuevo: p.stock,
      quantityChange: 0,
      motivoInventario: 'Producto desactivado sin borrar historial',
      employeeName: activeShift?.empleada || userProfile?.nombre || 'Sistema',
      createdBy: auth?.currentUser?.uid || userProfile?.uid || ''
    } as any;

    onAddSale(auditMovement);

    setSuccessMsg(`Producto "${p.nombre}" ocultado/desactivado. No se borró el historial.`);
    setTimeout(() => setSuccessMsg(''), 4000);
  };


  return (
    <div className="space-y-6">
      
      {/* Top action header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-900 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Package className="h-5 w-5 text-emerald-400" />
              <span>Productos & Control de Inventario</span>
            </h2>
            <span className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold rounded-md">
              {visibleProducts.length} Activos
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">Control de inventario en tiempo real sincronizado con Firebase.</p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => {
              setErrorMsg('');
              if (userProfile?.rol === 'admin') {
                setShowCreateProduct(true);
              } else {
                requireAdminPassword(() => {
                  setShowCreateProduct(true);
                });
              }
            }}
            className="py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 active:scale-[0.98] transition-all"
          >
            <Plus className="h-4 w-4" />
            <span>Crear Nuevo</span>
          </button>
        </div>
      </div>

      {successMsg && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 p-3.5 rounded-xl text-xs font-medium">
          ✅ {successMsg}
        </div>
      )}

      {/* Grid of stock cards */}
      {userProfile?.rol === 'admin' && <PriceRecoveryPanel />}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visibleProducts.map((p) => {
          const isLow = p.stock <= p.stockMinimo;
          const isOut = p.stock === 0;

          return (
            <div
              key={p.id}
              className={`p-4 bg-slate-900/60 border rounded-2xl flex flex-col justify-between space-y-4 ${
                isOut
                  ? 'border-red-500/20 bg-red-950/5'
                  : isLow
                  ? 'border-amber-500/20 bg-amber-950/5'
                  : 'border-slate-800'
              }`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">{p.categoria}</span>
                  <h3 className="text-sm font-bold text-slate-100 tracking-tight leading-snug">{p.nombre}</h3>
                  {p.precio > 0 ? (
                    <p className="text-sm font-bold text-emerald-400 mt-1">{formatCop(p.precio)}</p>
                  ) : (
                    <span className="inline-block mt-1 px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[10px] font-semibold rounded">
                      Precio pendiente
                    </span>
                  )}

                  {/* Administrative Actions: Edit and Delete */}
                  <div className="flex items-center gap-1.5 mt-2.5">
                    <button
                      type="button"
                      title="Ver historial / kardex"
                      onClick={() => setSelectedHistoryProduct(p)}
                      className="p-1.5 bg-slate-950/60 border border-slate-850 hover:border-emerald-500/30 text-emerald-400 hover:text-emerald-300 rounded-lg transition-all"
                    >
                      <FileText className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Modificar producto"
                      onClick={() => {
                        setErrorMsg('');
                        requireAdminPassword(() => {
                          setEditingProduct(p);
                          setEditNombre(p.nombre);
                          const rawCategory = String(p.categoria || 'Bebidas').trim().toLowerCase();
                          setEditCategoria(
                            rawCategory === 'snacks' ? 'Snacks' :
                            rawCategory === 'aseo' || rawCategory.includes('cuidado') ? 'Aseo' :
                            rawCategory === 'licores' ? 'Licores' :
                            rawCategory === 'otros' ? 'Otros' :
                            'Bebidas'
                          );
                          setEditPrecio(p.precio);
                          setEditStock(p.stock);
                          setEditStockMinimo(p.stockMinimo);
                        });
                      }}
                      className="p-1.5 bg-slate-950/60 border border-slate-850 hover:border-indigo-500/30 text-indigo-400 hover:text-indigo-300 rounded-lg transition-all"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Desactivar / ocultar producto"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setErrorMsg('');
                        requireAdminPassword(() => {
                          void handleArchiveProduct(p);
                        });
                      }}
                      className="p-1.5 bg-slate-950/60 border border-slate-850 hover:border-red-500/30 text-red-400 hover:text-red-300 rounded-lg transition-all"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="text-right">
                  <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full inline-block ${
                    isOut
                      ? 'bg-red-500/20 text-red-300'
                      : isLow
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-emerald-500/20 text-emerald-300'
                  }`}>
                    {p.estado}
                  </span>
                  
                  {/* Stock counter */}
                  <div className="mt-2">
                    <span className="text-[10px] text-slate-500 block leading-none">Existencias</span>
                    <strong className="text-base font-extrabold text-white">{p.stock}</strong>
                    <span className="text-[9px] text-slate-500 block">Min. {p.stockMinimo}</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/60">
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg('');
                    if (userProfile?.rol === 'visor') {
                      alert('Su rol de visor/propietario no tiene permiso para abastecer inventario.');
                      return;
                    }
                    setAddStockProduct(p);
                    setAddStockQty(10);
                  }}
                  className="py-1.5 px-3 border border-slate-800 hover:border-slate-700 bg-slate-950 hover:bg-slate-900 rounded-xl text-[10px] font-semibold text-slate-300 transition-colors"
                >
                  Abastecer (+ Stock)
                </button>
                <button
                  type="button"
                  disabled={isOut}
                  onClick={() => {
                    setErrorMsg('');
                    setSellProduct(p);
                    setSellCantidad(1);
                  }}
                  className={`py-1.5 px-3 rounded-xl text-[10px] font-semibold flex items-center justify-center gap-1 transition-colors ${
                    isOut
                      ? 'bg-slate-950 text-slate-600 border border-slate-900 cursor-not-allowed'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm'
                  }`}
                >
                  <ShoppingCart className="h-3 w-3" />
                  <span>Vender</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal: Sell Inventory product */}
      {sellProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-start border-b border-slate-800 pb-3">
              <div>
                <span className="text-[10px] text-slate-500 uppercase font-bold">Venta Rápida</span>
                <h3 className="text-base font-bold text-white">{sellProduct.nombre}</h3>
              </div>
              <button onClick={() => setSellProduct(null)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-xs text-slate-400">Stock Actual</span>
                  <p className="text-sm font-bold text-white">{sellProduct.stock} unidades</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-slate-400">Precio Unitario</span>
                  <p className="text-sm font-bold text-emerald-400">{formatCop(sellProduct.precio)}</p>
                </div>
              </div>

              {/* Qty field */}
              <div className="space-y-1">
                <label className="text-xs text-slate-300 font-semibold block">Cantidad a Vender</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={sellCantidad > 0 ? String(sellCantidad) : ''}
                  onChange={(e) => {
                    const qty = cleanIntegerInput(e.target.value);
                    setSellCantidad(qty);
                  }}
                  placeholder="Ej. 1"
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2 text-sm text-white"
                />
              </div>

              {/* Total estimation */}
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-850 flex justify-between items-center text-xs">
                <span className="text-slate-400">Total a pagar:</span>
                <strong className="text-sm font-bold text-emerald-400">{formatCop(sellProduct.precio * sellCantidad)}</strong>
              </div>

              {/* Payment selection */}
              <div className="space-y-2">
                <label className="text-xs text-slate-300 font-semibold block">Método de Pago</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSellMetodoPago('Efectivo')}
                    className={`flex-1 py-1.5 rounded-lg border text-xs font-bold ${
                      sellMetodoPago === 'Efectivo' ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400' : 'bg-slate-950 border-slate-850 text-slate-400'
                    }`}
                  >
                    Efectivo
                  </button>
                  <button
                    type="button"
                    onClick={() => setSellMetodoPago('Transferencia')}
                    className={`flex-1 py-1.5 rounded-lg border text-xs font-bold ${
                      sellMetodoPago === 'Transferencia' ? 'bg-indigo-500/10 border-indigo-500 text-indigo-400' : 'bg-slate-950 border-slate-850 text-slate-400'
                    }`}
                  >
                    Transferencia
                  </button>
                </div>

                {sellMetodoPago === 'Efectivo' ? (
                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400">Efectivo Recibido</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatMoneyInput(sellEfectivoRecibido)}
                      onChange={(e) => setSellEfectivoRecibido(parseMoneyInput(e.target.value))}
                      placeholder="Ej. 80.000"
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white font-mono"
                    />
                    {sellEfectivoRecibido >= sellProduct.precio * sellCantidad && (
                      <span className="text-[10px] text-emerald-400 block mt-1">Vueltos: {formatCop(sellEfectivoRecibido - (sellProduct.precio * sellCantidad))}</span>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-400">Valor Transferido (COP) *</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={formatMoneyInput(sellTransferValue)}
                        onChange={(e) => setSellTransferValue(parseMoneyInput(e.target.value))}
                        placeholder="Ej. 80.000"
                        className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-400">Referencia Transferencia *</label>
                      <input
                        type="text"
                        value={sellRef}
                        onChange={(e) => setSellRef(e.target.value)}
                        placeholder="Ej. Código Nequi"
                        className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
                      />
                    </div>
                  </div>
                )}
              </div>

              {errorMsg && (
                <div className="text-xs bg-red-500/10 border border-red-500/20 text-red-200 p-2.5 rounded-xl">
                  ⚠️ {errorMsg}
                </div>
              )}

              <button
                type="button"
                onClick={handleConfirmSell}
                disabled={sellSaving}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-wait text-white rounded-xl text-xs font-bold transition-colors"
              >
                {sellSaving ? 'GUARDANDO VENTA E INVENTARIO...' : 'REGISTRAR VENTA DIRECTA'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Abastecer stock */}
      {addStockProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-start border-b border-slate-800 pb-3">
              <div>
                <span className="text-[10px] text-slate-500 uppercase font-bold">Abastecer Inventario</span>
                <h3 className="text-base font-bold text-white">{addStockProduct.nombre}</h3>
              </div>
              <button onClick={() => setAddStockProduct(null)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-xs text-slate-400">Ingrese la cantidad de unidades que ingresaron físicamente a stock hoy.</p>
              
              <div className="space-y-1">
                <label className="text-xs text-slate-300 font-semibold block">Cantidad de Unidades Nuevas</label>
                <input
                  type="number"
                  value={addStockQty}
                  onChange={(e) => setAddStockQty(parseInt(e.target.value) || 0)}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2 text-sm text-white"
                  min={1}
                />
              </div>

              <button
                type="button"
                onClick={handleConfirmAddStock}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-colors"
              >
                INGRESAR STOCK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create product */}
      {showCreateProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <form onSubmit={handleCreateProduct} className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-start border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">CREAR NUEVO PRODUCTO</h3>
                <p className="text-[10px] text-slate-400">Complete los datos para agregar al catálogo.</p>
              </div>
              <button type="button" onClick={() => setShowCreateProduct(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs text-slate-300 font-semibold block">Nombre del Producto *</label>
                <input
                  type="text"
                  value={newNombre}
                  onChange={(e) => setNewNombre(e.target.value)}
                  placeholder="Ej. AGUA CRISTAL"
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white placeholder-slate-700"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-300 font-semibold block">Categoría</label>
                <select
                  value={newCategoria}
                  onChange={(e) => setNewCategoria(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
                >
                  <option value="Bebidas">Bebidas</option>
                  <option value="Snacks">Snacks</option>
                  <option value="Aseo">Aseo / Cuidado Personal</option>
                  <option value="Licores">Licores</option>
                  <option value="Otros">Otros</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-300 font-semibold block">Precio Venta (COP)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatMoneyInput(newPrecio)}
                    onChange={(e) => setNewPrecio(parseMoneyInput(e.target.value))}
                    placeholder="Ej. 4.000"
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-300 font-semibold block">Stock Inicial</label>
                  <input
                    type="number"
                    value={newStock}
                    onChange={(e) => setNewStock(parseInt(e.target.value) || 0)}
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-300 font-semibold block">Stock Mínimo Alerta</label>
                <input
                  type="number"
                  value={newStockMinimo}
                  onChange={(e) => setNewStockMinimo(parseInt(e.target.value) || 0)}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white font-mono"
                />
              </div>

              {errorMsg && (
                <div className="text-xs bg-red-500/10 border border-red-500/20 text-red-200 p-2.5 rounded-xl">
                  ⚠️ {errorMsg}
                </div>
              )}

              <button
                type="submit"
                className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold transition-all shadow-md"
              >
                REGISTRAR PRODUCTO EN CATÁLOGO
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Edit product */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <form onSubmit={handleConfirmEditProduct} className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-start border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">MODIFICAR PRODUCTO</h3>
                <p className="text-[10px] text-slate-400">Edite los detalles del producto en el catálogo y guarde.</p>
              </div>
              <button type="button" onClick={() => setEditingProduct(null)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs text-slate-300 font-semibold block">Nombre del Producto *</label>
                <input
                  type="text"
                  value={editNombre}
                  onChange={(e) => setEditNombre(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-300 font-semibold block">Categoría</label>
                <select
                  value={editCategoria}
                  onChange={(e) => setEditCategoria(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
                >
                  <option value="Bebidas">Bebidas</option>
                  <option value="Snacks">Snacks</option>
                  <option value="Aseo">Aseo / Cuidado Personal</option>
                  <option value="Licores">Licores</option>
                  <option value="Otros">Otros</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-300 font-semibold block">Precio Venta (COP)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatMoneyInput(editPrecio)}
                    onChange={(e) => setEditPrecio(parseMoneyInput(e.target.value))}
                    placeholder="Ej. 6.000"
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-300 font-semibold block">Stock actual (manual)</label>
                  <input
                    type="number"
                    value={editStock}
                    onChange={(e) => setEditStock(parseInt(e.target.value) || 0)}
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-300 font-semibold block">Stock Mínimo Alerta</label>
                <input
                  type="number"
                  value={editStockMinimo}
                  onChange={(e) => setEditStockMinimo(parseInt(e.target.value) || 0)}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white font-mono"
                />
              </div>

              {errorMsg && (
                <div className="text-xs bg-red-500/10 border border-red-500/20 text-red-200 p-2.5 rounded-xl">
                  ⚠️ {errorMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={editSaving}
                className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-60 disabled:cursor-wait text-white rounded-xl text-xs font-bold transition-all shadow-md"
              >
                {editSaving ? 'GUARDANDO...' : 'GUARDAR CAMBIOS DEL PRODUCTO'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Bill receipt prompt modal - solo para pagos en efectivo */}
      {showReceipt && receiptData && isCashPayment(receiptData.metodoPago || receiptData.metodo || receiptData.paymentMethod) && (
        <div className="fixed inset-0 z-55 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-sm">
          <div className="bg-white text-slate-900 border border-slate-300 rounded-2xl w-full max-w-sm overflow-hidden p-6 shadow-2xl flex flex-col items-center">
            
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

              <div className="font-bold border-b border-dashed border-slate-400 pb-1 mb-2 text-[10px]">
                DETALLE DE COMPRA
              </div>
              <div className="flex justify-between font-semibold">
                <span>{receiptData.producto} (x{receiptData.cantidad})</span>
                <span>{formatCop(receiptData.total)}</span>
              </div>
              <div className="text-[10px] text-slate-500 pl-1 mt-0.5">
                P. Unitario: {formatCop(receiptData.precioUnitario)}
              </div>
              
              <div className="border-t border-dashed border-slate-400 pt-1.5 mt-3 space-y-1">
                <div className="flex justify-between font-bold text-xs">
                  <span>TOTAL A PAGAR:</span>
                  <span>{formatCop(receiptData.total)}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span>Método Pago:</span>
                  <span>{receiptData.metodoPago}</span>
                </div>
                {receiptData.metodoPago === 'Efectivo' && (
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
                {receiptData.metodoPago === 'Transferencia' && (
                  <>
                    <div className="flex justify-between text-[10px]">
                      <span>Valor Transferido:</span>
                      <span>{formatCop(receiptData.valorTransferido)}</span>
                    </div>
                    <div className="flex justify-between text-[10px] font-semibold text-indigo-700">
                      <span>Ref. Transferencia:</span>
                      <span>{receiptData.referencia}</span>
                    </div>
                  </>
                )}
              </div>

              <div className="border-t border-dashed border-slate-400 mt-4 pt-2 text-center text-[10px] text-slate-500 italic">
                Gracias por elegir Hotel Kodiak.<br />
                ¡Vuelva pronto!
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
                    // Normalize product receipt fields into standard format
                    const normalizedReceipt = {
                      id: receiptData.id || '',
                      fecha: receiptData.fecha,
                      hora: receiptData.hora,
                      employeeName: receiptData.empleada || 'Sistema',
                      turno: receiptData.turno || 'N/A',
                      cliente: 'Cliente General',
                      habitacion: '',
                      metodoPago: receiptData.metodoPago || receiptData.metodo || 'Efectivo',
                      total: receiptData.total,
                      pagadoWith: receiptData.recibido || 0,
                      cambio: receiptData.cambio || 0,
                      tipo: 'Venta Producto',
                      conceptos: [
                        {
                          descripcion: receiptData.producto,
                          cantidad: receiptData.cantidad,
                          total: receiptData.total
                        }
                      ]
                    };

                    const manualPaymentMethod =
                      receiptData.metodoPago ||
                      receiptData.paymentMethod ||
                      receiptData.metodo ||
                      '';

                    if (!isCashPayment(manualPaymentMethod)) {
                      console.log("Reimpresión cancelada: el pago no es en efectivo.", manualPaymentMethod);
                      alert("Las ventas por transferencia no generan recibo ni reimpresión automática.");
                      return;
                    }

                    await printReceipt(normalizedReceipt);
                  } catch (err) {
                    console.error("Fallo reimpresión manual:", err);
                    alert("No se pudo enviar la orden real a la impresora. Revise conexión USB, permisos del navegador o use la app de escritorio.");
                  }
                }}
                className="flex-1 py-2 px-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>Reimprimir Recibo</span>
              </button>
            </div>

          </div>
        </div>
      )}


      {/* Modal: Historial / Kardex de producto */}
      {selectedHistoryProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start border-b border-slate-800 pb-3">
              <div>
                <span className="text-[10px] text-emerald-400 uppercase font-black tracking-wider">Kardex / Historial de inventario</span>
                <h3 className="text-base font-bold text-white">{selectedHistoryProduct.nombre}</h3>
                <p className="text-[10px] text-slate-400">Entradas, ventas, ajustes y desactivaciones sin borrar trazabilidad.</p>
              </div>
              <button onClick={() => setSelectedHistoryProduct(null)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            {getProductMovements(selectedHistoryProduct).length === 0 ? (
              <div className="text-xs text-slate-500 italic bg-slate-950 border border-slate-800 rounded-xl p-4 text-center">
                Todavía no hay movimientos históricos para este producto.
              </div>
            ) : (
              <div className="space-y-2">
                {getProductMovements(selectedHistoryProduct).slice(0, 40).map((mov: any) => (
                  <div key={mov.id} className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs flex justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-bold text-white truncate">{mov.movimiento}</div>
                      <div className="text-[10px] text-slate-400 truncate">{mov.concepto}</div>
                      <div className="text-[9px] text-slate-500 mt-1">{mov.fecha} • {mov.hora} • {mov.empleado}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`font-black ${Number(mov.cantidad || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {Number(mov.cantidad || 0) >= 0 ? '+' : ''}{mov.cantidad || 0} un.
                      </div>
                      {(mov.stockAnterior !== undefined || mov.stockNuevo !== undefined) && (
                        <div className="text-[9px] text-slate-500">
                          {mov.stockAnterior ?? '-'} → {mov.stockNuevo ?? '-'}
                        </div>
                      )}
                      {mov.total > 0 && <div className="text-[9px] text-emerald-400">{formatCop(mov.total)}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Administrative Password Modal for Products View */}
      <AdminPasswordModal
        open={adminModalOpen}
        title="Validación administrativa"
        message="Ingrese la contraseña administrativa para continuar."
        onConfirm={confirmAdminPassword}
        onCancel={() => {
          setAdminModalOpen(false);
          setPendingAdminAction(null);
        }}
      />

    </div>
  );
};
