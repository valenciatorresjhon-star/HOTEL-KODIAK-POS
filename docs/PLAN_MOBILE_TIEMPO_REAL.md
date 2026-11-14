# Hotel Kodiak — desarrollo seguro del panel móvil

## Objetivo
Permitir que el propietario consulte desde un celular, fuera del hotel, habitaciones, ventas, caja, inventario, turnos y reservas, con actualizaciones de Firestore en tiempo real y un perfil **visor** sin permisos de escritura.

## Estado inicial comprobado
- La aplicación ya contiene `src/components/OwnerMobileView.tsx` y el rol `visor`.
- `src/App.tsx` escucha cambios de las colecciones de Firestore.
- El ZIP `SISTEMA_POS_KODIAK_BASE_CERO_CORREGIDO.zip` y la rama `main` NO son idénticos. **No reemplazar la rama principal con el ZIP**. Comparar los archivos y portar solamente correcciones verificadas.
- En `firestore.rules` existe una regla global que permite lectura y escritura a toda cuenta autenticada. Es necesario reemplazarla por permisos por rol ANTES del lanzamiento público del acceso remoto.

## Primera corrección de esta rama
- Las habitaciones que ve `visor` se toman de la respuesta de Firestore, sin dar prioridad al respaldo local del celular.
- Una lectura de turnos hecha por `visor` no dispara la normalización antigua mediante escrituras.
- La recepción de eventos de Firestore como `visor` no dispara la cola de escrituras pendientes del navegador.
- Estas medidas son defensas del cliente, **no sustituyen reglas de seguridad de Firestore**.

## Requisitos antes de implementar o desplegar
1. Hacer copia de seguridad verificable de Firestore de producción y documentar la restauración.
2. Crear proyecto Firebase **independiente** de pruebas (Authentication y Firestore), con usuarios ficticios y datos de prueba.
3. Configurar las variables `VITE_FIREBASE_*` solo en el entorno correspondiente, nunca en GitHub ni en el ZIP público. No emplear credenciales administrativas de producción en Codex.
4. Revisar reglas de Firestore para: `visor` únicamente lectura; `recepcionista` acceso operativo necesario; `admin` facultades definidas; denegar el resto. Probar con Firebase Emulator Suite antes de publicar.
5. Verificar que la autenticación use perfiles persistentes del servidor y que no se concedan permisos por semejanza de correos o nombres.
6. Asegurar que toda venta y descuento de inventario se ejecuten de forma atómica, sin sobrescribir existencias con datos leídos previamente.
7. Evitar que datos locales antiguos reemplacen valores actuales de la nube; probar reconexión y operaciones pendientes.
8. No publicar la rama `main`, no conectar un despliegue automático a producción y no modificar datos reales sin autorización explícita.

## Pruebas de aceptación
- [ ] Dos navegadores, en redes diferentes, observan el mismo cambio de habitación, venta y turno sin recargar.
- [ ] Usuario `visor` ve datos actualizados y no puede crear, editar ni eliminar documentos, ni desde la interfaz ni llamando a Firestore directamente.
- [ ] Inicio de sesión con cuenta no autorizada no revela datos del hotel.
- [ ] Venta simultánea por dos operadores no duplica pagos ni produce stock incorrecto.
- [ ] Un celular con caché antiguo no sobrescribe cambios recientes.
- [ ] Pérdida de internet muestra claramente estado de desconexión; la recuperación sincroniza sin duplicados.
- [ ] Se conservan todas las ventas y cierres históricos de producción.
- [ ] El diseño móvil permite consulta desde navegador Android/iPhone fuera de la red del hotel.

## Validación del código
```bash
npm ci
npm run lint
npm run build
```

Todas las pruebas deben hacerse contra datos ficticios del entorno de staging. Solo después de completar la lista se podrá proponer publicación, bajo aprobación del propietario.
