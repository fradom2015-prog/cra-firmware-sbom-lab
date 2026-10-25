# App (iOS, Android, web)

Expo SDK 58, React Native 0.88, Expo Router, TanStack Query, Stripe React Native.

```bash
cp .env.example .env          # EXPO_PUBLIC_API_URL: indirizzo del server
npm install
npm run web                   # nel browser
npm run ios / npm run android # serve una development build (moduli nativi: Stripe, notifiche)
npm run typecheck && npm run lint && npm test && npm run audit
```

## Schermate

| Scheda / percorso | Contenuto |
|---|---|
| Esplora | Categorie, aste in chiusura, nuovi arrivi |
| Cerca | Ricerca full-text, filtro per categoria, ordinamenti, scorrimento infinito |
| Vendi | Le tue aste, stato del profilo venditore, nuova asta |
| Attività | Offerte, preferiti, acquisti, vendite (con azioni richieste evidenziate) |
| Profilo | Profilo pubblico, venditore, impostazioni, utenti bloccati, assistenza, documenti legali |
| `auction/[id]` | Galleria, prezzo e conto alla rovescia in tempo reale, riserva, offerta automatica con importi suggeriti e riepilogo del costo totale, storico, venditore privato/professionale con i diritti del consumatore, preferiti, segnalazione |
| `sell/new` | Foto da fotocamera o galleria (max 10), dati, commissione mostrata prima di pubblicare, bozze |
| `sell/seller-profile` | Privato o professionista (dati DSA), verifica identità e IBAN su Stripe |
| `order/[id]` | Riepilogo importi, avanzamento, pagamento (Payment Sheet: carta, Apple Pay, Google Pay), spedizione con tracking, conferma consegna, contestazione, recensione |
| `settings` | Nome utente, password, esci ovunque, esporta dati, **elimina account** |
| `verify-email`, `reset-password` | Aperte dai link nelle email (universal link / app link) |

## Sicurezza

- Refresh token nel portachiavi del sistema (Keychain/Keystore, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`),
  access token solo in memoria; un solo rinnovo alla volta (il server ruota i token e rileva i riusi).
- Nessun dato di carta nell'app: Payment Sheet di Stripe.
- Foto senza EXIF già dal selettore; il server le ricodifica comunque.
- Notifiche push con solo la prima riga del messaggio, niente dettagli sulla schermata di blocco.
- Android: niente backup automatico dei dati dell'app, permessi di posizione e microfono bloccati.
- iOS: privacy manifest, nessun tracciamento.

## Web

La versione web usa lo stesso codice. Il pagamento non è disponibile dal browser (il modulo
Stripe per React Native è solo nativo): l'utente viene invitato a completarlo dall'app.
Sul web il refresh token sta in `localStorage`; per un sito pubblico in produzione è meglio
un cookie `HttpOnly` (da aggiungere al server).

## Build e pubblicazione (EAS)

```bash
npx eas-cli@latest login
npx eas-cli@latest init                       # crea il progetto e imposta EAS_PROJECT_ID
npx eas-cli@latest build --profile preview    # build interne per i tester
npx eas-cli@latest build --profile production
npx eas-cli@latest submit --platform ios      # App Store Connect / TestFlight
npx eas-cli@latest submit --platform android  # Google Play (traccia interna)
```

Prima della prima build: sostituire in `app.config.ts` e `eas.json` bundle id, merchant id
Apple Pay, indirizzi del server e chiave pubblicabile Stripe; aggiungere icone e splash definitivi;
pubblicare sul dominio del server i file `apple-app-site-association` e `assetlinks.json` per i link
dalle email.

## Test

- `__tests__/`: formati, scaglioni di rilancio, client API (rinnovo sessione, avvio a freddo, errori).
- [`../e2e/`](../e2e/): prova completa nel browser contro il server vero.
