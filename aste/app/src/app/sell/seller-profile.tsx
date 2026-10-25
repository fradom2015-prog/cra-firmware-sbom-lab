import { useEffect, useState } from 'react';
import { View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Button, Chip, Field, Loading, Notice, Row, Screen, Text } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { inform } from '@/lib/dialog';

interface Profile {
  type: 'private' | 'business';
  legalName: string;
  vatNumber?: string | null;
  taxCode?: string | null;
  addressLine: string;
  city: string;
  postalCode: string;
  country: string;
  phone?: string | null;
  businessEmail?: string | null;
  payoutsEnabled?: boolean;
}

const EMPTY: Profile = { type: 'private', legalName: '', addressLine: '', city: '', postalCode: '', country: 'IT' };

export default function SellerProfile() {
  const { user, reloadUser } = useAuth();
  const [p, setP] = useState<Profile | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ seller: Profile | null }>('/me/seller').then(({ seller }) => {
      setP(seller ?? EMPTY);
      setSaved(!!seller);
    }).catch(() => setP(EMPTY));
  }, []);

  if (!p) return <Loading />;
  const set = (k: keyof Profile) => (v: string) => setP({ ...p, [k]: v });
  const business = p.type === 'business';

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        type: p.type, legalName: p.legalName, addressLine: p.addressLine, city: p.city, postalCode: p.postalCode, country: p.country.toUpperCase(),
        ...(p.taxCode ? { taxCode: p.taxCode } : {}),
        ...(business ? { vatNumber: p.vatNumber ?? '', phone: p.phone ?? '', businessEmail: p.businessEmail ?? '' } : {}),
      };
      await api('/me/seller', { method: 'PUT', body });
      setSaved(true);
      await reloadUser();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Salvataggio non riuscito');
    } finally {
      setBusy(false);
    }
  };

  // La verifica d'identità e dell'IBAN avviene sulla pagina sicura di Stripe.
  const onboarding = async () => {
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>('/me/seller/onboarding', { method: 'POST' });
      await WebBrowser.openBrowserAsync(url);
      const { payoutsEnabled } = await api<{ payoutsEnabled: boolean }>('/me/seller/refresh', { method: 'POST' });
      await reloadUser();
      inform(payoutsEnabled ? 'Verifica completata' : 'Verifica in corso', payoutsEnabled ? 'Ora puoi pubblicare le tue aste.' : 'Stripe sta verificando i tuoi dati: riceverai una notifica.');
    } catch (e) {
      inform('Errore', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={[]}>
      <Text variant="muted">Questi dati servono per i pagamenti e, se sei un professionista, sono mostrati agli acquirenti come richiesto dalla legge europea (Digital Services Act).</Text>
      <View style={{ gap: 8 }}>
        <Text variant="label">Vendo come</Text>
        <Row>
          <Chip label="Privato" selected={!business} onPress={() => setP({ ...p, type: 'private' })} />
          <Chip label="Professionista / azienda" selected={business} onPress={() => setP({ ...p, type: 'business' })} />
        </Row>
        <Text variant="small">{business ? 'Per chi vende abitualmente o con partita IVA. Agli acquirenti spettano recesso e garanzia.' : 'Per chi vende occasionalmente oggetti personali.'}</Text>
      </View>
      <Field label={business ? 'Ragione sociale' : 'Nome e cognome'} value={p.legalName} onChangeText={set('legalName')} autoComplete="name" />
      {business && <Field label="Partita IVA (con prefisso del paese)" value={p.vatNumber ?? ''} onChangeText={set('vatNumber')} placeholder="IT12345678901" autoCapitalize="characters" />}
      <Field label="Codice fiscale (facoltativo)" value={p.taxCode ?? ''} onChangeText={set('taxCode')} autoCapitalize="characters" />
      <Field label="Indirizzo" value={p.addressLine} onChangeText={set('addressLine')} autoComplete="street-address" />
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 2 }}><Field label="Città" value={p.city} onChangeText={set('city')} /></View>
        <View style={{ flex: 1 }}><Field label="CAP" value={p.postalCode} onChangeText={set('postalCode')} keyboardType="number-pad" /></View>
      </Row>
      <Field label="Paese (codice)" value={p.country} onChangeText={set('country')} maxLength={2} autoCapitalize="characters" hint="IT, FR, DE, ES…" />
      {business && (
        <>
          <Field label="Telefono" value={p.phone ?? ''} onChangeText={set('phone')} keyboardType="phone-pad" />
          <Field label="Email aziendale" value={p.businessEmail ?? ''} onChangeText={set('businessEmail')} keyboardType="email-address" autoCapitalize="none" />
        </>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      <Button title="Salva profilo" loading={busy} onPress={() => void save()} variant={saved ? 'secondary' : 'primary'} />

      {saved && (
        user?.seller?.payoutsEnabled
          ? <Notice tone="success">Pagamenti attivi: puoi pubblicare e ricevere gli incassi.</Notice>
          : <Notice tone="accent" action={<Button title="Verifica identità e IBAN" loading={busy} onPress={() => void onboarding()} />}>
              Ultimo passaggio: verifica identità e conto bancario con Stripe, il nostro partner per i pagamenti.
            </Notice>
      )}
    </Screen>
  );
}
