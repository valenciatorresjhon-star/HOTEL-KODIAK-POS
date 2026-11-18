# Hotel Kodiak POS en línea

Dirección de producción: https://hotel-kodiak-pos.web.app

La publicación utiliza Firebase Hosting y la aplicación web ya registrada en el proyecto `hotel-kodiak-pos`. El inicio de sesión usa las cuentas existentes de Firebase Authentication y exige un perfil activo en `hotel_users`; no crea administradores por el nombre del correo ni acepta una sesión simulada cuando falta configuración.

Las operaciones que piden autorización administrativa verifican la contraseña real de la cuenta administradora conectada con Firebase. Se eliminaron las claves compartidas incluidas en el código. Una sesión de recepcionista no puede autorizar esas acciones con una clave común: debe realizarlas una cuenta administradora.

## Compilar y publicar

1. `npm ci`
2. Crear `.env.production` con las variables `VITE_FIREBASE_*` de `.env.example`, usando la configuración de la aplicación web existente. Se puede consultar con `npx -y firebase-tools@latest apps:sdkconfig WEB 1:632661879978:web:168021e55724005634f4d3 --project hotel-kodiak-pos`.
3. `npm run lint` y `npx tsx --test tests/priceRecovery.test.ts`
4. `npm run build`
5. `npx -y firebase-tools@latest hosting:channel:deploy revision --expires 1d --project hotel-kodiak-pos`
6. Verificar la URL temporal y promover la misma versión con `npx -y firebase-tools@latest hosting:clone hotel-kodiak-pos:revision hotel-kodiak-pos:live --project hotel-kodiak-pos`.

No incluir `.env.production`, respaldos de datos ni credenciales en GitHub. `firebase.json` publica únicamente `dist`; no despliega reglas, funciones ni cambios en las cuentas. La compilación falla si falta la configuración de Firebase.

## Datos y operación

- Las lecturas de productos preservan precio, stock, IDs y estado; no agregan productos de un inventario histórico ni programan correcciones.
- La caché conserva lo realmente leído y no escoge el stock mayor de un duplicado.
- Abrir las vistas de habitaciones y turnos no escribe restauraciones desde caché ni corrige importes históricos automáticamente.
- Se conservan las ediciones pendientes explícitas y las ventas transaccionales existentes.
- La recuperación manual de precios documentada en `inventario/RECUPERACION_PRECIOS.md` exige consulta del servidor y respaldo. No es necesaria para documentos cuyo precio ya es positivo.
- Las integraciones opcionales Google Calendar/Drive/Gmail/Sheets requieren su configuración y un servicio de integración. Esta publicación estática no incluye esos endpoints; cuando no están configuradas, ya no simulan éxito ni devuelven enlaces ficticios. El servicio de webhook de cierres existente se conserva.

## Verificación del 18 de noviembre de 2026

Se consultaron y respaldaron 39 productos, 1166 ventas y 171 cierres. Había 26 productos activos con precios positivos y 13 archivados; no se aplicaron cambios de datos. AGUA SABORIZADA, incluida en el conteo físico con cero unidades, no tenía documento en la colección; no se creó ni se inventó su precio. Algunas referencias históricas difieren en nombre o presentación de las actuales: se conservaron los precios positivos actuales.

Las pruebas locales cubren conservación del inventario, recuperación condicional y conflictos. La pantalla pública se verifica en escritorio y móvil. Esa comprobación no sustituye una prueba real de venta, cierre o impresión con el equipo del hotel; no se insertan operaciones ficticias en producción.
