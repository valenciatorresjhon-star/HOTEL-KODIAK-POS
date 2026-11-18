import React, { useState } from 'react';
import { PRICE_SOURCE, reviewPrices } from '../services/priceRecoveryPolicy';
import { PriceBackup, preparePriceBackup, priceBackupText, applyPriceRecovery } from '../services/priceRecoveryService';

export function PriceRecoveryPanel() {
  const [backup, setBackup] = useState<PriceBackup | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const rows = backup ? reviewPrices(backup.products) : [];
  const count = rows.filter(r => r.status === 'recover').length;
  const button = 'rounded-lg bg-slate-700 px-3 py-2 text-sm text-white disabled:opacity-40';
  async function act(action: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await action(); } catch (error: any) {
      setBackup(null); setDownloaded(false); setConfirmed(false);
      setMessage(error?.code === 'resource-exhausted' ? 'Firebase agotó su cuota. No se aplicó la recuperación. Reintenta cuando se restablezca.' : (error?.message || 'No se pudo completar la operación. Vuelve a consultar.'));
    } finally { setBusy(false); }
  }
  return <section className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-3">
    <h3 className="font-bold text-white">Recuperar precios desde GitHub</h3>
    <p className="text-sm text-slate-300">Revisa los precios guardados en Firebase. Hay 11 referencias anteriores al conteo; solo se recuperan precios cero con nombre exacto y sin duplicados. Se conservan los precios positivos, las existencias y las ventas.</p>
    <a className="text-sm text-emerald-400 underline" href={PRICE_SOURCE} target="_blank" rel="noreferrer">Ver fuente de los precios</a>
    <div className="flex flex-wrap gap-2">
      <button className={button} disabled={busy} onClick={() => act(async () => {
        setBackup(null); setDownloaded(false); setConfirmed(false);
        setBackup(await preparePriceBackup());
      })}>{busy ? 'Procesando…' : '1. Consultar precios reales'}</button>
      <button className={button} disabled={busy || !backup} onClick={() => {
        if (!backup) return;
        try {
          const url = URL.createObjectURL(new Blob([priceBackupText(backup)], { type: 'application/json' }));
          const link = document.createElement('a'); link.href = url;
          link.download = `kodiak-productos-${backup.capturedAt.replace(/[:.]/g, '-')}.json`;
          document.body.appendChild(link); link.click(); link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          setDownloaded(true);
        } catch { setMessage('No se pudo descargar la copia. Inténtalo de nuevo.'); }
      }}>2. Descargar respaldo</button>
    </div>
    {backup && <>
      <p className="text-sm text-slate-300">{rows.length} documentos consultados · {count} precios recuperables. La copia incluye todos los documentos de productos; no es un respaldo completo de la base.</p>
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-left text-xs text-slate-200">
          <thead><tr><th className="p-2">Producto / ID</th><th className="p-2">Guardado</th><th className="p-2">Referencia COP</th><th className="p-2">Resultado previsto</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id} className="border-t border-slate-800">
            <td className="p-2">{row.name}<br /><span className="text-slate-400">{row.id}</span></td>
            <td className="p-2">{row.previous == null ? 'Sin precio' : String(row.previous)}</td>
            <td className="p-2">{row.proposed?.toLocaleString('es-CO') ?? 'Pendiente'}</td>
            <td className="p-2">{row.reason}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" disabled={!downloaded || busy} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Confirmo que guardé la copia y revisé las diferencias.</label>
      <button className={button} disabled={busy || !downloaded || !confirmed || !count} onClick={() => act(async () => {
        const updated = await applyPriceRecovery(backup);
        setBackup(null); setDownloaded(false); setConfirmed(false);
        setMessage(`Se recuperaron ${updated} precios en Firebase. Existencias y ventas conservadas.`);
      })}>3. Aplicar {count} precios recuperables</button>
    </>}
    {message && <p role="status" className="text-sm text-amber-200">{message}</p>}
  </section>;
}
