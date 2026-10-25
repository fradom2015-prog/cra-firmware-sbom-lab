# Prova end-to-end

Usa l'app web vera contro il server vero (PostgreSQL e Redis), con due utenti in un browser
Chromium a dimensione telefono: registrazione e verifica email, profilo venditore e verifica
pagamenti (simulata), asta con due foto, offerta automatica, aggiornamento in tempo reale sul
telefono del venditore, ricerca, chiusura dell'asta, ordine e schermata di pagamento.

```bash
# 1. server (database vuoto, email nel log)
cd aste/server && npm run build
DATABASE_URL=postgres://postgres@127.0.0.1:5432/aste_dev REDIS_URL=redis://127.0.0.1:6379 \
  PORT=3000 API_URL=http://localhost:3000 PUBLIC_URL=http://localhost:8090 CORS_ORIGINS=http://localhost:8090 \
  node dist/index.js > /tmp/aste-server.log &

# 2. app web
cd ../app && EXPO_PUBLIC_API_URL=http://localhost:3000 npx expo export --platform web
npx serve -s dist -l 8090 &

# 3. prova (richiede playwright: npm i -g playwright && npx playwright install chromium)
cd ../e2e && SERVER_LOG=/tmp/aste-server.log DATABASE_URL=postgres://postgres@127.0.0.1:5432/aste_dev node app.e2e.cjs
```

Gli screenshot finiscono in `e2e/screenshots/`.
