# PumaMarket

Web de predicciones con puntos virtuales. HTML, CSS y JavaScript sin dependencias de compilación.

## Uso local

Abre `index.html` en el navegador o sirve esta carpeta con un servidor HTTP estático. Para desarrollo, utiliza siempre el mismo origen (protocolo, host y puerto) para conservar el acceso a tus datos locales.

## Funcionalidad

- Varias cuentas locales con inicio y cierre de sesión; saldo e historial separados por cuenta. Cada cuenta nueva parte con 100 puntos (`STARTING_POINTS` en `domain.js`); las cuentas creadas antes conservan su saldo.
- Registro con teléfono internacional obligatorio; normalización de formato y bloqueo de números o usuarios repetidos en este navegador. El perfil permite asociar un teléfono a cuentas anteriores.
- Dashboard con saldo, puntos comprometidos, historial y mercados creados.
- Creación de mercados Sí/No con pregunta, categoría, cierre a partir de mañana y hasta el 31 de diciembre de 2026 (inclusive), y criterio de resolución.
- Predicciones en pasos de 25 puntos, con validación del saldo disponible.
- Búsqueda y categorías combinadas; mercados cerrados no admiten nuevas predicciones.
- Persistencia al recargar mediante `localStorage`.
- Vista de detalle al pulsar un mercado, con gráfico, periodos, tabla de datos, reglas y panel Sí/No.
- Resolución de mercados: quien creó un mercado puede declarar el resultado (Sí o No) desde su vista de detalle. El mercado se cierra y los puntos se reparten con pozo compartido: quienes acertaron se dividen todos los puntos apostados en proporción a lo que pusieron (se redondea hacia abajo). El historial muestra cada predicción como acertada o fallada.
- Billetera por cuenta: cada cuenta tiene una dirección de 16 caracteres hexadecimales (64 bits, se muestra como `XXXX-XXXX-XXXX-XXXX`). Las cuentas anteriores reciben la suya al cargar la página. Se pueden transferir puntos enteros a otra cuenta de este navegador; se muestra el nombre del destinatario antes de confirmar y el historial de envíos y recepciones.
- Guía de equivalencia a pesos chilenos con inflación: toda la economía vale un monto fijo de referencia (`REFERENCE_FUND_CLP` en `domain.js`, hoy $100.000 CLP) que se divide entre los puntos en circulación (saldos más apuestas abiertas). Cada cuenta nueva crea 100 puntos y baja el valor de cada punto. Transferir y predecir no cambian la circulación; resolver un mercado puede reducirla por redondeo. Incluye calculadora, gráfico de línea del valor de 1 P en el tiempo (con tooltip y navegación con flechas) y tabla de cambios. El historial se guarda en este navegador desde la primera carga con esta versión. Es sólo referencial: no existe compra, venta ni canje de puntos.
- Portada con datos reales: puntos en juego, predicciones abiertas y un ticker con la probabilidad actual de cada mercado.
- Modo oscuro desde el footer, con preferencia persistente.

## Verificación de teléfono

Sin servidor: quien administra firma cada número con una clave privada (ECDSA P-256) y envía a ese número un código y un enlace. La persona pulsa "Ingresar código" en su perfil o en la billetera, ve los pasos y el aviso de que debe esperar el código, y pega lo que recibió: el código, el enlace o el mensaje completo. También puede abrir el enlace directamente. El sitio comprueba la firma con la clave pública de `clave-publica.js`. El código tiene 86 caracteres porque es la firma misma: un código corto no se podría comprobar sin servidor sin que alguien lo adivinara probando. Las cuentas sin verificar pueden recibir puntos, pero no enviarlos. Si alguien cambia su teléfono, debe verificarlo de nuevo.

1. Una sola vez, crea tus claves. La privada se guarda en `~/.pumamarket/clave-privada.json`, fuera del repositorio. Haz commit de `clave-publica.js`.

   ```bash
   node tools/verificar-telefono.js claves
   ```

2. Cuando alguien te escriba desde su número, genera su código y envíaselo **sólo a ese número** por SMS o WhatsApp:

   ```bash
   node tools/verificar-telefono.js "+56 9 1234 5678"
   ```

   Para probar en local, agrega `--sitio http://localhost:8765/`.

   También puedes usar el panel de administración en `admin.html` (no está enlazado desde el sitio). Cargas tu archivo de clave privada, que queda sólo en la memoria de la pestaña, y el panel comprueba que coincida con `clave-publica.js`. Luego pegas la solicitud que te envió la persona (la ventana de verificación del sitio se la da lista, con su usuario, billetera y teléfono) y los campos se llenan solos. Al generar el código obtienes un mensaje listo con código y enlace, con botones para copiarlos o abrir WhatsApp o SMS.

   Cada código generado registra a la persona en el **directorio de usuarios** del panel: usuario, teléfono, billetera y fechas del primer y último código, con buscador por cualquiera de esos datos. Puedes descargarlo en CSV para Excel (protegido contra fórmulas inyectadas) y guardar o restaurar un respaldo en JSON. El directorio vive sólo en el navegador donde lo usas, así que conviene descargar un respaldo de vez en cuando. No muestra saldos ni actividad, porque esos datos siguen en el navegador de cada persona. La página puede ser pública: sin tu clave privada no sirve para nada.

   El panel pide una contraseña antes de mostrarse. Elígela una vez con este comando, que no muestra lo que escribes, y haz commit de `admin-acceso.js`:

   ```bash
   node tools/verificar-telefono.js contrasena
   ```

   Ese archivo sólo guarda una huella PBKDF2 con sal, no la contraseña. Usa al menos 12 caracteres, porque la huella es pública y una contraseña corta se puede adivinar probando. En un sitio estático la contraseña oculta el panel, pero alguien con conocimientos técnicos puede saltársela: la protección real sigue siendo la clave privada.

Nunca compartas ni subas la clave privada. Si se filtra, ejecuta `claves --reemplazar`, haz commit de la nueva `clave-publica.js` y los enlaces anteriores dejarán de servir.

## Alcance

Esto es un prototipo local. Las cuentas, teléfonos, hashes de contraseña, sesión, saldos, solicitudes de recuperación, mercados y predicciones se guardan únicamente en el navegador. No hay autenticación de servidor ni sincronización entre usuarios o dispositivos. La unicidad del teléfono sólo se comprueba contra las cuentas de este navegador y origen. La verificación de teléfono prueba que la persona recibió tu enlace, pero como todo vive en el navegador, alguien con conocimientos técnicos puede editar sus datos locales y saltársela. Para garantizar unicidad global y una verificación que no se pueda evitar se necesita un backend. Las solicitudes de recuperación no se envían a nadie. No uses contraseñas reales en esta demo.

Los tres mercados iniciales, sus porcentajes, historial inicial y señales de comunidad son ejemplos. El gráfico identifica este historial como ilustrativo; los nuevos datos se calculan a partir de la proporción acumulada de puntos a Sí entre las predicciones locales. Los mercados nuevos comienzan sin datos. Los periodos se cuentan desde la última observación. Los mercados de ejemplo no tienen dueño y no se pueden resolver. La resolución depende de la palabra de quien creó el mercado: no hay verificación externa, y esa persona también puede predecir en su propio mercado. Los puntos no tienen valor monetario.

## Comprobaciones

Ejecuta `node --test tests/domain.test.js` para verificar la normalización y unicidad de teléfonos, el cálculo de series del gráfico, el reparto de puntos al resolver mercados, las direcciones de billetera, las transferencias y la firma de verificación de teléfonos. No requiere instalar dependencias.
