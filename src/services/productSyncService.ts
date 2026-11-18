import { Product } from '../types';

export interface ProductReconciliationResult {
  consolidated: Product[];
  actionsToRun: Array<() => Promise<void>>;
}

/** Una lectura conserva documentos, precios, existencias y estados originales.
 * La vista puede agrupar fichas, pero nunca inventar ni recuperar registros.
 */
export function reconcileAndSyncKodiakProducts(
  remoteItems: any[],
  _saveDocFn: (product: Product) => Promise<void>,
  _deleteDocFn: (id: string) => Promise<void>
): ProductReconciliationResult {
  return {
    consolidated: (Array.isArray(remoteItems) ? remoteItems : []).filter(Boolean).map(item => ({ ...item })),
    actionsToRun: []
  };
}
