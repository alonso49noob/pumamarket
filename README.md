# PumaMarket

Web de predicciones con puntos virtuales. HTML, CSS y JavaScript sin dependencias de compilación.

## Uso local

Abre `index.html` en el navegador o sirve esta carpeta con un servidor HTTP estático. Para desarrollo, utiliza siempre el mismo origen (protocolo, host y puerto) para conservar el acceso a tus datos locales.

## Funcionalidad

- Varias cuentas locales con inicio y cierre de sesión; saldo e historial separados por cuenta.
- Registro con teléfono internacional obligatorio; normalización de formato y bloqueo de números o usuarios repetidos en este navegador. El perfil permite asociar un teléfono a cuentas anteriores.
- Dashboard con saldo, puntos comprometidos, historial y mercados creados.
- Creación de mercados Sí/No con pregunta, categoría, cierre a partir de mañana y hasta el 31 de diciembre de 2026 (inclusive), y criterio de resolución.
- Predicciones en pasos de 25 puntos, con validación del saldo disponible.
- Búsqueda y categorías combinadas; mercados cerrados no admiten nuevas predicciones.
- Persistencia al recargar mediante `localStorage`.
- Vista de detalle al pulsar un mercado, con gráfico, periodos, tabla de datos, reglas y panel Sí/No.
- Modo oscuro desde el footer, con preferencia persistente.

## Alcance

Esto es un prototipo local. Las cuentas, teléfonos, hashes de contraseña, sesión, saldos, solicitudes de recuperación, mercados y predicciones se guardan únicamente en el navegador. No hay autenticación de servidor ni sincronización entre usuarios o dispositivos. La unicidad del teléfono sólo se comprueba contra las cuentas de este navegador y origen; no hay SMS ni comprobación de titularidad. Para garantizar unicidad global se necesita un backend con una restricción única sobre el teléfono normalizado y verificación del número. Las solicitudes de recuperación no se envían a nadie. No uses contraseñas reales en esta demo.

Los tres mercados iniciales, sus porcentajes, historial inicial y señales de comunidad son ejemplos. El gráfico identifica este historial como ilustrativo; los nuevos datos se calculan a partir de la proporción acumulada de puntos a Sí entre las predicciones locales. Los mercados nuevos comienzan sin datos. Los periodos se cuentan desde la última observación. Las predicciones quedan registradas sin resultado; todavía no existe un sistema de resolución ni de recompensas. Los puntos no tienen valor monetario.

## Comprobaciones

Ejecuta `node --test tests/domain.test.js` para verificar la normalización y unicidad de teléfonos y el cálculo de series del gráfico. No requiere instalar dependencias.
