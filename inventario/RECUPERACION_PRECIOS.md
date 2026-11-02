# Recuperación de precios desde GitHub

En **Productos**, con una cuenta administradora activa, aparece **Recuperar precios desde GitHub**.

1. Consultar precios reales: lectura obligatoria del servidor, incluidos documentos ocultos y archivados. Un error de cuota, conexión o permisos cancela el flujo; no usa la caché como respaldo.
2. Revisar la tabla y descargar el JSON de todos los documentos de `hotel_products`, con IDs reales y tipos de campos. Guardarlo fuera del navegador. Esta copia no incluye ventas, subcolecciones ni metadatos internos de Firestore; no es un respaldo completo de la base.
3. Confirmar que se guardó la copia y aplicar los precios recuperables.

Solo se recuperan ceros numéricos o la cadena `"0"`, con nombre coincidente y precio respaldado por `src/types.ts` en el commit `97f663fa8e0107d1208dcaee0b4a445f5979d930`. Son 11 referencias; no se inventan las otras 16 tarifas. Los precios positivos, nombres ambiguos, duplicados y documentos archivados se conservan para revisión.

La transacción vuelve a leer cada producto; si cambió cualquier campo después del respaldo (por ejemplo, stock por una venta), cancela el lote y exige consultar y respaldar otra vez. Solo actualiza `precio` y añade un registro de auditoría en `hotel_audit_logs` con los documentos previos. No modifica stock, fechas de movimientos, estados, nombres ni ventas históricas. Si hay un error, no se encola para escribir después sin revisión.

Las comprobaciones de administrador de esta función no sustituyen reglas de seguridad. Se conservan las reglas existentes del repositorio; no se despliegan reglas nuevas.

La vista deja de rellenar en memoria los precios cero de productos existentes. Una recuperación solo se considera guardada tras confirmar Firebase. No hay recuperación automática al abrir la aplicación. La función existente de consolidación de catálogo sigue agrupando fichas para la vista; la tabla de recuperación consulta los documentos originales directamente.

## Validación

Ejecutar `npx tsx --test tests/priceRecovery.test.ts`, `npm run lint` y `npm run build`.

Antes de operar en producción, revisar la tabla y el respaldo. Las pruebas locales no sustituyen una verificación en Firebase: durante la preparación, las lecturas remotas devolvieron cuota excedida (429). Aceptar estos cambios de código no elimina ese límite ni demuestra que los precios remotos ya estén reparados.
