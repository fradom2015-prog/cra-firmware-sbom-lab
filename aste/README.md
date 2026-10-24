# Aste online — prima soluzione

App web di aste a tempo, senza dipendenze esterne: serve solo **Node.js 22.5+**
(usa `node:http`, il SQLite integrato `node:sqlite` e `node:crypto`).

```bash
cd aste
npm start          # http://localhost:3000  (variabili: PORT, DB_FILE, COOKIE_SECURE=1 dietro HTTPS)
npm test
```

## Cosa fa

- Registrazione e accesso (password con scrypt, cookie di sessione `HttpOnly`/`SameSite=Lax`,
  nel database solo l'hash del token).
- Creazione di un'asta: titolo, descrizione, prezzo di partenza, rilancio minimo, durata (1 minuto – 30 giorni).
- Offerte con regole applicate lato server, in transazione:
  la prima offerta parte dal prezzo base, le successive da offerta attuale + rilancio minimo;
  il venditore non può offrire sulla propria asta; chi è già in testa non può rilanciare su sé stesso.
- **Anti-sniping**: un'offerta negli ultimi 2 minuti sposta la chiusura a 2 minuti da quel momento.
- Chiusura automatica alla scadenza, con vincitore = miglior offerente.
- Aggiornamenti in tempo reale (Server-Sent Events): prezzi, offerte e nuove aste compaiono senza ricaricare.

## Struttura

| File | Ruolo |
|---|---|
| `src/db.js` | Schema SQLite e transazioni |
| `src/auth.js` | Utenti, password, sessioni |
| `src/auctions.js` | Regole del dominio: aste e offerte |
| `src/server.js` | API REST JSON, SSE, file statici, header di sicurezza |
| `public/` | Frontend SPA in JavaScript senza framework |
| `test/` | Test di dominio e di integrazione HTTP (`node --test`) |

Gli importi viaggiano e sono salvati come **interi in centesimi**, per evitare errori di arrotondamento.

## API

| Metodo | Percorso | Note |
|---|---|---|
| POST | `/api/register`, `/api/login`, `/api/logout` | `{ username, password }` |
| GET | `/api/me` | utente corrente o `null` |
| GET | `/api/auctions?status=open\|closed` | elenco |
| POST | `/api/auctions` | `{ title, description, startingPrice, minIncrement, durationMinutes }` |
| GET | `/api/auctions/:id` | dettaglio e ultime offerte |
| POST | `/api/auctions/:id/bids` | `{ amount }` |
| GET | `/api/events` | stream SSE: eventi `bid` e `auction` |

Le richieste POST devono avere `Content-Type: application/json`: così i form cross-site (CSRF) vengono rifiutati.

## Prossimi passi possibili

- Immagini degli oggetti, categorie e ricerca.
- Prezzo di riserva, "compralo subito", offerte automatiche (proxy bidding).
- Notifiche email a chi viene superato e al vincitore; pagamento e spedizione.
- Rate limiting su login e offerte, verifica email, area "le mie aste / le mie offerte".
- Ora del server inviata al client, per correggere lo sfasamento degli orologi nel countdown.
- Per scalare su più istanze: PostgreSQL e un pub/sub (es. Redis) per gli eventi in tempo reale.
