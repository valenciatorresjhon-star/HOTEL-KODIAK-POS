# Hotel Kodiak: copia aislada para revisión

Estado: preparación local validada, pendiente de identificación de datos productivos y pruebas físicas. No es una entrega aprobada para producción.

Base: PR #2, rama codex/owner-mobile-staging, commit f07d802f6bfe4717bfbe4439e98c5a908c110923.
No se publicó, fusionó ni subió este trabajo a GitHub.

## Ejecutar las pruebas

Requisitos en el equipo de desarrollo: Node.js >=20, Java 21+, conexión para descargar Firebase CLI y dependencias. Los emuladores son para desarrollo; no hace falta ejecutarlos en el computador antiguo del hotel.

1. npm ci --no-audit --no-fund
2. Copiar .env.staging.example como .env.staging
3. npm run lint
4. npm run test:firebase
5. npm run build:staging

test:firebase usa exclusivamente demo-hotel-kodiak, inicia emuladores Auth/Firestore y los detiene al terminar. Los tests usan datos ficticios y comprueban el ID antes de actuar. No apuntar estas pruebas a ningún proyecto real.

## Abrir la aplicación de demostración local

En una terminal:
npx -y firebase-tools@latest emulators:start --project demo-hotel-kodiak --config config/firebase.staging.json --only auth,firestore

En una segunda terminal PowerShell, con esos emuladores iniciados:
$env:GCLOUD_PROJECT='demo-hotel-kodiak'
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
node tests/seed-demo.mjs
npm run dev:staging

Abrir la dirección local que imprime Vite. Cuentas exclusivamente ficticias:
- admin@example.test
- alicia@example.test
- propietario@example.test

Contraseña solo para el emulador: SoloPruebas2026!
No usar estas cuentas o contraseña en servicios reales.

El visor abre el panel móvil existente, con lectura del servidor y sin envío de la cola local. La interfaz móvil y la sesión de recepción comparten esta aplicación; todavía no se generó un sitio móvil desplegado por separado.
No se validó visualmente: el acceso visual del entorno falla y los equipos remotos están desconectados.

El script de carga solo crea perfiles y habitaciones ausentes en el emulador; no limpia datos. Las pruebas automatizadas sí limpian la base ficticia del emulador al comenzar. Ejecutarlas separadas de una demostración.

## Producción pendiente

No usar variables de producción en esta copia durante las pruebas. La compilación staging exige emuladores y proyecto demo-. No desplegar reglas ni aplicación sin autorización.
No existe un respaldo verificado de producción realizado por este trabajo.
Para el lanzamiento: identificar primero el despliegue real y su Firebase, obtener inventario/conteos solo lectura, respaldo verificable y ensayo de restauración en un entorno separado; comprobar permisos, dos dispositivos en redes distintas, impresora/cajón y rendimiento en el PC real. Presentar diferencias y reversión antes de solicitar autorización.
