# Hotel Kodiak — conexión de Codex con Firebase

## Alcance aprobado
Conservar el proyecto Firebase de producción y todos sus históricos; desarrollar y probar una versión ligera del POS para computadores antiguos y un panel móvil de consulta para el propietario.

## Estado real
- Proyecto GitHub: `valenciatorresjhon-star/HOTEL-KODIAK-POS`.
- Rama de trabajo: `codex/owner-mobile-staging` (PR en borrador).
- La conexión a Firebase está configurada en el código con `VITE_FIREBASE_*`, pero todavía falta autorizar el proyecto específico en Codex.
- El archivo local HTML de demostración **no** está conectado a Firebase ni debe usarse como sistema de producción.
- Reglas propuestas de pruebas: `config/firestore.staging.rules`. La regla principal `firestore.rules` **no fue cambiada**.
- Emuladores de pruebas: `config/firebase.staging.json`; no hay conexión a producción.

## Acciones para Codex con Firebase habilitado
1. Identificar el proyecto Firebase del Hotel Kodiak y confirmar ID antes de cualquier operación. Usar solo lecturas de metadatos y configuraciones, sin exponer credenciales.
2. Revisar qué Authentication y Firestore existen y verificar que se trabaja sobre el proyecto correcto.
3. Antes de cualquier operación de escritura, crear un proyecto Firebase *distinto* para staging y usar credenciales separadas.
4. Hacer respaldo verificable de producción con procedimiento de restauración antes de migrar o desplegar.
5. Preparar en staging cuentas reales de rol `admin`, `recepcionista` y `visor`, pero con datos ficticios; aprovisionarlas con un servicio seguro (Admin SDK), no mediante inferencia del correo.
6. Validar reglas de seguridad mediante emuladores y verificar que `visor` no pueda crear, editar o borrar ningún dato. No desplegar todavía las reglas de staging a producción.
7. Ejecutar pruebas de concurrencia de ventas/inventario, caja/turnos, habitaciones, desconexión y recuperación, con dos dispositivos.
8. Revisar el catálogo oficial del archivo base (`src/kodiakRules.ts`): 17 habitaciones, incluida la 108 fuera de servicio, 102 y 202 con ventilador y el Apartamento. No sobrescribir esos registros durante las pruebas.
9. Validar funcionamiento y tiempos de carga en computador antiguo. Cargar Excel únicamente al exportar; el panel propietario se importa solo para ese perfil.
10. Presentar pruebas, diferencias con producción, plan de reversión y pedir aprobación antes de fusionar `main`, modificar Firebase productivo o publicar.

## Comandos para probar con emuladores (no producción)
En una copia del proyecto con Node.js instalado y Firebase CLI autenticado:
```bash
firebase emulators:start --project demo-hotel-kodiak --config config/firebase.staging.json --only auth,firestore
```
Para las verificaciones estáticas:
```bash
npm install
npm run lint
npm run build
```

## Bloqueos conocidos
- Repositorio aún público: hacerlo privado y revisar posibles secretos anteriores.
- El archivo `package-lock.json` no coincide con `package.json` (faltan paquetes de XLSX). Reparar el lockfile antes de volver a usar `npm ci`.
- No hay un ID de Firebase de producción verificado mediante integración activa en esta conversación.
- La configuración actual de autenticación intenta crear perfiles y asignar roles a partir de partes del correo: reemplazar antes de lanzar.
- `firestore.rules` de producción permite escritura a cualquier usuario autenticado. No publicar un panel remoto hasta resolverlo.
