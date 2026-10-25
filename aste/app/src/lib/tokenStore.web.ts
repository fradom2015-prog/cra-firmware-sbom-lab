// Sul web non esiste un portachiavi: localStorage, protetto dalla CSP e dall'assenza di
// HTML generato dagli utenti. Per un sito pubblico in produzione meglio un cookie HttpOnly.
const KEY = 'aste.refreshToken';

const safe = <T,>(fn: () => T, fallback: T) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export const tokenStore = {
  get: async () => safe(() => localStorage.getItem(KEY), null),
  set: async (token: string) => safe(() => localStorage.setItem(KEY, token), undefined),
  clear: async () => safe(() => localStorage.removeItem(KEY), undefined),
};
