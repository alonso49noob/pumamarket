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

const [command] = process.argv.slice(2);
if (!command || command === '--ayuda') {
  console.log('Uso:\n  node tools/verificar-telefono.js claves [--reemplazar]\n  node tools/verificar-telefono.js "+56 9 1234 5678" [--sitio URL]');
} else if (command === 'claves') {
  createKeys().catch(error => { console.error(error.message); process.exit(1); });
} else {
  signLink(command).catch(error => { console.error(error.message); process.exit(1); });
}
