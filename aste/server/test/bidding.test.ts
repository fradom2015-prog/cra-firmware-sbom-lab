import { describe, expect, it } from 'vitest';
import { BidRejected, bidIncrement, minimumBid, resolveBid, type BidState } from '../src/modules/bidding.js';

const fresh = (over: Partial<BidState> = {}): BidState => ({
  startingPrice: 10_000, reservePrice: null, currentPrice: null, leaderId: null, leaderMax: null, ...over,
});

const rejected = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BidRejected);
    expect((e as BidRejected).code).toBe(code);
    return;
  }
  throw new Error('offerta accettata');
};

describe('motore offerte automatiche', () => {
  it('scaglioni di rilancio', () => {
    expect(bidIncrement(100)).toBe(100);
    expect(bidIncrement(4_999)).toBe(100);
    expect(bidIncrement(5_000)).toBe(500);
    expect(bidIncrement(75_000)).toBe(2_500);
    expect(bidIncrement(5_000_000)).toBe(25_000);
  });

  it('la prima offerta fissa il prezzo di partenza, non il massimo', () => {
    const r = resolveBid(fresh(), 'anna', 50_000);
    expect(r.state).toMatchObject({ currentPrice: 10_000, leaderId: 'anna', leaderMax: 50_000 });
    expect(r.rows).toEqual([{ bidderId: 'anna', amount: 10_000, maxAmount: 50_000, isAuto: false, visible: true }]);
    rejected(() => resolveBid(fresh(), 'anna', 9_999), 'below_minimum');
  });

  it('lo sfidante che supera il massimo vince al massimo precedente più un rilancio', () => {
    const s = resolveBid(fresh(), 'anna', 30_000).state;
    const r = resolveBid(s, 'bruno', 50_000);
    expect(r.state).toMatchObject({ currentPrice: 31_000, leaderId: 'bruno', leaderMax: 50_000 });
    expect(r.outbidUserId).toBe('anna');
    expect(r.rows.map((x) => [x.bidderId, x.amount, x.isAuto])).toEqual([['anna', 30_000, true], ['bruno', 31_000, false]]);
  });

  it('il prezzo non supera mai il massimo del vincitore', () => {
    const s = resolveBid(fresh(), 'anna', 30_000).state;
    const r = resolveBid(s, 'bruno', 30_500);
    expect(r.state.currentPrice).toBe(30_500);
    expect(r.state.leaderId).toBe('bruno');
  });

  it("l'offerta automatica del leader respinge lo sfidante", () => {
    const s = resolveBid(fresh(), 'anna', 50_000).state;
    const r = resolveBid(s, 'bruno', 20_000);
    expect(r.state).toMatchObject({ currentPrice: 21_000, leaderId: 'anna', leaderMax: 50_000 });
    expect(r.outbidUserId).toBe('bruno');
    expect(r.rows.map((x) => [x.bidderId, x.amount, x.isAuto])).toEqual([['bruno', 20_000, false], ['anna', 21_000, true]]);
  });

  it('a parità di massimo vince chi ha offerto prima', () => {
    const s = resolveBid(fresh(), 'anna', 40_000).state;
    const r = resolveBid(s, 'bruno', 40_000);
    expect(r.state).toMatchObject({ currentPrice: 40_000, leaderId: 'anna' });
  });

  it('il leader che alza il massimo non fa salire il prezzo', () => {
    const s = resolveBid(resolveBid(fresh(), 'anna', 20_000).state, 'bruno', 15_000).state;
    const r = resolveBid(s, 'anna', 90_000);
    expect(r.state).toMatchObject({ currentPrice: s.currentPrice, leaderMax: 90_000 });
    expect(r.priceChanged).toBe(false);
    expect(r.rows[0]!.visible).toBe(false);
    rejected(() => resolveBid(r.state, 'anna', 90_000), 'not_above_own_max');
  });

  it('prezzo di riserva: il prezzo salta alla riserva appena il massimo la copre', () => {
    const base = fresh({ reservePrice: 40_000 });
    const below = resolveBid(base, 'anna', 30_000);
    expect(below.state.currentPrice).toBe(10_000);
    const raised = resolveBid(below.state, 'anna', 45_000);
    expect(raised.state.currentPrice).toBe(40_000);
    expect(raised.priceChanged).toBe(true);
    const direct = resolveBid(base, 'bruno', 60_000);
    expect(direct.state.currentPrice).toBe(40_000);
  });

  it('rifiuta importi non validi', () => {
    rejected(() => resolveBid(fresh(), 'anna', 10_000.5), 'invalid_amount');
    rejected(() => resolveBid(fresh(), 'anna', -1), 'invalid_amount');
    rejected(() => resolveBid(fresh(), 'anna', 2_000_000_000), 'above_limit');
    const s = resolveBid(fresh(), 'anna', 30_000).state;
    rejected(() => resolveBid(s, 'bruno', minimumBid(s) - 1), 'below_minimum');
  });

  it('invarianti su 2000 sequenze casuali di offerte', () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
    for (let run = 0; run < 2000; run++) {
      const reserve = rand() < 0.3 ? 10_000 + Math.floor(rand() * 50_000) : null;
      let s = fresh({ reservePrice: reserve });
      const maxes = new Map<string, number>();
      let firstAtTop: string | null = null;
      for (let i = 0; i < 12; i++) {
        const who = `u${Math.floor(rand() * 4)}`;
        const amount = minimumBid(s) + Math.floor(rand() * 20_000);
        let r;
        try {
          r = resolveBid(s, who, amount);
        } catch {
          continue;
        }
        s = r.state;
        maxes.set(who, Math.max(maxes.get(who) ?? 0, amount));
        const top = Math.max(...maxes.values());
        if (amount === top && (firstAtTop == null || (maxes.get(firstAtTop) ?? 0) < top)) firstAtTop = who;
        // Il leader è chi ha il massimo più alto (a parità, il primo ad averlo raggiunto).
        expect(s.leaderMax).toBe(top);
        expect(s.leaderId).toBe(firstAtTop);
        // Il prezzo sta tra il prezzo di partenza e il massimo del leader.
        expect(s.currentPrice!).toBeGreaterThanOrEqual(s.startingPrice);
        expect(s.currentPrice!).toBeLessThanOrEqual(s.leaderMax!);
        // Il prezzo non supera il secondo massimo più un rilancio (salvo riserva).
        const others = [...maxes.entries()].filter(([u]) => u !== s.leaderId).map(([, m]) => m);
        if (others.length && (reserve == null || s.leaderMax! < reserve)) {
          const second = Math.max(...others);
          expect(s.currentPrice!).toBeLessThanOrEqual(Math.max(second + bidIncrement(second), s.startingPrice));
        }
      }
    }
  });
});
