# Percorso verso App Store e Play Store

## Fase 1 — Server ✅

Vedi [`server/README.md`](../server/README.md).

## Fase 2 — App (Expo / React Native)

Un solo codice per iOS, Android e web.

- Navigazione: home con aste in chiusura e categorie, ricerca, dettaglio con galleria e conto alla
  rovescia, offerta con tastiera numerica e conferma, storico offerte, aggiornamenti in tempo reale.
- Vendita: creazione guidata con fotocamera, profilo venditore, verifica Stripe in pagina ospitata.
- Acquisti: pagamento con Stripe Payment Sheet (carte, Apple Pay, Google Pay), tracking, conferma
  di consegna, contestazioni, recensioni.
- Account: verifica email con deep link, password dimenticata, notifiche push (Expo), preferiti,
  blocchi e segnalazioni, esportazione dati, **eliminazione account dall'app**.
- Accesso con Apple e Google (se si offre Google, Apple richiede anche "Accedi con Apple").
- Accessibilità (VoiceOver/TalkBack, contrasto, testo dinamico), tema scuro, italiano e inglese.

## Fase 3 — Pubblicazione

### Cosa serve da te (non posso farlo io)

| Cosa | Note |
|---|---|
| Società o partita IVA | Serve per incassare commissioni e per i contratti con Stripe e gli store |
| Apple Developer Program | 99 $/anno; per un'azienda serve il numero D-U-N-S (gratuito, qualche giorno) |
| Google Play Console | 25 $ una tantum; gli account personali nuovi devono fare un test chiuso con 12 tester per 14 giorni prima della pubblicazione |
| Account Stripe | Attivazione di Connect per piattaforme, verifica della società |
| Dominio, email, hosting in UE | Es. server su Hetzner/Scaleway/AWS Milano, PostgreSQL gestito, Redis, S3 |
| Revisione legale | Termini, privacy, regolamento: preparo le bozze, un avvocato deve validarle |

### Obblighi legali (UE e Italia)

- **GDPR**: informativa privacy, registro dei trattamenti, nomina dei responsabili (Stripe,
  hosting, email), DPIA consigliata, cookie banner per la versione web.
- **Digital Services Act**: punto di contatto, meccanismo di segnalazione, motivazione delle
  rimozioni, tracciabilità dei venditori professionali (art. 30), trasparenza sul sistema di
  ranking, relazione annuale sulla moderazione.
- **Codice del Consumo e direttiva Omnibus**: indicare se il venditore è professionista; per i
  professionisti diritto di recesso di 14 giorni e garanzia legale di 2 anni. Nota: le aste online
  non sono "aste pubbliche" ai fini del recesso, quindi il recesso si applica.
- **DAC7** (D.Lgs. 32/2023): comunicazione annuale all'Agenzia delle Entrate dei dati e degli incassi
  dei venditori oltre le soglie (30 vendite o 2.000 € l'anno).
- **Fatturazione**: le commissioni della piattaforma vanno fatturate (fattura elettronica SDI).
- **Oggetti vietati**: armi, farmaci, animali, contraffazioni, beni culturali senza autorizzazione.

### Requisiti degli store

- Account eliminabile dall'app (fatto lato server).
- Contenuti generati dagli utenti: segnalazione, blocco, moderazione, contatti (fatto lato server).
- Beni fisici: si paga con Stripe, non con gli acquisti in-app di Apple/Google (consentito).
- Privacy: "Privacy Nutrition Label" (Apple) e "Data safety" (Google) da compilare.
- Età: classificazione 17+/PEGI per la presenza di compravendite tra utenti.

### Promozione

- Scheda store: nome, sottotitolo e parole chiave (ASO), 6–8 screenshot, video di 30 secondi.
- Sito vetrina con landing page, link agli store, blog e pagine per categoria (SEO).
- Lancio su una nicchia (es. collezionismo, orologi o fotografia) prima di allargare.
- Commissioni azzerate per i primi venditori, programma "invita un amico".
- Social (Instagram/TikTok con le aste più interessanti), collaborazioni con community di collezionisti.
- Campagne Apple Search Ads e Google App Campaigns, a budget limitato, misurando il costo per utente attivo.
