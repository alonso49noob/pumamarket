# PumaMarket

Web de predicciones con puntos virtuales. HTML, CSS y JavaScript sin dependencias de compilación.

## Uso local

Abre `index.html` en el navegador o sirve esta carpeta con un servidor HTTP estático. Para desarrollo, utiliza siempre el mismo origen (protocolo, host y puerto) para conservar el acceso a tus datos locales.

## Funcionalidad

- Acceso local y cierre de sesión; una cuenta por navegador y origen.
- Dashboard con saldo, puntos comprometidos, historial y mercados creados.
- Creación de mercados Sí/No con pregunta, categoría, cierre futuro y criterio de resolución.
- Predicciones en pasos de 25 puntos, con validación del saldo disponible.
- Búsqueda y categorías combinadas; mercados cerrados no admiten nuevas predicciones.
- Persistencia al recargar mediante `localStorage`.

## Alcance

Esto es un prototipo local. La cuenta y su hash de contraseña, la sesión, el saldo, las solicitudes de recuperación, los mercados y las predicciones se guardan únicamente en el navegador. No hay autenticación de servidor ni sincronización entre usuarios o dispositivos. Las solicitudes de recuperación no se envían a nadie. No uses contraseñas reales en esta demo.

Los tres mercados iniciales, sus porcentajes y las señales de comunidad son ejemplos. Los mercados locales nuevos no muestran probabilidades inventadas. Las predicciones quedan registradas sin resultado; todavía no existe un sistema de resolución ni de recompensas. Los puntos no tienen valor monetario.
