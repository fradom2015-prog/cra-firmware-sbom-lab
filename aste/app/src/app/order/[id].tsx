import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, Chip, ErrorState, Field, Loading, Notice, Row, Screen, Text } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { confirm, inform } from '@/lib/dialog';
import { dateOnly, dateTime, euro, ORDER_STATUS } from '@/lib/format';
import { usePay } from '@/lib/payments';
import { useMeta, useOrder } from '@/lib/queries';
import type { Address, Order } from '@/lib/types';
import { spacing } from '@/theme';

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrder(id);
  const qc = useQueryClient();
  if (order.isLoading) return <Loading />;
  if (order.error || !order.data) return <ErrorState error={order.error} onRetry={() => void order.refetch()} />;
  const o = order.data;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['order', id] });
    void qc.invalidateQueries({ queryKey: ['orders'] });
  };

  return (
    <Screen edges={[]}>
      <View style={{ gap: spacing(1) }}>
        <Text variant="small">{ORDER_STATUS[o.status]}</Text>
        <Text variant="heading" onPress={() => router.push({ pathname: '/auction/[id]', params: { id: o.auctionId } })}>{o.title}</Text>
        <Text variant="small">{o.role === 'buyer' ? `Venditore: ${o.seller}` : `Acquirente: ${o.buyer}`}</Text>
      </View>

      <Amounts order={o} />
      <Timeline order={o} />

      {o.role === 'buyer' && o.status === 'awaiting_payment' && <PayForm order={o} onDone={refresh} />}
      {o.role === 'seller' && o.status === 'paid' && <ShipForm order={o} onDone={refresh} />}
      {o.role === 'seller' && o.status === 'awaiting_payment' && (
        <Notice>In attesa del pagamento dell&apos;acquirente (entro il {dateOnly(o.paymentDueAt)}). Non spedire prima della conferma.</Notice>
      )}
      {o.role === 'buyer' && o.status === 'shipped' && <DeliveryActions order={o} onDone={refresh} />}
      {o.role === 'buyer' && o.status === 'paid' && (
        <>
          <Notice>Pagamento ricevuto. Il venditore deve spedire: riceverai il numero di tracking.</Notice>
          <DisputeButton order={o} onDone={refresh} />
        </>
      )}
      {o.status === 'disputed' && <Notice tone="danger">Contestazione aperta: i fondi sono bloccati finché l&apos;assistenza non verifica. Motivo: {o.disputeReason}</Notice>}
      {o.role === 'buyer' && o.status === 'completed' && <ReviewForm order={o} />}
      {o.role === 'seller' && o.status === 'paid' && o.shippingAddress && <AddressCard address={o.shippingAddress} />}
    </Screen>
  );
}

function Amounts({ order: o }: { order: Order }) {
  const line = (label: string, v: number, bold = false) => (
    <Row style={{ justifyContent: 'space-between' }}>
      <Text variant={bold ? 'body' : 'muted'} style={bold ? { fontWeight: '700' } : undefined}>{label}</Text>
      <Text style={{ fontWeight: bold ? '700' : '400', fontVariant: ['tabular-nums'] }}>{euro(v)}</Text>
    </Row>
  );
  return (
    <Card>
      {line('Prezzo di aggiudicazione', o.itemAmount)}
      {line('Spedizione', o.shippingAmount)}
      {o.role === 'buyer' ? (
        <>{line('Protezione acquisti', o.buyerFee!)}{line('Totale', o.totalAmount!, true)}</>
      ) : (
        <>{line('Commissione di vendita', -o.sellerFee!)}{line('Riceverai', o.payout!, true)}</>
      )}
    </Card>
  );
}

function Timeline({ order: o }: { order: Order }) {
  const steps: [string, string | null][] = [
    ['Asta vinta', o.createdAt], ['Pagato', o.paidAt], ['Spedito', o.shippedAt], ['Concluso', o.completedAt],
  ];
  return (
    <Card>
      {steps.map(([label, at]) => (
        <Row key={label} style={{ justifyContent: 'space-between' }}>
          <Text color={at ? 'text' : 'textMuted'}>{at ? '● ' : '○ '}{label}</Text>
          <Text variant="small">{at ? dateTime(at) : ''}</Text>
        </Row>
      ))}
      {o.tracking && <Text variant="small" selectable>Tracking {o.tracking.carrier}: {o.tracking.number}</Text>}
    </Card>
  );
}

function PayForm({ order: o, onDone }: { order: Order; onDone: () => void }) {
  const pay = usePay();
  const [a, setA] = useState<Address>({ name: '', line1: '', city: '', postalCode: '', province: '', country: 'IT', phone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Address) => (v: string) => setA({ ...a, [k]: v });

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { clientSecret, amount } = await api<{ clientSecret: string; amount: number }>(`/orders/${o.id}/pay`, { body: { shippingAddress: a } });
      const result = await pay(clientSecret, a, amount);
      if (result === 'paid') {
        inform('Pagamento completato', 'Il venditore è stato avvisato e spedirà a breve.');
        // Lo stato passa a "pagato" quando arriva la conferma di Stripe al server.
        setTimeout(onDone, 1500);
      } else if (result !== 'canceled') setError(result.error);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Pagamento non riuscito');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text variant="heading">Indirizzo di spedizione</Text>
      <Text variant="small">Paga entro il {dateOnly(o.paymentDueAt)}. Il venditore vedrà l&apos;indirizzo solo dopo il pagamento.</Text>
      <Field label="Nome e cognome" value={a.name} onChangeText={set('name')} autoComplete="name" />
      <Field label="Indirizzo" value={a.line1} onChangeText={set('line1')} autoComplete="street-address" />
      <Field label="Scala, interno (facoltativo)" value={a.line2 ?? ''} onChangeText={set('line2')} />
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 2 }}><Field label="Città" value={a.city} onChangeText={set('city')} /></View>
        <View style={{ flex: 1 }}><Field label="CAP" value={a.postalCode} onChangeText={set('postalCode')} keyboardType="number-pad" autoComplete="postal-code" /></View>
      </Row>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}><Field label="Provincia" value={a.province ?? ''} onChangeText={set('province')} autoCapitalize="characters" maxLength={2} /></View>
        <View style={{ flex: 1 }}><Field label="Paese" value={a.country} onChangeText={set('country')} autoCapitalize="characters" maxLength={2} /></View>
      </Row>
      <Field label="Telefono (per il corriere)" value={a.phone} onChangeText={set('phone')} keyboardType="phone-pad" autoComplete="tel" />
      {error && <Notice tone="danger">{error}</Notice>}
      <Button title={`Paga ${euro(o.totalAmount!)}`} loading={busy} onPress={() => void submit()} />
      <Text variant="small" style={{ textAlign: 'center' }}>Pagamento sicuro con Stripe: carta, Apple Pay o Google Pay.</Text>
    </Card>
  );
}

function ShipForm({ order: o, onDone }: { order: Order; onDone: () => void }) {
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api(`/orders/${o.id}/ship`, { body: { carrier, trackingNumber: tracking } });
      onDone();
    } catch (e) {
      inform('Errore', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <Text variant="heading">Spedisci l&apos;oggetto</Text>
      <Text variant="small">Usa un corriere tracciato: riceverai il pagamento quando l&apos;acquirente conferma la consegna.</Text>
      <Row style={{ flexWrap: 'wrap' }}>
        {['Poste Italiane', 'BRT', 'GLS', 'SDA', 'DHL', 'UPS'].map((n) => <Chip key={n} label={n} selected={carrier === n} onPress={() => setCarrier(n)} />)}
      </Row>
      <Field label="Corriere" value={carrier} onChangeText={setCarrier} />
      <Field label="Numero di tracking" value={tracking} onChangeText={setTracking} autoCapitalize="characters" />
      <Button title="Conferma spedizione" loading={busy} disabled={carrier.length < 2 || tracking.length < 4} onPress={() => void submit()} />
    </Card>
  );
}

function DeliveryActions({ order: o, onDone }: { order: Order; onDone: () => void }) {
  const meta = useMeta();
  const [busy, setBusy] = useState(false);
  const confirmDelivery = async () => {
    if (!(await confirm('Hai ricevuto l\'oggetto?', 'Conferma solo se l\'oggetto è arrivato ed è come descritto: il pagamento verrà trasferito al venditore e non sarà più possibile contestare.', 'Confermo'))) return;
    setBusy(true);
    try {
      await api(`/orders/${o.id}/confirm-delivery`, { method: 'POST' });
      onDone();
    } catch (e) {
      inform('Errore', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Notice>
        Spedito il {o.shippedAt ? dateOnly(o.shippedAt) : ''}. Se non confermi né contesti, il pagamento verrà rilasciato al venditore dopo {meta.data?.autoReleaseDays ?? 14} giorni dalla spedizione.
      </Notice>
      <Button title="Ho ricevuto l'oggetto" loading={busy} onPress={() => void confirmDelivery()} />
      <DisputeButton order={o} onDone={onDone} />
    </>
  );
}

function DisputeButton({ order: o, onDone }: { order: Order; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return <Button title="C'è un problema" variant="secondary" onPress={() => setOpen(true)} />;
  return (
    <Card>
      <Text variant="heading">Apri una contestazione</Text>
      <Field label="Descrivi il problema" value={reason} onChangeText={setReason} multiline hint="Es. non è arrivato, è danneggiato, non corrisponde alla descrizione." />
      <Button title="Invia contestazione" variant="danger" loading={busy} disabled={reason.trim().length < 10} onPress={async () => {
        setBusy(true);
        try {
          await api(`/orders/${o.id}/dispute`, { body: { reason } });
          onDone();
        } catch (e) {
          inform('Errore', e instanceof Error ? e.message : undefined);
        } finally {
          setBusy(false);
        }
      }} />
    </Card>
  );
}

function ReviewForm({ order: o }: { order: Order }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [done, setDone] = useState(false);
  if (done) return <Notice tone="success">Grazie per la recensione!</Notice>;
  return (
    <Card>
      <Text variant="heading">Com&apos;è andata con {o.seller}?</Text>
      <Row accessibilityRole="radiogroup">
        {[1, 2, 3, 4, 5].map((n) => (
          <Text key={n} onPress={() => setRating(n)} accessibilityRole="radio" accessibilityLabel={`${n} stelle`} accessibilityState={{ checked: rating === n }}
            style={{ fontSize: 32 }} color={n <= rating ? 'accent' : 'border'}>★</Text>
        ))}
      </Row>
      <Field label="Commento (facoltativo)" value={comment} onChangeText={setComment} multiline maxLength={1000} />
      <Button title="Pubblica recensione" disabled={!rating} onPress={async () => {
        try {
          await api(`/orders/${o.id}/review`, { body: { rating, comment } });
          setDone(true);
        } catch (e) {
          if (e instanceof ApiError && e.code === 'already_reviewed') setDone(true);
          else inform('Errore', e instanceof Error ? e.message : undefined);
        }
      }} />
    </Card>
  );
}

function AddressCard({ address: a }: { address: Address }) {
  return (
    <Card>
      <Text variant="heading">Spedisci a</Text>
      <Text selectable>{a.name}{'\n'}{a.line1}{a.line2 ? `, ${a.line2}` : ''}{'\n'}{a.postalCode} {a.city} {a.province ?? ''} ({a.country}){'\n'}Tel. {a.phone}</Text>
    </Card>
  );
}
