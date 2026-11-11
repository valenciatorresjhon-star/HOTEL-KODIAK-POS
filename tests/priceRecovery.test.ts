import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HISTORICAL_PRICES, reviewPrices, validateRecovery, RawProduct } from '../src/services/priceRecoveryPolicy';
import { reconcileAndSyncKodiakProducts } from '../src/services/productSyncService';

const product = (id = 'real-firestore-id', extra: Record<string, any> = {}): RawProduct => {
  const data = { id: 'legacy-id', nombre: 'JUGO DEL VALLE', precio: 0, stock: 3, ...extra };
  return { id, data, fingerprint: JSON.stringify(data) };
};

test('recupera las 11 referencias anteriores al conteo usando el ID real', () => {
  assert.equal(Object.keys(HISTORICAL_PRICES).length, 11);
  for (const [nombre, price] of Object.entries(HISTORICAL_PRICES)) {
    const row = reviewPrices([product('remote', { nombre })])[0];
    assert.equal(row.status, 'recover'); assert.equal(row.proposed, price); assert.equal(row.id, 'remote');
  }
});
test('conserva precios positivos aunque difieran del historial', () => {
  for (const precio of [1, 8500, '9000']) assert.equal(reviewPrices([product('a', { precio })])[0].status, 'keep');
});
test('no convierte ausentes, vacíos, negativos o inválidos en cero', () => {
  for (const precio of [undefined, null, '', ' ', false, -1, NaN, Infinity, 'gratis']) {
    assert.equal(reviewPrices([product('a', { precio })])[0].status, 'review');
  }
  assert.equal(reviewPrices([product('a', { precio: '0' })])[0].status, 'recover');
});
test('no inventa precios ni confunde presentaciones', () => {
  for (const nombre of ['GALLETAS WAFER', 'GATORADE', 'CERVEZA', 'CONDONES', 'JUGO DEL VALLE PET 400', 'AGUA CON GAS', 'AGUA SABORIZADA']) {
    assert.equal(reviewPrices([product('a', { nombre })])[0].status, 'review');
  }
});
test('excluye duplicados, alias y documentos archivados', () => {
  const rows = reviewPrices([product('a'), product('b', { nombre: 'JUGO DEL VALLE PET 400', archivado: true })]);
  assert.ok(rows.every(r => r.status === 'review'));
  for (const flags of [{ archivado: true }, { activo: false }, { oculto: true }, { estado: 'Eliminado' }]) {
    assert.equal(reviewPrices([product('a', flags)])[0].status, 'review');
  }
});
test('exige nueva copia ante venta, cambio de precio, nombre o borrado', () => {
  const before = [product()];
  for (const live of [[], [product('real-firestore-id', { stock: 2 })], [product('real-firestore-id', { precio: 4500 })], [product('real-firestore-id', { nombre: 'OTRA PRESENTACION' })]]) {
    assert.throws(() => validateRecovery(before, live), /inventario cambió/);
  }
  assert.equal(validateRecovery(before, before).length, 1);
});
test('la revisión no modifica productos ni existencias', () => {
  const products = [product()]; const before = JSON.stringify(products);
  reviewPrices(products); validateRecovery(products, products);
  assert.equal(JSON.stringify(products), before);
});
test('la vista ya no disfraza un precio cero como una recuperación persistida', () => {
  const input = product().data;
  const { consolidated } = reconcileAndSyncKodiakProducts([input], async () => { throw new Error('No escribir'); }, async () => { throw new Error('No borrar'); });
  const jugo = consolidated.find(p => p.nombre === 'JUGO DEL VALLE')!;
  assert.equal(jugo.precio, 0); assert.equal(jugo.stock, 3);
});
