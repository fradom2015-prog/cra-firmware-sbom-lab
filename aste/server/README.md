# Server API

Node 22, TypeScript, Fastify, PostgreSQL 16, Redis, Stripe Connect.

```bash
cp .env.example .env
docker compose up -d        # PostgreSQL e Redis locali
npm install
npm run dev                 # applica le migrazioni e avvia su http://localhost:3000
npm test                    # 55 test (serve PostgreSQL: TEST_DATABASE_URL)
npm run typecheck && npm run lint && npm run audit
```

In produzione si usa l'immagine unica server + web app (`../Dockerfile`, `../deploy/`).
In sviluppo, senza chiavi esterne, il server funziona da solo: pagamenti simulati, email
scritte nel log (con i link di verifica), immagini su disco. In produzione la configurazione
rifiuta di partire se mancano Stripe, Redis, S3, SMTP o HTTPS.

## Funzioni

- **Account**: registrazione senza enumerazione delle email, verifica email, password Argon2id
  (controllo opzionale su Have I Been Pwned), blocco dopo 10 tentativi, reset via email,
  sessioni con access token da 15 minuti e refresh token a rotazione con rilevamento del riuso.
- **Aste**: bozza → foto → pubblicazione; 10 categorie, condizioni dell'oggetto, durata 1–14 giorni,
  spese di spedizione, prezzo di riserva nascosto, ricerca full-text in italiano, ordinamenti.
- **Offerte automatiche** come eBay: l'utente indica il massimo, il sistema rilancia per lui a
  scaglioni. Anti-sniping (2 minuti), idempotenza contro il doppio tocco, lock di riga contro le
  offerte concorrenti, nomi degli offerenti mascherati.
- **Pagamento protetto** (Stripe Connect, separate charges and transfers): ordine alla chiusura,
  3 giorni per pagare, indirizzo visibile al venditore solo dopo il pagamento, tracking,
  conferma di consegna o rilascio automatico dopo 14 giorni, contestazioni e chargeback che
  bloccano i fondi, rimborsi. Commissioni configurabili (default 5% acquirente, 10% venditore).
- **Venditori**: profilo privato o professionale; per i professionisti dati DSA obbligatori e
  pubblici; verifica d'identità e conto per gli incassi delegati a Stripe.
- **Fiducia e moderazione**: recensioni dopo l'acquisto, segnalazioni, blocco utenti,
  rimozione annunci e sospensioni con motivazione inviata all'interessato (DSA art. 17).
- **Privacy**: esportazione dei dati (GDPR art. 20), cancellazione dell'account in-app con
  anonimizzazione (obbligatoria per App Store e Play Store), immagini ripulite dai metadati GPS.
- **Tempo reale**: WebSocket con Redis pub/sub, funziona con più istanze del server.
- **Notifiche**: email, eventi in tempo reale e push (Expo → APNs/FCM) sui dispositivi registrati.

## API (prefisso `/v1`)

| Area | Endpoint |
|---|---|
| Account | `POST /auth/register` `login` `refresh` `logout` `logout-all` `verify-email` `resend-verification` `forgot-password` `reset-password` `change-password` |
| Profilo | `GET/PATCH /me` · `DELETE /me` · `GET /me/export` · `GET/PUT /me/seller` · `POST /me/seller/onboarding` `/me/seller/refresh` · `PUT /me/push-tokens` · `DELETE /me/push-tokens/:token` · `GET /users/:id` |
| Aste | `GET /categories` · `GET/POST /auctions` · `GET/PATCH/DELETE /auctions/:id` · `POST /auctions/:id/images` `publish` `cancel` · `DELETE /auctions/:id/images/:imageId` · `PUT/DELETE /auctions/:id/watch` |
| Offerte | `POST /auctions/:id/bids` `{ maxAmount, idempotencyKey }` · `GET /auctions/:id/bids` · `GET /me/auctions` `/me/bidding` `/me/watchlist` |
| Ordini | `GET /orders?role=buyer\|seller` · `GET /orders/:id` · `POST /orders/:id/pay` `ship` `confirm-delivery` `dispute` `review` |
| Moderazione | `POST /reports` · `PUT/DELETE /blocks/:id` · `GET /me/blocks` · `GET /admin/reports` · `POST /admin/reports/:id/resolve` · `POST /admin/orders/:id/resolve` |
| Altro | `GET /meta` (commissioni e scadenze) · `POST /webhooks/payments` (Stripe) · `GET /ws` (WebSocket) · `GET /health` |

Autenticazione: `Authorization: Bearer <accessToken>`. Importi sempre in **centesimi interi**.
Errori: `{ "error": { "code": "...", "message": "..." } }` con messaggi in italiano.

## Struttura

```
src/
  app.ts            assemblaggio: helmet, CORS, rate limit, errori, rotte
  index.ts          avvio, migrazioni, job, arresto ordinato
  config.ts         variabili d'ambiente validate (zod)
  jobs.ts           chiusura aste, ordini non pagati, rilascio automatico
  db/               pool, transazioni, migrazioni
  modules/          auth, users, auctions, bidding (motore puro), orders, moderation, realtime
  services/         payments (Stripe/finto), storage (S3/disco), mailer, events (Redis), password
migrations/         schema SQL con vincoli d'integrità
test/               test su PostgreSQL reale, orologio controllabile
```
