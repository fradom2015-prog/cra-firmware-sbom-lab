import type { ReactNode } from 'react';
import { StripeProvider, useStripe } from '@stripe/stripe-react-native';
import { STRIPE_PUBLISHABLE_KEY } from './config';
import type { Address } from './types';

export function PaymentsProvider({ children }: { children: ReactNode }) {
  return (
    <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY} merchantIdentifier="merchant.it.asteonline.app" urlScheme="aste">
      <>{children}</>
    </StripeProvider>
  );
}

export type PayResult = 'paid' | 'canceled' | { error: string };

// Payment Sheet di Stripe: carte, Apple Pay e Google Pay. I dati della carta non
// passano mai dall'app né dal nostro server.
export function usePay() {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  return async (clientSecret: string, address: Address, amount: number): Promise<PayResult> => {
    const init = await initPaymentSheet({
      merchantDisplayName: 'Aste',
      paymentIntentClientSecret: clientSecret,
      defaultBillingDetails: { name: address.name, phone: address.phone },
      applePay: { merchantCountryCode: 'IT' },
      googlePay: { merchantCountryCode: 'IT', currencyCode: 'EUR', testEnv: __DEV__ },
      returnURL: 'aste://stripe-redirect',
      allowsDelayedPaymentMethods: false,
    });
    if (init.error) return { error: init.error.message };
    void amount;
    const res = await presentPaymentSheet();
    if (res.error) return res.error.code === 'Canceled' ? 'canceled' : { error: res.error.message };
    return 'paid';
  };
}
