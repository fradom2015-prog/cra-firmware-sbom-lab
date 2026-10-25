// Prova end-to-end dell'app web contro il server vero: due utenti, vendita, offerta,
// aggiornamento in tempo reale, ricerca, chiusura e ordine. Istruzioni in aste/e2e/README.md.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
// Configurazione: APP_URL (web app esportata), SERVER_LOG (log del server, da cui si leggono
// i link di verifica email in sviluppo), DATABASE_URL (per chiudere l'asta in anticipo), SHOTS (cartella screenshot).
const APP = process.env.APP_URL ?? 'http://localhost:8090';
const SERVER_LOG = process.env.SERVER_LOG ?? 'server.log';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/aste_dev';
const SHOTS = process.env.SHOTS ?? path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const sharp = require(require.resolve('sharp', { paths: [path.join(__dirname, '../server')] }));
const lastToken = () => [...fs.readFileSync(SERVER_LOG, 'utf8').matchAll(/verify-email\?token=([A-Za-z0-9_-]+)/g)].at(-1)[1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

async function newUser(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: name === 'giulia' ? 'dark' : 'light' });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('favicon') && errors.push(`${name} console: ${m.text()}`));
  await page.goto(`${APP}/auth/register`);
  await page.getByLabel('Email', { exact: true }).fill(`${name}@example.com`);
  await page.getByLabel('Nome utente').fill(name);
  await page.getByLabel('Password', { exact: true }).fill('una-password-sicura-123');
  await page.getByRole('checkbox').nth(0).click();
  await page.getByRole('checkbox').nth(1).click();
  await page.getByRole('button', { name: 'Crea account' }).click();
  await page.getByText('Ti abbiamo inviato').waitFor();
  await sleep(300);
  await page.goto(`${APP}/verify-email?token=${lastToken()}`);
  await page.getByText('Indirizzo email confermato').waitFor();
  await page.goto(`${APP}/auth/login`);
  await page.getByLabel('Email', { exact: true }).fill(`${name}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('una-password-sicura-123');
  await page.getByRole('button', { name: 'Accedi' }).click();
  await page.getByText('Aste', { exact: true }).first().waitFor();
  return page;
}

(async () => {
  const browser = await chromium.launch();
  const mario = await newUser(browser, 'mario');
  console.log('1. mario registrato, verificato, connesso');

  await mario.goto(`${APP}/sell/seller-profile`);
  await mario.getByLabel('Nome e cognome').fill('Mario Rossi');
  await mario.getByLabel('Indirizzo').fill('Via Roma 1');
  await mario.getByLabel('Città').fill('Milano');
  await mario.getByLabel('CAP').fill('20100');
  await mario.getByRole('button', { name: 'Salva profilo' }).click();
  const popup = mario.context().waitForEvent('page').catch(() => null);
  await mario.getByRole('button', { name: 'Verifica identità e IBAN' }).click();
  const p = await popup; if (p) await p.close();
  await mario.getByText('Pagamenti attivi').waitFor({ timeout: 10000 });
  await mario.screenshot({ path: `${SHOTS}/1-profilo-venditore.png` });
  console.log('2. profilo venditore e verifica pagamenti completati');

  await mario.goto(`${APP}/sell/new`);
  const photos = await Promise.all(['#b45309', '#1e3a5f'].map((bg) => sharp({ create: { width: 1200, height: 900, channels: 3, background: bg } }).jpeg().toBuffer()));
  for (const buf of photos) {
    const chooser = mario.waitForEvent('filechooser');
    await mario.getByRole('button', { name: 'Scegli dalla galleria' }).click();
    await (await chooser).setFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: buf });
    await sleep(300);
  }
  await mario.getByLabel('Titolo').fill('Macchina fotografica Leica M6 con Summicron 50mm');
  await mario.getByLabel('Descrizione').fill('Perfettamente funzionante, esposimetro ok. Lievi segni d\'uso sul fondello. Con tappi e custodia.');
  await mario.getByRole('button', { name: 'Elettronica' }).click();
  await mario.getByRole('button', { name: 'Buone condizioni' }).click();
  await mario.getByLabel("Base d'asta (€)").fill('850');
  await mario.getByLabel('Spese di spedizione (€)').fill('12,50');
  await mario.screenshot({ path: `${SHOTS}/2-nuova-asta.png`, fullPage: true });
  await mario.getByRole('button', { name: 'Pubblica' }).click();
  await mario.waitForURL(/\/auction\//, { timeout: 15000 });
  const auctionUrl = mario.url();
  await mario.getByText('Questa è la tua asta').waitFor({ state: 'detached', timeout: 1000 }).catch(() => {});
  console.log('3. asta pubblicata con 2 foto:', auctionUrl.split('/').pop());

  const giulia = await newUser(browser, 'giulia');
  await giulia.screenshot({ path: `${SHOTS}/3-home.png` });
  await giulia.goto(auctionUrl);
  await giulia.getByText("Fai un'offerta").waitFor();
  await giulia.screenshot({ path: `${SHOTS}/4-dettaglio-asta.png`, fullPage: true });
  await giulia.getByLabel('La tua offerta massima (€)').fill('1.000');
  await giulia.getByRole('button', { name: 'Offri', exact: true }).click();
  await giulia.getByText('Sei in testa').first().waitFor();
  console.log('4. giulia ha offerto (massimo 1000 €, paga 850 €)');

  // Il venditore vede il nuovo prezzo senza ricaricare (WebSocket).
  await mario.getByText('in testa g***a').waitFor({ timeout: 8000 });
  console.log('5. aggiornamento in tempo reale ricevuto dal venditore');

  await giulia.goto(`${APP}/search`);
  await giulia.getByLabel('Cosa cerchi?').fill('leica');
  await giulia.getByText('1 risultato').waitFor();
  await giulia.screenshot({ path: `${SHOTS}/5-ricerca.png` });
  console.log('6. ricerca full-text ok');

  // Chiusura anticipata dell'asta per provare il flusso dell'ordine.
  require('child_process').execSync(`psql "${DATABASE_URL}" -qc "UPDATE auctions SET ends_at = now() + interval '2 seconds' WHERE status = 'active'"`);
  await sleep(9000);
  await giulia.goto(`${APP}/activity?tab=purchases`);
  await giulia.getByText('Da pagare').waitFor();
  await giulia.getByText('Leica').click();
  await giulia.getByText('Indirizzo di spedizione').waitFor();
  await giulia.screenshot({ path: `${SHOTS}/6-ordine.png`, fullPage: true });
  console.log('7. ordine creato alla chiusura, schermata di pagamento ok');

  await mario.goto(`${APP}/settings`);
  await mario.screenshot({ path: `${SHOTS}/7-impostazioni.png`, fullPage: true });
  console.log('errori nel browser:', errors.length ? errors : 'nessuno');
  await browser.close();
})().catch((e) => { console.error('FALLITO:', e.message.split('\n')[0]); console.log('errori:', errors); process.exit(1); });
