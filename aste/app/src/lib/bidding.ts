// Stessi scaglioni del server, per suggerire importi validi. Il server resta l'autorità.
const INCREMENTS: [number, number][] = [[5_000, 100], [20_000, 500], [50_000, 1_000], [100_000, 2_500], [500_000, 5_000], [1_000_000, 10_000]];

export function bidIncrement(price: number): number {
  for (const [limit, step] of INCREMENTS) if (price < limit) return step;
  return 25_000;
}

// Tre importi rapidi: il minimo e due rilanci successivi.
export function suggestedBids(minimum: number): number[] {
  const second = minimum + bidIncrement(minimum);
  return [minimum, second, second + bidIncrement(second) * 2];
}

export const feeOf = (amount: number, bps: number) => Math.round((amount * bps) / 10_000);
