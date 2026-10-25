// Fallisce se le dipendenze di produzione hanno vulnerabilità alte o critiche,
// salvo eccezioni motivate e con scadenza (dopo la data tornano a bloccare).
import { execSync } from 'node:child_process';

const EXCEPTIONS = {
  // Entrambe solo dentro @expo/cli (strumento di build, non incluso nel bundle dell'app).
  'GHSA-86w9-cpqp-85rv': {
    until: '2027-01-31',
    reason: 'node-forge <=1.4.0, senza versione corretta. Usato da @expo/code-signing-certificates per la firma degli EAS Update, che non usiamo.',
  },
  'GHSA-mrhx-c7xc-m3w5': {
    until: '2027-01-31',
    reason: 'zod 3 interno a @expo/cli: valida file di configurazione locali, non input non fidati. Il codice dell\'app non usa zod.',
  },
};

let report;
try {
  report = JSON.parse(execSync('npm audit --omit=dev --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
} catch (err) {
  report = JSON.parse(err.stdout); // npm audit esce con codice 1 quando trova qualcosa
}

const today = new Date().toISOString().slice(0, 10);
const blocking = [];
for (const [name, v] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of v.via) {
    if (typeof via !== 'object' || !['high', 'critical'].includes(via.severity)) continue;
    const id = via.url?.split('/').pop();
    const ex = EXCEPTIONS[id];
    if (ex && today <= ex.until) console.log(`eccezione ${id} (${name}) fino al ${ex.until}: ${ex.reason}`);
    else blocking.push(`${via.severity} ${id} in ${name}: ${via.title}`);
  }
}
if (blocking.length) {
  console.error(`Vulnerabilità bloccanti:\n${[...new Set(blocking)].join('\n')}`);
  process.exit(1);
}
console.log('Nessuna vulnerabilità alta o critica non gestita.');
