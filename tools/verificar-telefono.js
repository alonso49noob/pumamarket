#!/usr/bin/env node
// Signs phone numbers so PumaMarket can verify them without a server.
//
//   node tools/verificar-telefono.js claves          create your key pair (once)
//   node tools/verificar-telefono.js "+56 9 1234 5678"  print a verification link
//
// The private key lives outside the repository and must never be shared.
// The public key is written to clave-publica.js, which the site loads.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const rules = require('../domain.js');

const { subtle } = globalThis.crypto;
const DEFAULT_SITE = 'https://alonso49noob.github.io/pumamarket/';
const privatePath = process.env.PUMA_CLAVE_PRIVADA || path.join(os.homedir(), '.pumamarket', 'clave-privada.json');
const publicPath = path.join(__dirname, '..', 'clave-publica.js');

function option(name) {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : null;
}

async function createKeys() {
  if (fs.existsSync(privatePath) && !process.argv.includes('--reemplazar')) {
    console.error(`Ya existe una clave privada en ${privatePath}.`);
    console.error('Usa --reemplazar sólo si quieres invalidar todos los enlaces enviados.');
    process.exit(1);
  }
  const pair = await subtle.generateKey(rules.VERIFY_ALGORITHM, true, ['sign', 'verify']);
  const privateJwk = await subtle.exportKey('jwk', pair.privateKey);
  const { kty, crv, x, y } = await subtle.exportKey('jwk', pair.publicKey);
  fs.mkdirSync(path.dirname(privatePath), { recursive:true });
  fs.writeFileSync(privatePath, JSON.stringify(privateJwk, null, 2), { mode:0o600 });
  fs.writeFileSync(publicPath, `// Public key used to check phone verification links. Safe to publish.\nwindow.PUMA_PUBLIC_KEY = ${JSON.stringify({ kty, crv, x, y })};\n`);
  console.log(`Clave privada guardada en ${privatePath} (no la compartas ni la subas).`);
  console.log(`Clave pública escrita en ${publicPath}. Haz commit de ese archivo y súbelo.`);
}

async function signLink(phone) {
  const normalized = rules.normalizePhone(phone);
  if (!normalized) {
    console.error('Número no válido. Incluye el código de país, por ejemplo "+56 9 1234 5678".');
    process.exit(1);
  }
  if (!fs.existsSync(privatePath)) {
    console.error(`No hay clave privada en ${privatePath}. Ejecuta primero: node tools/verificar-telefono.js claves`);
    process.exit(1);
  }
  const privateJwk = JSON.parse(fs.readFileSync(privatePath, 'utf8'));
  const signature = await rules.signPhone(normalized, privateJwk, subtle);
  const site = option('--sitio') || DEFAULT_SITE;
  console.log(`Enlace para ${normalized}:\n`);
  console.log(rules.verificationLink(site, normalized, signature));
  console.log('\nEnvíalo SÓLO a ese número, por SMS o WhatsApp. Así compruebas que la persona lo tiene.');
}

// Applies raw keystrokes to the hidden value. Pure, so it can be checked
// without a terminal. Escape sequences (arrows, bracketed paste) are ignored.
function applyKeys(value, chunk) {
  let echo = '';
  for (const char of chunk.replace(/\x1b\[[0-9;]*[~A-Za-z]/g, '')) {
    if (char === '\r' || char === '\n') return { value, echo, done:true };
    if (char === '\u0003') return { value, echo, cancelled:true };
    if (char === '\u007f' || char === '\b') {
      if (value) { value = [...value].slice(0, -1).join(''); echo += '\b \b'; }
    } else if (char >= ' ') { value += char; echo += '*'; }
  }
  return { value, echo };
}

// Reads a line key by key, echoing * so the password never shows on screen.
function askHidden(question) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    let value = '';
    process.stdout.write(question);
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.resume();
    const stop = () => { input.removeListener('data', onData); input.setRawMode(false); input.pause(); process.stdout.write('\n'); };
    function onData(chunk) {
      const result = applyKeys(value, chunk);
      value = result.value;
      process.stdout.write(result.echo);
      if (result.cancelled) { stop(); reject(new Error('Cancelado. No se cambió nada.')); }
      else if (result.done) { stop(); resolve(value); }
    }
    input.on('data', onData);
  });
}

async function setAdminPassword() {
  let password = process.env.PUMA_ADMIN_PASSWORD;
  if (!password) {
    if (!process.stdin.isTTY) {
      console.error('Esta terminal no permite escribir la contraseña de forma oculta.');
      console.error('Usa PowerShell o la terminal de la app. En Git Bash, antepón winpty: winpty node tools/verificar-telefono.js contrasena');
      process.exit(1);
    }
    password = await askHidden('Nueva contraseña del panel (verás * al escribir o pegar): ');
    const again = await askHidden('Repítela: ');
    if (password !== again) { console.error('Las contraseñas no coinciden. No se cambió nada.'); process.exit(1); }
  }
  if ([...password].length < 12) { console.error('Usa al menos 12 caracteres: la huella es pública y una contraseña corta se puede adivinar.'); process.exit(1); }
  const salt = rules.base64url(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  const iterations = rules.ADMIN_ITERATIONS;
  const hash = await rules.hashAdminPassword(password, salt, iterations, subtle);
  const accessPath = path.join(__dirname, '..', 'admin-acceso.js');
  fs.writeFileSync(accessPath, `// Salted PBKDF2 fingerprint of the admin panel password. Safe to publish; the password itself is not here.\nwindow.PUMA_ADMIN_ACCESS = ${JSON.stringify({ salt, iterations, hash })};\n`);
  console.log(`Contraseña guardada como huella en ${accessPath}. Haz commit de ese archivo y súbelo.`);
}

const [command] = process.argv.slice(2);
if (require.main !== module) {
  module.exports = { applyKeys };
} else if (!command || command === '--ayuda') {
  console.log('Uso:\n  node tools/verificar-telefono.js claves [--reemplazar]\n  node tools/verificar-telefono.js contrasena\n  node tools/verificar-telefono.js "+56 9 1234 5678" [--sitio URL]');
} else if (command === 'contrasena' || command === 'contraseña') {
  setAdminPassword().catch(error => { console.error(error.message); process.exit(1); });
} else if (command === 'claves') {
  createKeys().catch(error => { console.error(error.message); process.exit(1); });
} else {
  signLink(command).catch(error => { console.error(error.message); process.exit(1); });
}
