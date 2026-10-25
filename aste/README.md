# Aste online

Piattaforma di aste tra privati e professionisti, con pagamento protetto: il compratore paga
in app, il venditore riceve i soldi solo dopo la consegna. Modello ispirato a Catawiki ed eBay.

| Parte | Stato | Dove |
|---|---|---|
| Server API (Node, TypeScript, PostgreSQL, Redis, Stripe Connect) | ✅ Fase 1 | [`server/`](server/) |
| App iOS / Android / web (Expo) | ✅ Fase 2 | [`app/`](app/) |
| Pubblicazione sugli store, documenti legali | Fase 3 | [`docs/roadmap.md`](docs/roadmap.md) |

- [Prova end-to-end nel browser](e2e/)
- [Sicurezza: minacce e contromisure](docs/sicurezza.md)
- [Percorso verso App Store e Play Store, adempimenti legali](docs/roadmap.md)

Il prototipo iniziale senza dipendenze è nella cronologia git (commit "Aste online: prima soluzione").
