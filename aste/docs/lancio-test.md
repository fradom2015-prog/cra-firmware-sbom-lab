# Dalla repository ai telefoni: server online, build di prova, TestFlight

Tempo indicativo: 1–2 giorni di lavoro tuo, più le attese di Apple (verifica account) e
Google (test chiuso di 14 giorni per gli account personali nuovi).
Costi fissi per partire: dominio ~10 €/anno, server ~5–8 €/mese, Apple 99 $/anno, Google 25 $ una tantum.

Legenda: 👤 = lo fai tu (account, pagamenti, identità) · 🤖 = posso farlo io se mi dai accesso o i valori.

---

## 1. Account da aprire (👤, in parallelo, alcuni richiedono giorni)

| Servizio | Cosa serve | Note |
|---|---|---|
| **Apple Developer Program** | developer.apple.com/programs → Enroll | Come azienda serve il numero **D-U-N-S** (gratuito, fino a 1–2 settimane). Come persona fisica è più veloce ma sullo store comparirà il tuo nome. |
| **Google Play Console** | play.google.com/console | 25 $. Verifica identità. Gli account **personali** creati di recente devono fare un **test chiuso con almeno 12 tester per 14 giorni** prima della pubblicazione; gli account **organizzazione** no. |
| **Expo** | expo.dev/signup | Gratuito per iniziare (build in coda), piano a pagamento per build più rapide. |
| **Stripe** | dashboard.stripe.com | Per la prova basta la **modalità test** (nessuna verifica). Attiva **Connect** (Settings → Connect) con account **Express**. |
| **Dominio** | es. Aruba, Register.it, OVH, Cloudflare | Es. `aste.tuodominio.it`. |
| **Server** | es. Hetzner CX22 (Germania/Finlandia), Scaleway, Aruba Cloud | Ubuntu 24.04, 2 vCPU, 4 GB RAM bastano per la prova. Dati in UE (GDPR). |
| **Email** | es. Brevo, Postmark, Amazon SES | Servono record SPF e DKIM sul dominio, altrimenti le email finiscono in spam. |

## 2. Server online (👤 accessi, 🤖 configurazione)

1. Nel DNS del dominio crea un record **A** `aste` → IP del server.
2. Sul server:
   ```bash
   # Docker e firewall: solo SSH, HTTP e HTTPS
   curl -fsSL https://get.docker.com | sh
   ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable

   git clone <repository> /opt/aste && cd /opt/aste/aste/deploy
   cp .env.example .env && nano .env      # DOMAIN, POSTGRES_PASSWORD, chiavi Stripe, SMTP…
   docker compose up -d --build
   docker compose logs -f app             # attendi "Server listening"
   ```
3. Apri `https://aste.tuodominio.it`: compare la versione web dell'app (certificato HTTPS automatico).
4. **Stripe webhook**: Developers → Webhooks → Add endpoint `https://aste.tuodominio.it/v1/webhooks/payments`
   con gli eventi `payment_intent.succeeded`, `account.updated`, `charge.dispute.created`.
   Copia il segreto `whsec_…` in `.env` (`STRIPE_WEBHOOK_SECRET`) e `docker compose up -d`.
5. Registrati dalla versione web, conferma l'email, poi rendi amministratore il tuo account:
   ```bash
   docker compose exec app node dist/scripts/make-admin.js tua@email.it
   ```
6. **Backup** giornaliero: `crontab -e` → `15 3 * * * /opt/aste/aste/deploy/backup.sh`.
   Copia i backup anche fuori dal server (es. `rclone` verso uno storage diverso) e prova un ripristino:
   `docker compose exec -T postgres pg_restore -U aste -d aste --clean < db-AAAAMMGG-HHMM.dump`.

## 3. Configurazione dell'app (🤖 se mi dai i valori)

In `app/eas.json` sostituisci `aste.tuodominio.it` e la chiave `pk_test_…`.
In `app/app.config.ts` (o con variabili d'ambiente EAS) verifica:

- `APP_BUNDLE_ID`: identificativo unico, es. `it.tuaazienda.aste` (non si cambia più dopo la pubblicazione).
- `APPLE_MERCHANT_ID`: `merchant.<bundle id>` per Apple Pay.

```bash
cd app
npx eas-cli@latest login
npx eas-cli@latest init          # crea il progetto Expo; copia l'id in EAS_PROJECT_ID
                                 # (eas.json → build.*.env, oppure app.config.ts → extra.eas.projectId)
```

## 4. iPhone: TestFlight (👤 account Apple, 🤖 comandi)

1. App Store Connect → **Apps → +** → nuova app con il bundle id scelto (nome, lingua italiano, SKU).
2. Developer → Identifiers: sul bundle id abilita **Associated Domains**, **Push Notifications**,
   **Apple Pay** (crea anche il Merchant ID e collegalo al certificato Apple Pay in Stripe:
   Settings → Payment methods → Apple Pay).
3. Build e invio:
   ```bash
   npx eas-cli@latest build -p ios --profile production   # EAS crea certificati e profili
   npx eas-cli@latest submit -p ios --latest              # carica su App Store Connect
   ```
4. In App Store Connect → TestFlight: aggiungi te stesso come **tester interno** (fino a 100, senza
   revisione Apple). Per tester esterni serve una breve revisione.
5. Nel `.env` del server metti `APPLE_TEAM_ID` (Membership → Team ID) e riavvia: i link nelle email
   apriranno l'app. Per le notifiche push iOS, EAS carica la chiave APNs alla prima build
   (rispondi "sì" quando la chiede).

## 5. Android: test interno (👤 account Google, 🤖 comandi)

1. Play Console → **Crea app** (nome, italiano, app gratuita, dichiarazioni).
2. Build:
   ```bash
   npx eas-cli@latest build -p android --profile preview      # APK da installare subito sul telefono
   npx eas-cli@latest build -p android --profile production   # AAB per il Play Store
   ```
3. Il **primo** AAB va caricato a mano: Play Console → Test → **Test interno** → Crea release.
   Poi `npx eas-cli@latest submit -p android --latest` (serve una chiave di service account Google).
4. `npx eas-cli@latest credentials -p android` → copia l'impronta **SHA-256** in `ANDROID_CERT_SHA256`
   nel `.env` del server. Aggiungi anche l'impronta della "chiave di firma dell'app" che trovi in
   Play Console → Integrità dell'app, separandole con una virgola.
5. Notifiche push Android: crea un progetto Firebase, scarica la chiave del service account FCM v1 e
   caricala su Expo (`npx eas-cli@latest credentials`).

## 6. Cosa provare sui telefoni

| Scenario | Come |
|---|---|
| Registrazione e link email | Il link di conferma deve aprire **l'app**, non il browser |
| Offerte tra due telefoni | Il prezzo si aggiorna sull'altro telefono senza ricaricare |
| Notifica "sei stato superato" | Arriva anche ad app chiusa; toccandola si apre l'asta |
| Foto | Scatto dalla fotocamera e galleria; permessi negati → messaggio chiaro |
| Pagamento | Carta di test `4242 4242 4242 4242`, scadenza futura, CVC qualsiasi; Apple Pay/Google Pay in modalità test |
| Pagamento rifiutato | Carta `4000 0000 0000 9995` (fondi insufficienti) |
| 3D Secure | Carta `4000 0027 6000 3184` |
| Verifica venditore | Onboarding Stripe di test: usa i dati di prova suggeriti da Stripe |
| Spedizione → conferma → incasso | Il transfer compare in Stripe → Connect → account del venditore |
| Eliminazione account | Impostazioni → Elimina: l'accesso successivo deve fallire |
| Accessibilità | VoiceOver (iOS) e TalkBack (Android) su asta e offerta |
| Rete assente | Modalità aereo: messaggi d'errore comprensibili, nessun crash |

Le segnalazioni dei tester arrivano in TestFlight (screenshot con commento) e in Play Console.

## 7. Prima di passare ai pagamenti reali

- Revisione legale di termini, privacy e regole (bozze in `app/src/content/legal.ts`).
- Stripe in modalità live: verifica della società, chiavi `sk_live_`/`pk_live_`, nuovo webhook.
- Penetration test e le altre voci "Da fare prima del lancio" in [sicurezza.md](sicurezza.md).
- Monitoraggio errori (es. Sentry) e allarmi sul server.
