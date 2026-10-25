import type { ReactNode } from 'react';
import type { Address } from './types';

export function PaymentsProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export type PayResult = 'paid' | 'canceled' | { error: string };

// Il modulo Stripe per React Native non esiste sul web: il pagamento si completa dall'app.
export function usePay() {
  return async (_clientSecret: string, _address: Address, _amount: number): Promise<PayResult> => ({
    error: "Il pagamento dal browser non è ancora disponibile: completa l'acquisto dall'app per iPhone o Android.",
  });
}
