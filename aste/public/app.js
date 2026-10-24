const view = document.getElementById('view');
let me = null;
let current = { name: null, id: null }; // vista attiva, per applicare gli eventi in tempo reale

// --- utilità -------------------------------------------------------------

// Crea elementi DOM; il testo passa sempre da textContent, quindi niente XSS.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const euro = (cents) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const toCents = (text) => Math.round(Number(String(text).replace(',', '.')) * 100);
const dateTime = (ms) => new Date(ms).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });

function remaining(endsAt) {
  const s = Math.floor((endsAt - Date.now()) / 1000);
  if (s <= 0) return 'Conclusa';
  const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600);
  const mm = Math.floor((s % 3600) / 60), ss = s % 60;
  if (d > 0) return `${d}g ${hh}h ${mm}m`;
  if (hh > 0) return `${hh}h ${mm}m ${ss}s`;
  return `${mm}m ${String(ss).padStart(2, '0')}s`;
}

function countdown(endsAt) {
  return h('span', { class: 'countdown', dataset: { ends: endsAt } }, remaining(endsAt));
}

let toastTimer;
function toast(msg, kind = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 3500);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? {} : await res.json();
  if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
  return data;
}

// --- sessione ------------------------------------------------------------

function renderNav() {
  document.getElementById('nav-new').hidden = !me;
  document.getElementById('nav-logout').hidden = !me;
  document.getElementById('nav-login').hidden = !!me;
  const u = document.getElementById('nav-user');
  u.hidden = !me;
  u.textContent = me ? `Ciao, ${me.username}` : '';
}

document.getElementById('nav-logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  me = null;
  renderNav();
  toast('Sei uscito');
  route();
});

// --- viste ---------------------------------------------------------------

function priceOf(a) {
  return a.currentPrice ?? a.startingPrice;
}

function auctionCard(a) {
  return h('a', { class: 'card', href: `#/auction/${a.id}`, dataset: { auction: a.id } },
    h('h3', {}, a.title),
    h('div', { class: 'price' }, euro(priceOf(a))),
    h('div', { class: 'meta' },
      h('span', {}, a.bidCount === 1 ? '1 offerta' : `${a.bidCount} offerte`),
      a.status === 'open' ? countdown(a.endsAt) : h('span', {}, a.winner ? `Vinta da ${a.winner}` : 'Nessuna offerta')),
    h('div', { class: 'seller' }, `Venditore: ${a.seller}`));
}

async function listView(status) {
  current = { name: 'list', status };
  const { auctions } = await api(`/api/auctions?status=${status}`);
  view.replaceChildren(
    h('h1', {}, status === 'open' ? 'Aste in corso' : 'Aste concluse'),
    auctions.length
      ? h('div', { class: 'grid' }, auctions.map(auctionCard))
      : h('p', { class: 'empty' }, status === 'open' ? 'Nessuna asta in corso. Creane una!' : 'Nessuna asta conclusa.'));
}

async function detailView(id) {
  current = { name: 'detail', id };
  const { auction, bids } = await api(`/api/auctions/${id}`);
  renderDetail(auction, bids);
}

function renderDetail(a, bids) {
  const open = a.status === 'open';
  const isSeller = me && me.username === a.seller;
  const isLeader = me && me.username === a.leader;

  let action;
  if (!open) {
    action = h('p', { class: 'notice' }, a.winner ? `Asta conclusa: vince ${a.winner} con ${euro(a.currentPrice)}` : 'Asta conclusa senza offerte');
  } else if (!me) {
    action = h('p', { class: 'notice' }, h('a', { href: '#/login' }, 'Accedi'), ' per fare un\'offerta');
  } else if (isSeller) {
    action = h('p', { class: 'notice' }, 'Questa è la tua asta');
  } else if (isLeader) {
    action = h('p', { class: 'notice ok' }, 'Sei il miglior offerente');
  } else {
    const input = h('input', { type: 'text', inputmode: 'decimal', required: true, value: (a.minimumBid / 100).toFixed(2), 'aria-label': 'Importo in euro' });
    action = h('form', { class: 'bid-form', onsubmit: async (e) => {
      e.preventDefault();
      try {
        const res = await api(`/api/auctions/${a.id}/bids`, { method: 'POST', body: { amount: toCents(input.value) } });
        toast('Offerta registrata', 'ok');
        renderDetail(res.auction, res.bids);
      } catch (err) { toast(err.message, 'error'); }
    } }, h('span', {}, '€'), input, h('button', { class: 'btn btn-primary' }, 'Offri'));
  }

  view.replaceChildren(h('article', { class: 'detail' },
    h('a', { href: '#/', class: 'back' }, '← Tutte le aste'),
    h('h1', {}, a.title),
    h('div', { class: 'seller' }, `Venditore: ${a.seller}`),
    h('div', { class: 'panel' },
      h('div', {}, h('div', { class: 'label' }, a.currentPrice == null ? 'Prezzo di partenza' : 'Offerta attuale'),
        h('div', { class: 'price big' }, euro(priceOf(a)))),
      h('div', {}, h('div', { class: 'label' }, open ? 'Chiude tra' : 'Stato'),
        open ? countdown(a.endsAt) : h('span', {}, 'Conclusa'),
        h('div', { class: 'small' }, dateTime(a.endsAt))),
      h('div', {}, h('div', { class: 'label' }, 'Offerta minima'), h('div', {}, open ? euro(a.minimumBid) : '—'))),
    action,
    a.description && h('p', { class: 'description' }, a.description),
    h('h2', {}, `Offerte (${a.bidCount})`),
    bids.length
      ? h('ol', { class: 'bids' }, bids.map((b) => h('li', {}, h('strong', {}, euro(b.amount)), ` — ${b.bidder}`, h('span', { class: 'small' }, dateTime(b.createdAt)))))
      : h('p', { class: 'empty' }, 'Ancora nessuna offerta.')));
}

function newView() {
  current = { name: 'new' };
  if (!me) return (location.hash = '#/login');
  const f = {
    title: h('input', { name: 'title', required: true, minlength: 3, maxlength: 120 }),
    description: h('textarea', { name: 'description', rows: 5, maxlength: 5000 }),
    startingPrice: h('input', { name: 'startingPrice', inputmode: 'decimal', required: true, placeholder: '10,00' }),
    minIncrement: h('input', { name: 'minIncrement', inputmode: 'decimal', required: true, value: '1,00' }),
    duration: h('select', { name: 'duration' },
      [['5', '5 minuti'], ['60', '1 ora'], ['1440', '1 giorno'], ['4320', '3 giorni'], ['10080', '7 giorni']]
        .map(([v, l]) => h('option', { value: v, selected: v === '1440' }, l))),
  };
  view.replaceChildren(h('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault();
    try {
      const { auction } = await api('/api/auctions', { method: 'POST', body: {
        title: f.title.value,
        description: f.description.value,
        startingPrice: toCents(f.startingPrice.value),
        minIncrement: toCents(f.minIncrement.value),
        durationMinutes: Number(f.duration.value),
      } });
      toast('Asta pubblicata', 'ok');
      location.hash = `#/auction/${auction.id}`;
    } catch (err) { toast(err.message, 'error'); }
  } },
  h('h1', {}, 'Nuova asta'),
  h('label', {}, 'Titolo', f.title),
  h('label', {}, 'Descrizione', f.description),
  h('div', { class: 'row' },
    h('label', {}, 'Prezzo di partenza (€)', f.startingPrice),
    h('label', {}, 'Rilancio minimo (€)', f.minIncrement)),
  h('label', {}, 'Durata', f.duration),
  h('button', { class: 'btn btn-primary' }, 'Pubblica')));
}

function loginView() {
  current = { name: 'login' };
  const username = h('input', { autocomplete: 'username', required: true });
  const password = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const submit = (path) => async (e) => {
    e.preventDefault();
    if (!e.target.closest('form').reportValidity()) return;
    try {
      ({ user: me } = await api(path, { method: 'POST', body: { username: username.value, password: password.value } }));
      renderNav();
      toast(`Benvenuto, ${me.username}`, 'ok');
      location.hash = '#/';
    } catch (err) { toast(err.message, 'error'); }
  };
  view.replaceChildren(h('form', { class: 'form narrow', onsubmit: submit('/api/login') },
    h('h1', {}, 'Accedi o registrati'),
    h('label', {}, 'Nome utente', username),
    h('label', {}, 'Password (min. 8 caratteri)', password),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-primary' }, 'Accedi'),
      h('button', { class: 'btn', type: 'button', onclick: submit('/api/register') }, 'Registrati'))));
}

// --- routing e tempo reale ----------------------------------------------

async function route() {
  const hash = location.hash || '#/';
  try {
    let m;
    if (hash === '#/' ) await listView('open');
    else if (hash === '#/closed') await listView('closed');
    else if (hash === '#/new') newView();
    else if (hash === '#/login') loginView();
    else if ((m = hash.match(/^#\/auction\/(\d+)$/))) await detailView(Number(m[1]));
    else view.replaceChildren(h('p', {}, 'Pagina non trovata'));
  } catch (err) {
    view.replaceChildren(h('p', { class: 'empty' }, err.message));
  }
}

const events = new EventSource('/api/events');
events.addEventListener('bid', (e) => {
  const { auction, bid } = JSON.parse(e.data);
  if (current.name === 'detail' && current.id === auction.id) {
    detailView(auction.id);
    if (me && bid.bidder !== me.username) toast(`Nuova offerta di ${bid.bidder}: ${euro(bid.amount)}`);
  } else if (current.name === 'list' && current.status === 'open') {
    document.querySelector(`[data-auction="${auction.id}"]`)?.replaceWith(auctionCard(auction));
  }
});
events.addEventListener('auction', () => {
  if (current.name === 'list' && current.status === 'open') listView('open');
});

// Aggiorna i conti alla rovescia; alla scadenza ricarica la vista per mostrare il vincitore.
setInterval(() => {
  let expired = false;
  for (const el of document.querySelectorAll('.countdown')) {
    const text = remaining(Number(el.dataset.ends));
    if (text === 'Conclusa' && el.textContent !== 'Conclusa') expired = true;
    el.textContent = text;
  }
  if (expired && current.name === 'detail') detailView(current.id);
}, 1000);

window.addEventListener('hashchange', route);
({ user: me } = await api('/api/me'));
renderNav();
route();
