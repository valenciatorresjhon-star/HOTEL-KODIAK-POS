# Validación de Hotel Kodiak Lite

La rama parte de la publicación del 18 de noviembre de 2026 (main, 7bb2f36). Recupera del trabajo de Codex en la PR #2 las reglas para pruebas aisladas y las pruebas de autenticación, permisos, reconexión y concurrencia. La PR #1 conserva el procedimiento de recuperación de precios. La operación de precios y el inventario actual se mantienen desde main.

## Entorno de pruebas

El proyecto en línea para pruebas es `kodiak-staging-20261114`. Desde la raíz del repositorio:

- `npm run firebase:preview -- --prepare-only` compila para ese proyecto y muestra el directorio generado.
- `npm run firebase:preview` verifica que la cuenta autorizada acceda al sitio, compila y publica el canal temporal `lite` por siete días. Requiere autenticación de Firebase CLI. La configuración de Hosting que genera el comando selecciona explícitamente el proyecto de pruebas.

Las pruebas de reglas se ejecutan con datos ficticios en el proyecto emulado `demo-hotel-kodiak`. Para las pruebas en línea, usar cuentas y datos de prueba.

Al abrir una URL nueva, iniciar sesión como recepcionista y visor desde dos dispositivos en redes distintas. Registrar una ocupación, una venta con un artículo, un gasto y un cierre de prueba. Comprobar habitación, ingreso, stock y caja en el visor sin recargar. Repetir con una reconexión del visor y comprobar que el rol de visor tiene permiso de lectura únicamente.

## Prueba física de POS58 y cajón

1. Conectar la POS58 al equipo de recepción e imprimir una página de prueba en papel de 58 mm. Verificar con el manual del modelo que la salida para cajón, su voltaje y el conector sean compatibles antes de conectarlo. Habilitar la apertura automática después de comprobar la compatibilidad y la comunicación ESC/POS.
2. En la URL de pruebas y con un turno ficticio, registrar una venta de producto y un pago de habitación en efectivo. Confirmar un solo recibo por operación, el ancho correcto del papel, la legibilidad de acentos e importes, y un solo pulso de cajón cuando el equipo esté habilitado.
3. Repetir con Nequi o transferencia. Confirmar el registro y el descuento de stock, la ausencia de recibo automático y de diálogo de impresión, y que el cajón permanezca cerrado.
4. Probar un egreso en efectivo y otro electrónico. Repetir con impresora desconectada y comprobar las ventas, gastos y saldos antes de reintentar una impresión.
5. Registrar modelo exacto, conexión, sistema operativo, navegador y modo de impresión. El modo de impresión del navegador depende del diálogo y controlador de la estación. La impresión directa y la apertura de cajón dependen de la interfaz física compatible.
