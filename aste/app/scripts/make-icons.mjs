// Genera icone e splash da un unico disegno vettoriale. Uso: node scripts/make-icons.mjs
// (usa sharp installato nel server: cd ../server && npm install).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sharp = createRequire(path.join(here, '../../server/package.json'))('sharp');
const out = (f) => path.join(here, '../assets', f);

const ORANGE = '#C2410C';

// Martelletto d'asta su base. "scale" lo riduce attorno al centro (zona sicura delle icone Android).
const gavel = (color, scale = 1) => `
  <g transform="translate(512 512) scale(${scale}) translate(-512 -512)" fill="${color}">
    <g transform="rotate(-40 520 430)">
      <rect x="360" y="300" width="320" height="120" rx="26"/>
      <rect x="326" y="276" width="62" height="168" rx="22"/>
      <rect x="652" y="276" width="62" height="168" rx="22"/>
      <rect x="490" y="380" width="60" height="340" rx="26"/>
    </g>
    <rect x="292" y="760" width="440" height="74" rx="28"/>
  </g>`;

const svg = (body, bg) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${bg ? `<rect width="1024" height="1024" fill="${bg}"/>` : ''}${body}</svg>`);

// iOS: 1024×1024 senza trasparenza (App Store la rifiuta); gli angoli li arrotonda il sistema.
await sharp(svg(gavel('#FFFFFF', 0.82), ORANGE)).flatten({ background: ORANGE }).png().toFile(out('icon.png'));
// Android adaptive icon: primo piano nella zona sicura (66%), sfondo pieno, versione monocromatica.
await sharp(svg(gavel('#FFFFFF', 0.6))).png().toFile(out('android-icon-foreground.png'));
await sharp(svg('', ORANGE)).png().toFile(out('android-icon-background.png'));
await sharp(svg(gavel('#FFFFFF', 0.6))).png().toFile(out('android-icon-monochrome.png'));
// Splash: simbolo arancione su sfondo chiaro/scuro (colore impostato in app.config.ts).
await sharp(svg(gavel(ORANGE, 0.9))).resize(512, 512).png().toFile(out('splash-icon.png'));
await sharp(svg(gavel('#FFFFFF', 0.82), ORANGE)).resize(48, 48).png().toFile(out('favicon.png'));
console.log('Icone generate in assets/');
