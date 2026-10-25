import { euro, parseEuro, timeLeft, centsToInput } from '@/lib/format';
import { bidIncrement, suggestedBids, feeOf } from '@/lib/bidding';

const clean = (s: string) => s.replace(/\s/g, ' ');

describe('formati', () => {
  it('euro in formato italiano', () => {
    // CLDR italiano: separatore delle migliaia solo da 5 cifre in su.
    expect(clean(euro(1234567))).toBe('12.345,67 €');
    expect(clean(euro(100))).toBe('1,00 €');
  });

  it('interpreta gli importi scritti dagli utenti', () => {
    expect(parseEuro('12,50')).toBe(1250);
    expect(parseEuro('12.50')).toBe(1250);
    expect(parseEuro('1.250,00')).toBe(125000);
    expect(parseEuro('1.250')).toBe(125000);
    expect(parseEuro('€ 30')).toBe(3000);
    expect(parseEuro('0,1')).toBe(10);
    expect(parseEuro('')).toBeNull();
    expect(parseEuro('abc')).toBeNull();
    expect(parseEuro('12,345')).toBeNull();
    expect(parseEuro('-5')).toBeNull();
    expect(centsToInput(1250)).toBe('12,50');
  });

  it('conto alla rovescia', () => {
    const now = Date.parse('2026-11-01T10:00:00Z');
    const at = (s: number) => new Date(now + s * 1000).toISOString();
    expect(timeLeft(at(3 * 86400 + 5 * 3600), now)).toBe('3g 5h');
    expect(timeLeft(at(2 * 3600 + 15 * 60), now)).toBe('2h 15m');
    expect(timeLeft(at(4 * 60 + 7), now)).toBe('4m 07s');
    expect(timeLeft(at(-1), now)).toBe('Conclusa');
  });

  it('scaglioni di rilancio allineati al server', () => {
    expect(bidIncrement(4_999)).toBe(100);
    expect(bidIncrement(5_000)).toBe(500);
    expect(bidIncrement(2_000_000)).toBe(25_000);
    expect(suggestedBids(10_000)).toEqual([10_000, 10_500, 11_500]);
    expect(feeOf(20_000, 500)).toBe(1_000);
  });
});
