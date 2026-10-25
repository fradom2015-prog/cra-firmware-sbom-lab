import { hash, verify, Algorithm } from '@node-rs/argon2';
import { createHash } from 'node:crypto';

// Parametri Argon2id raccomandati da OWASP (19 MiB, 2 iterazioni).
const OPTIONS = { algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password: string) => hash(password, OPTIONS);
export const verifyPassword = (stored: string, password: string) => verify(stored, password).catch(() => false);

// Usato quando l'utente non esiste: il tempo di risposta non rivela quali email sono registrate.
let dummy: Promise<string> | undefined;
export async function burnPasswordCheck(password: string) {
  dummy ??= hashPassword('dummy-password-for-timing');
  await verifyPassword(await dummy, password);
}

// Password già comparse in violazioni (Have I Been Pwned, k-anonymity: inviamo solo
// i primi 5 caratteri dell'hash SHA-1). In caso di errore di rete non blocca la registrazione.
export async function isPwnedPassword(password: string): Promise<boolean> {
  const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const suffix = sha1.slice(5);
    return (await res.text()).split('\n').some((line) => {
      const [s, count] = line.trim().split(':');
      return s === suffix && Number(count) > 0;
    });
  } catch {
    return false;
  }
}
