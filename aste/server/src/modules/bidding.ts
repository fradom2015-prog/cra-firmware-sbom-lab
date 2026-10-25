// Motore delle offerte automatiche (proxy bidding), come su eBay e Catawiki.
// Ogni offerente indica il massimo che è disposto a pagare; il sistema rilancia per lui
// del minimo indispensabile. Il prezzo è il secondo massimo più un rilancio, senza
// superare il massimo del primo. A parità di massimo vince chi ha offerto prima.
// Funzioni pure: nessun accesso al database, interamente testabili.

export interface BidState {
  startingPrice: number;
  reservePrice: number | null;
  currentPrice: number | null;
  leaderId: string | null;
  leaderMax: number | null;
}

export interface BidRow {
  bidderId: string;
  amount: number;
  maxAmount: number | null;
  isAuto: boolean;
  visible: boolean;
}

export interface BidOutcome {
  state: BidState;
  rows: BidRow[];
  /** Utente appena superato, da avvisare. */
  outbidUserId: string | null;
  /** Il prezzo visibile è cambiato (fa scattare l'anti-sniping). */
  priceChanged: boolean;
}

// Scaglioni di rilancio minimo, in centesimi.
const INCREMENTS: [limit: number, step: number][] = [
  [5_000, 100], // fino a 50 €: 1 €
  [20_000, 500], // fino a 200 €: 5 €
  [50_000, 1_000], // fino a 500 €: 10 €
  [100_000, 2_500], // fino a 1.000 €: 25 €
  [500_000, 5_000], // fino a 5.000 €: 50 €
  [1_000_000, 10_000], // fino a 10.000 €: 100 €
];
const TOP_INCREMENT = 25_000;
export const MAX_BID = 1_000_000_000; // 10 milioni di euro

export function bidIncrement(price: number): number {
  for (const [limit, step] of INCREMENTS) if (price < limit) return step;
  return TOP_INCREMENT;
}

export function minimumBid(s: BidState): number {
  return s.currentPrice == null ? s.startingPrice : s.currentPrice + bidIncrement(s.currentPrice);
}

export const reserveMet = (s: BidState) =>
  s.reservePrice == null ? true : s.currentPrice != null && s.currentPrice >= s.reservePrice;

// Il prezzo raggiunge la riserva appena il massimo del leader la copre.
function applyReserve(price: number, leaderMax: number, reserve: number | null): number {
  return reserve != null && leaderMax >= reserve ? Math.max(price, reserve) : price;
}

export class BidRejected extends Error {
  constructor(
    public readonly code: 'below_minimum' | 'not_above_own_max' | 'above_limit' | 'invalid_amount',
    public readonly minimum: number,
  ) {
    super(code);
  }
}

export function resolveBid(s: BidState, bidderId: string, max: number): BidOutcome {
  if (!Number.isSafeInteger(max) || max <= 0) throw new BidRejected('invalid_amount', minimumBid(s));
  if (max > MAX_BID) throw new BidRejected('above_limit', minimumBid(s));

  // Primo offerente.
  if (s.leaderId == null || s.leaderMax == null) {
    if (max < s.startingPrice) throw new BidRejected('below_minimum', s.startingPrice);
    const price = applyReserve(s.startingPrice, max, s.reservePrice);
    return {
      state: { ...s, currentPrice: price, leaderId: bidderId, leaderMax: max },
      rows: [{ bidderId, amount: price, maxAmount: max, isAuto: false, visible: true }],
      outbidUserId: null,
      priceChanged: true,
    };
  }

  const current = s.currentPrice ?? s.startingPrice;

  // Il leader alza il proprio massimo: il prezzo non sale, salvo raggiungere la riserva.
  if (bidderId === s.leaderId) {
    if (max <= s.leaderMax) throw new BidRejected('not_above_own_max', s.leaderMax + 1);
    const price = applyReserve(current, max, s.reservePrice);
    const changed = price !== current;
    return {
      state: { ...s, currentPrice: price, leaderMax: max },
      rows: [{ bidderId, amount: price, maxAmount: max, isAuto: false, visible: changed }],
      outbidUserId: null,
      priceChanged: changed,
    };
  }

  const min = minimumBid(s);
  if (max < min) throw new BidRejected('below_minimum', min);

  // Lo sfidante supera il massimo del leader: diventa lui il leader.
  if (max > s.leaderMax) {
    const price = applyReserve(Math.min(max, s.leaderMax + bidIncrement(s.leaderMax)), max, s.reservePrice);
    const rows: BidRow[] = [];
    if (s.leaderMax > current) {
      rows.push({ bidderId: s.leaderId, amount: s.leaderMax, maxAmount: null, isAuto: true, visible: true });
    }
    rows.push({ bidderId, amount: price, maxAmount: max, isAuto: false, visible: true });
    return {
      state: { ...s, currentPrice: price, leaderId: bidderId, leaderMax: max },
      rows,
      outbidUserId: s.leaderId,
      priceChanged: true,
    };
  }

  // Il leader resta in testa: l'offerta automatica risponde allo sfidante.
  const price = applyReserve(Math.min(s.leaderMax, max + bidIncrement(max)), s.leaderMax, s.reservePrice);
  return {
    state: { ...s, currentPrice: price },
    rows: [
      { bidderId, amount: max, maxAmount: max, isAuto: false, visible: true },
      { bidderId: s.leaderId, amount: price, maxAmount: null, isAuto: true, visible: true },
    ],
    outbidUserId: bidderId,
    priceChanged: true,
  };
}
