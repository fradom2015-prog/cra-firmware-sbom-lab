import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';

// Pagamento protetto con Stripe Connect, modello "separate charges and transfers":
// il compratore paga la piattaforma, il denaro resta sul saldo della piattaforma e
// al venditore arriva con un transfer solo dopo la consegna. I dati delle carte non
// passano mai dai nostri server; identità e antiriciclaggio dei venditori li gestisce Stripe.

export type PaymentEvent =
  | { id: string; kind: 'payment_succeeded'; paymentIntentId: string; amount: number; orderId: string | null }
  | { id: string; kind: 'account_updated'; accountId: string; payoutsEnabled: boolean }
  | { id: string; kind: 'dispute_created'; paymentIntentId: string }
  | { id: string; kind: 'ignored'; type: string };

export interface PaymentProvider {
  createSellerAccount(input: { email: string; country: string; business: boolean; userId: string }): Promise<string>;
  onboardingLink(accountId: string, returnUrl: string, refreshUrl: string): Promise<string>;
  payoutsEnabled(accountId: string): Promise<boolean>;
  createPayment(input: { orderId: string; amount: number; buyerEmail: string }): Promise<{ id: string; clientSecret: string }>;
  /** Restituisce il client secret di un pagamento già creato: mai due pagamenti per un ordine. */
  paymentClientSecret(paymentIntentId: string): Promise<string>;
  transfer(input: { orderId: string; amount: number; destination: string; paymentIntentId: string }): Promise<string>;
  refund(input: { orderId: string; paymentIntentId: string }): Promise<string>;
  parseWebhook(rawBody: Buffer, signature: string | undefined): PaymentEvent;
}

export class WebhookSignatureError extends Error {}

export function createStripeProvider(secretKey: string, webhookSecret: string): PaymentProvider {
  const stripe = new Stripe(secretKey);
  return {
    async createSellerAccount({ email, country, business, userId }) {
      const account = await stripe.accounts.create({
        type: 'express',
        country,
        email,
        business_type: business ? 'company' : 'individual',
        capabilities: { transfers: { requested: true } },
        metadata: { userId },
      }, { idempotencyKey: `account-${userId}` });
      return account.id;
    },
    async onboardingLink(accountId, returnUrl, refreshUrl) {
      const link = await stripe.accountLinks.create({
        account: accountId, return_url: returnUrl, refresh_url: refreshUrl, type: 'account_onboarding',
      });
      return link.url;
    },
    async payoutsEnabled(accountId) {
      const account = await stripe.accounts.retrieve(accountId);
      return Boolean(account.payouts_enabled) && account.capabilities?.transfers === 'active';
    },
    async createPayment({ orderId, amount, buyerEmail }) {
      const pi = await stripe.paymentIntents.create({
        amount,
        currency: 'eur',
        automatic_payment_methods: { enabled: true },
        transfer_group: orderId,
        receipt_email: buyerEmail,
        metadata: { orderId },
      }, { idempotencyKey: `payment-${orderId}-${amount}` });
      if (!pi.client_secret) throw new Error('PaymentIntent senza client_secret');
      return { id: pi.id, clientSecret: pi.client_secret };
    },
    async paymentClientSecret(paymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (!pi.client_secret) throw new Error('PaymentIntent senza client_secret');
      return pi.client_secret;
    },
    async transfer({ orderId, amount, destination, paymentIntentId }) {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      const charge = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id;
      const t = await stripe.transfers.create({
        amount,
        currency: 'eur',
        destination,
        transfer_group: orderId,
        // Lega il transfer all'incasso: parte solo quando i fondi sono disponibili.
        ...(charge ? { source_transaction: charge } : {}),
        metadata: { orderId },
      }, { idempotencyKey: `transfer-${orderId}` });
      return t.id;
    },
    async refund({ orderId, paymentIntentId }) {
      const r = await stripe.refunds.create({ payment_intent: paymentIntentId, metadata: { orderId } },
        { idempotencyKey: `refund-${orderId}` });
      return r.id;
    },
    parseWebhook(rawBody, signature) {
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, signature ?? '', webhookSecret);
      } catch {
        throw new WebhookSignatureError('Firma del webhook non valida');
      }
      switch (event.type) {
        case 'payment_intent.succeeded': {
          const pi = event.data.object;
          return { id: event.id, kind: 'payment_succeeded', paymentIntentId: pi.id, amount: pi.amount_received, orderId: pi.metadata?.orderId ?? null };
        }
        case 'account.updated': {
          const a = event.data.object;
          return { id: event.id, kind: 'account_updated', accountId: a.id, payoutsEnabled: Boolean(a.payouts_enabled) && a.capabilities?.transfers === 'active' };
        }
        case 'charge.dispute.created': {
          const d = event.data.object;
          const pi = typeof d.payment_intent === 'string' ? d.payment_intent : d.payment_intent?.id;
          return pi ? { id: event.id, kind: 'dispute_created', paymentIntentId: pi } : { id: event.id, kind: 'ignored', type: event.type };
        }
        default:
          return { id: event.id, kind: 'ignored', type: event.type };
      }
    },
  };
}

// Fornitore finto per sviluppo e test: nessuna chiamata di rete.
// I webhook sono JSON già normalizzati, accettati solo con la firma "fake-signature".
export class FakePaymentProvider implements PaymentProvider {
  transfers: { orderId: string; amount: number; destination: string }[] = [];
  refunds: string[] = [];
  payments = new Map<string, { orderId: string; amount: number }>();

  async createSellerAccount() {
    return `acct_fake_${randomUUID().slice(0, 8)}`;
  }
  async onboardingLink(accountId: string, returnUrl: string) {
    return `${returnUrl}?fake_onboarding=${accountId}`;
  }
  async payoutsEnabled() {
    return true;
  }
  async createPayment({ orderId, amount }: { orderId: string; amount: number }) {
    const id = `pi_fake_${randomUUID().slice(0, 8)}`;
    this.payments.set(id, { orderId, amount });
    return { id, clientSecret: `${id}_secret` };
  }
  async paymentClientSecret(id: string) {
    return `${id}_secret`;
  }
  async transfer(input: { orderId: string; amount: number; destination: string }) {
    this.transfers.push(input);
    return `tr_fake_${input.orderId.slice(0, 8)}`;
  }
  async refund({ orderId }: { orderId: string }) {
    this.refunds.push(orderId);
    return `re_fake_${orderId.slice(0, 8)}`;
  }
  parseWebhook(rawBody: Buffer, signature: string | undefined): PaymentEvent {
    if (signature !== 'fake-signature') throw new WebhookSignatureError('Firma del webhook non valida');
    return JSON.parse(rawBody.toString('utf8')) as PaymentEvent;
  }
}
