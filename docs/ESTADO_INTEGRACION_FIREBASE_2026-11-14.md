# Hotel Kodiak — estado verificable de integración (14/11/2026)

## Código incorporado

El paquete `Kodiak-preparacion-validada.zip`, entregado por Codex el 14/11/2026, se incorporó a la rama `codex/owner-mobile-staging` mediante el commit `a9a08cc1efeca1c71b61ee56e483a51642607d12`. Se importaron 19 archivos nuevos o modificados sin reescribir los archivos idénticos, después de cotejar los SHA de contenido. La PR #2 sigue siendo borrador: **no fusionar a main** sin validar producción.

## Qué comprobó la sesión de Codex

- Proyecto Firebase accesible: `hotel-kodiak-pos`, aplicación web registrada `Hotel Kodiak POS Web`.
- Firestore: base `(default)`, región `nam5`; su existencia **no confirma que almacene los históricos reales del hotel**.
- Hosting `https://hotel-kodiak-pos.web.app` respondió 404: no hay un sitio público utilizable verificado.
- Se creó `kodiak-staging-20261114` sin facturación, pero **sin aplicación ni base Firestore ni Auth implementadas en ese proyecto**.
- Las siete pruebas de permisos, sincronización, reconexión y ventas concurrentes pasaron en emuladores del proyecto **ficticio** `demo-hotel-kodiak`, no en producción.
- Las reglas Firestore publicadas ya contenían permisos por rol al revisarlas, pero persiste una vía de inicio de administrador vinculada al correo que requiere auditoría.
- Compilaciones y comprobaciones de TypeScript correctas. JavaScript inicial de recepción estimado en 333 KB gzip; ese tamaño no prueba velocidad adecuada en el PC de 2010.

## Comprobación adicional en GitHub

El commit de importación `a9a08cc1efeca1c71b61ee56e483a51642607d12` superó la acción automática de instalación de dependencias, comprobación de tipos y compilación sin despliegue. Esa acción **no** ejecuta todavía las siete pruebas de emulador.

## Condiciones para conectar producción

1. Verificar mediante acceso de solo lectura a Cloud Run/AI Studio qué `VITE_FIREBASE_PROJECT_ID` usa realmente la recepción.
2. Inventariar solo conteos y estructura de Firestore sin exponer documentos de huéspedes ni otros datos personales.
3. Hacer un respaldo íntegro verificable y ensayo de restauración en un destino aislado.
4. Revisar y probar las reglas publicadas y asegurar el alta de usuarios sin asignación insegura de roles.
5. Conectar y probar dos dispositivos en redes distintas y la impresora POS58 con apertura real de cajón.
6. Obtener aprobación expresa antes de modificar reglas, migrar datos, fusionar a `main` o desplegar el sitio.

**No se han ejecutado escrituras en producción, migraciones ni despliegues al preparar este trabajo.**
