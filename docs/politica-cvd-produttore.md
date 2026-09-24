# Modello di politica CVD per un produttore di dispositivi connessi

Modello di politica di divulgazione coordinata delle vulnerabilità (CVD) per un produttore soggetto al
Cyber Resilience Act. Copre i requisiti dell'Allegato I, parte II (punti 5 e 6) e il processo
necessario per rispettare le scadenze di notifica dell'articolo 14. Le parti tra `[parentesi]` vanno
adattate all'azienda.

## 1. Ambito

La politica copre tutti i prodotti con elementi digitali di [Azienda] ancora nel periodo di supporto
dichiarato: firmware dei dispositivi, app mobile, servizi cloud di gestione e relative API.

## 2. Come segnalare

- Email: `security@[dominio]`, cifrabile con la chiave PGP pubblicata in `https://[dominio]/pgp-key.txt`
- Modulo web: `https://[dominio]/security/report`
- Riferimento automatico: `https://[dominio]/.well-known/security.txt` (RFC 9116)

Indicare prodotto, versione firmware, passaggi per riprodurre e impatto atteso.

## 3. I nostri impegni

| Fase | Tempo massimo |
|---|---|
| Conferma di ricezione | 3 giorni lavorativi |
| Valutazione iniziale, gravità CVSS, prodotti colpiti | 10 giorni lavorativi |
| Aggiornamenti periodici al segnalante | ogni 14 giorni |
| Correzione | Critica 30 giorni, Alta 60, Media 90, Bassa al rilascio successivo |
| Divulgazione pubblica | concordata; di norma 90 giorni dalla segnalazione o al rilascio della correzione |

## 4. Porto sicuro

Non intraprendiamo azioni legali contro chi, in buona fede, segnala una vulnerabilità rispettando questa
politica: senza accedere a dati di terzi oltre il minimo necessario a dimostrare il problema, senza
degradare i servizi e senza divulgare i dettagli prima della data concordata.

## 5. Processo interno (PSIRT)

1. **Registrazione**: ogni segnalazione riceve un identificativo interno e un responsabile.
2. **Triage**: riproduzione, versioni colpite (tramite SBOM di ogni release), punteggio CVSS.
3. **Verifica dello sfruttamento attivo**: telemetria dei dispositivi, segnalazioni dei clienti,
   catalogo CISA KEV, threat intelligence.
   *Se la vulnerabilità risulta attivamente sfruttata, parte subito il processo di notifica CRA (sezione 6).*
4. **Correzione**: patch, test di regressione, build firmata, rilascio OTA.
5. **Comunicazione**: advisory pubblico (anche in formato CSAF), identificativo CVE, documento VEX per
   le versioni non colpite, ringraziamento al segnalante.
6. **Retrospettiva**: causa radice e controllo preventivo (regola SAST, test, requisito di design).

## 6. Notifiche obbligatorie (CRA, articolo 14)

Tramite la Single Reporting Platform di ENISA, verso il CSIRT coordinatore competente:

| Evento | Preallarme | Notifica | Relazione finale |
|---|---|---|---|
| Vulnerabilità attivamente sfruttata | 24 ore | 72 ore | 14 giorni dalla disponibilità della correzione |
| Incidente grave che impatta la sicurezza del prodotto | 24 ore | 72 ore | 1 mese dalla notifica |

Gli utenti colpiti vengono informati dell'evento e delle misure di mitigazione disponibili.

## 7. Aggiornamenti di sicurezza

- Distribuiti gratuitamente per tutto il periodo di supporto, di norma separati dagli aggiornamenti funzionali.
- Firmati e verificati dal dispositivo prima dell'installazione.
- Installati automaticamente di default, con possibilità di disattivazione per l'utente.
- Ogni aggiornamento resta disponibile per almeno 10 anni o fino alla fine del periodo di supporto, se più lungo.

## 8. Riferimenti

- Regolamento (UE) 2024/2847 (Cyber Resilience Act), articoli 13 e 14, Allegato I parte II
- ISO/IEC 29147 (divulgazione delle vulnerabilità) e ISO/IEC 30111 (gestione interna)
- ETSI EN 303 645, disposizione 5.2
- RFC 9116 (`security.txt`), OASIS CSAF 2.0, CycloneDX VEX
