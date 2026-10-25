// BOZZE da far validare a un legale prima della pubblicazione.
// I campi tra [PARENTESI QUADRE] vanno compilati con i dati della società.

export interface LegalDoc {
  title: string;
  updated: string;
  sections: { heading: string; body: string }[];
}

const OPERATOR = '[RAGIONE SOCIALE], [SEDE LEGALE], P. IVA [NUMERO], email [EMAIL], PEC [PEC]';

export const LEGAL: Record<string, LegalDoc> = {
  termini: {
    title: 'Termini e condizioni',
    updated: 'Versione 2026-10 (bozza)',
    sections: [
      { heading: '1. Chi siamo', body: `Il servizio "Aste" è gestito da ${OPERATOR} ("noi"). Siamo una piattaforma che mette in contatto venditori e acquirenti: non siamo parte del contratto di vendita, che si conclude direttamente tra loro.` },
      { heading: '2. Account', body: 'Per offrire o vendere devi avere almeno 18 anni, fornire un indirizzo email valido e confermarlo. Sei responsabile della riservatezza delle tue credenziali e delle attività svolte con il tuo account. Un solo account per persona, salvo autorizzazione.' },
      { heading: '3. Come funzionano le aste', body: "Ogni asta ha una base d'asta, una durata e, facoltativamente, un prezzo di riserva non visibile. Con l'offerta automatica indichi il massimo che sei disposto a pagare: il sistema rilancia per te del minimo necessario, secondo gli scaglioni indicati nell'app. A parità di massimo prevale l'offerta arrivata prima. Un'offerta negli ultimi 2 minuti prolunga l'asta di 2 minuti. Le offerte sono vincolanti e non si possono ritirare. Alla chiusura, se il prezzo di riserva è raggiunto, il miglior offerente si aggiudica l'oggetto e il contratto di vendita si conclude." },
      { heading: '4. Pagamento protetto', body: "L'acquirente paga nell'app entro 3 giorni dalla chiusura. Il pagamento è gestito da Stripe Payments Europe Ltd.; non conserviamo i dati delle carte. L'importo viene trasferito al venditore solo dopo la conferma di consegna dell'acquirente o, in assenza di contestazioni, 14 giorni dopo la spedizione. In caso di mancato pagamento l'ordine viene annullato e l'account dell'acquirente può essere limitato." },
      { heading: '5. Commissioni', body: "La pubblicazione è gratuita. Il venditore paga una commissione sul prezzo di aggiudicazione; l'acquirente paga una commissione di protezione acquisti. Le percentuali in vigore sono indicate nell'app prima di pubblicare e prima di ogni offerta." },
      { heading: '6. Obblighi del venditore', body: "Il venditore garantisce di avere il diritto di vendere l'oggetto, lo descrive in modo veritiero e completo (difetti inclusi), lo spedisce entro 5 giorni lavorativi dal pagamento con un servizio tracciato e lo imballa con cura. I venditori professionali forniscono i dati richiesti dal Regolamento (UE) 2022/2065 (DSA) e rispettano il Codice del Consumo, incluso il diritto di recesso di 14 giorni e la garanzia legale di conformità di 24 mesi." },
      { heading: '7. Acquisti da privati e da professionisti', body: "Ogni annuncio indica se il venditore è un privato o un professionista. Negli acquisti da privati non si applicano il diritto di recesso e la garanzia legale del Codice del Consumo; resta la tutela del pagamento protetto per mancata consegna o oggetto non conforme alla descrizione." },
      { heading: '8. Contestazioni', body: "Se l'oggetto non arriva o non corrisponde alla descrizione, l'acquirente apre una contestazione dall'app prima di confermare la consegna. Il pagamento resta bloccato finché la verifichiamo; possiamo chiedere prove a entrambe le parti e disporre il rimborso o il rilascio dei fondi." },
      { heading: '9. Contenuti e oggetti vietati', body: "È vietato pubblicare gli oggetti e i contenuti elencati nelle Regole della community. Possiamo rimuovere annunci, limitare o sospendere account che violano questi termini o la legge, comunicando la motivazione e la possibilità di contestare la decisione." },
      { heading: '10. Responsabilità', body: "Rispondiamo del corretto funzionamento della piattaforma secondo la legge. Non rispondiamo della qualità, sicurezza o liceità degli oggetti, né dell'esecuzione del contratto tra le parti, salvo quanto previsto dal pagamento protetto e dalle norme inderogabili a tutela dei consumatori." },
      { heading: '11. Recesso dal servizio', body: "Puoi eliminare il tuo account in qualsiasi momento dalle impostazioni, dopo aver concluso aste e ordini in corso." },
      { heading: '12. Legge applicabile e reclami', body: "Si applica la legge italiana, fatte salve le norme più favorevoli del paese di residenza del consumatore. Reclami: [EMAIL]. Il consumatore può rivolgersi al foro del proprio luogo di residenza e agli organismi di risoluzione alternativa delle controversie." },
      { heading: '13. Modifiche', body: "Possiamo modificare questi termini con un preavviso di almeno 15 giorni via email e nell'app. Se non accetti le modifiche puoi chiudere l'account." },
    ],
  },
  privacy: {
    title: 'Informativa privacy',
    updated: 'Versione 2026-10 (bozza)',
    sections: [
      { heading: 'Titolare del trattamento', body: `${OPERATOR}. Responsabile della protezione dei dati (se nominato): [DPO EMAIL].` },
      { heading: 'Quali dati trattiamo', body: "Dati dell'account (email, nome utente, password cifrata con Argon2id); dati del profilo venditore (nome, indirizzo, codice fiscale o partita IVA, contatti aziendali); annunci, foto (senza metadati di posizione), offerte, ordini, indirizzo di spedizione, recensioni, segnalazioni; dati tecnici (indirizzo IP, modello del dispositivo, token per le notifiche) e registri di sicurezza." },
      { heading: 'Perché e su quale base', body: "Fornire il servizio e gestire aste e pagamenti (esecuzione del contratto, art. 6.1.b GDPR); sicurezza, prevenzione delle frodi e moderazione (legittimo interesse, art. 6.1.f); adempimenti fiscali e normativi, inclusa la comunicazione dei dati dei venditori all'Agenzia delle Entrate prevista dalla direttiva DAC7 e gli obblighi del DSA (obbligo legale, art. 6.1.c); notifiche promozionali solo con il tuo consenso (art. 6.1.a)." },
      { heading: 'Con chi li condividiamo', body: "Con l'altra parte della transazione nella misura necessaria (es. l'indirizzo di spedizione al venditore, solo dopo il pagamento); con i nostri fornitori, nominati responsabili del trattamento: Stripe (pagamenti e verifica dell'identità dei venditori), [HOSTING] (server in UE), [EMAIL PROVIDER] (invio email), Expo (notifiche push); con le autorità quando previsto dalla legge. Non vendiamo i tuoi dati e non li usiamo per pubblicità di terzi." },
      { heading: 'Trasferimenti fuori dall\'UE', body: "I dati sono conservati nell'Unione europea. Alcuni fornitori possono trattarli negli Stati Uniti sulla base del Data Privacy Framework UE-USA o delle clausole contrattuali standard." },
      { heading: 'Per quanto tempo', body: "Dati dell'account: fino alla cancellazione. Dati di ordini e fatturazione: 10 anni (art. 2220 c.c.). Registri di sicurezza: 12 mesi. Dopo la cancellazione dell'account i dati personali vengono anonimizzati, salvo quelli da conservare per legge." },
      { heading: 'I tuoi diritti', body: "Accesso, rettifica, cancellazione, limitazione, opposizione e portabilità (artt. 15-22 GDPR). Puoi esportare i tuoi dati ed eliminare l'account direttamente dalle impostazioni dell'app, o scriverci a [EMAIL]. Puoi proporre reclamo al Garante per la protezione dei dati personali (garanteprivacy.it)." },
      { heading: 'Sicurezza', body: "Connessioni cifrate, password e token conservati solo come hash, sessioni sul telefono custodite nel portachiavi sicuro del sistema, accessi limitati e registrati, dati delle carte gestiti esclusivamente da Stripe (certificato PCI DSS)." },
    ],
  },
  regole: {
    title: 'Regole della community',
    updated: 'Versione 2026-10 (bozza)',
    sections: [
      { heading: 'Oggetti vietati', body: "Armi, munizioni ed esplosivi; droghe, farmaci e dispositivi medici soggetti a prescrizione; animali vivi; prodotti contraffatti o repliche; beni rubati; beni culturali senza la documentazione richiesta dal Codice dei beni culturali; alcolici e tabacchi; documenti d'identità, conti e credenziali; materiale pornografico; prodotti richiamati o pericolosi; tutto ciò che è illegale in Italia o nel paese dell'acquirente." },
      { heading: 'Annunci onesti', body: "Foto reali dell'oggetto in vendita, descrizione completa di difetti e mancanze, categoria corretta. Niente rimandi a pagamenti o contatti fuori dall'app: le transazioni fuori dalla piattaforma non sono protette." },
      { heading: 'Offerte corrette', body: "Vietato fare offerte sulle proprie aste o farle fare ad altri per alzare il prezzo (shill bidding), accordarsi tra offerenti, non pagare un oggetto vinto." },
      { heading: 'Rispetto', body: "Niente insulti, minacce, discriminazioni o molestie nelle descrizioni, nelle recensioni e nei messaggi." },
      { heading: 'Segnalazioni e provvedimenti', body: "Puoi segnalare annunci e utenti dall'app. Esaminiamo ogni segnalazione e, se interveniamo (rimozione, limitazione o sospensione), comunichiamo all'interessato la motivazione e come contestarla, come previsto dal Digital Services Act." },
    ],
  },
};
