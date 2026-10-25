# Sicurezza: minacce e contromisure

Riferimenti: OWASP ASVS 4 (livello 2), OWASP Mobile Top 10, requisiti di App Store e Play Store.

| Minaccia | Contromisura | Dove |
|---|---|---|
| Furto di password dal database | Argon2id (19 MiB, t=2); opzionale blocco delle password già violate (HIBP, k-anonymity) | `services/password.ts` |
| Furto di token dal database | Nel DB solo l'hash SHA-256 di access, refresh e link email | `modules/auth.ts` |
| Token rubato dal telefono | Access token da 15 minuti; refresh a rotazione; il riuso di un refresh già usato revoca tutta la catena | `modules/auth.ts`, test |
| Brute force sul login | Limite per IP (10/min sulle rotte di accesso) e blocco account per 15 minuti dopo 10 errori | `app.ts`, `modules/auth.ts` |
| Scoprire chi è registrato | Registrazione e "password dimenticata" rispondono sempre uguale; tempi uniformati anche per email inesistenti | `modules/auth.ts` |
| Accesso a dati altrui (IDOR) | Ogni rotta verifica il proprietario; risposte 404 invece di 403 per non rivelare l'esistenza | tutti i moduli, test |
| SQL injection | Solo query parametrizzate; ordinamenti da elenco chiuso validato | `modules/*.ts` |
| Input malformati | Validazione con zod su ogni corpo, query e parametro; limite di 64 KB sul corpo | `lib/http.ts` |
| File caricati malevoli | Ricodifica completa con sharp (WebP), limite 10 MB e 50 Mpx, nomi generati dal server | `modules/auctions.ts` |
| Privacy delle foto | Rimozione di tutti i metadati EXIF, posizione GPS inclusa | `modules/auctions.ts`, test |
| Manipolazione delle aste | Offerte in transazione con lock di riga; massimo segreto e riserva mai esposti; idempotenza | `modules/auctions.ts`, `bidding.ts` |
| Sniping | Proroga di 2 minuti per offerte negli ultimi 2 minuti | `modules/auctions.ts` |
| Frodi sui pagamenti | Dati delle carte solo presso Stripe (PCI DSS); webhook firmati e idempotenti; importo pagato verificato; fondi trattenuti fino alla consegna; chargeback bloccano il rilascio | `modules/orders.ts`, `services/payments.ts` |
| Pagamenti doppi | Un solo PaymentIntent per ordine; chiavi di idempotenza su pagamenti, transfer e rimborsi | `services/payments.ts` |
| Venditori fraudolenti | Verifica d'identità (KYC) di Stripe prima di poter pubblicare; segnalazioni, sospensioni, blocchi | `modules/users.ts`, `moderation.ts` |
| Clickjacking, sniffing, downgrade | Helmet: CSP restrittiva, `frame-ancestors 'none'`, `nosniff`, HSTS in produzione | `app.ts` |
| Segreti nei log | Redazione di Authorization, cookie, firme, password e token | `app.ts` |
| Configurazione insicura in produzione | Il server non parte senza Stripe, Redis, S3, SMTP e HTTPS | `config.ts` |
| Dipendenze vulnerabili | `npm audit` e CodeQL in CI a ogni modifica e ogni settimana | `.github/workflows/aste-server.yml` |
| Abuso delle risorse | Rate limit globale (300/min) e per azione; WebSocket con max 50 iscrizioni e 4 KB per messaggio | `app.ts`, `realtime.ts` |
| Tracciabilità | Registro di audit per accessi, cambi password, pubblicazioni, moderazione, pagamenti | tabella `audit_log` |

## Da fare prima del lancio

- Penetration test esterno e revisione del codice da terzi.
- 2FA (TOTP o passkey), almeno per amministratori e venditori professionali.
- WAF e protezione DDoS davanti al server (es. Cloudflare), backup cifrati con test di ripristino.
- Monitoraggio errori e allarmi (es. Sentry), conservazione e rotazione del registro di audit.
- Moderazione automatica delle immagini e controllo delle categorie vietate.
- Lato app: token nel portachiavi sicuro del sistema (Keychain/Keystore), certificate pinning
  valutato, nessun dato sensibile nei log, offuscamento della build Android.
