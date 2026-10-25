import { router } from 'expo-router';
import { Button, Card, Empty, ListItem, Notice, Screen, Text } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { inform } from '@/lib/dialog';
import { dateOnly } from '@/lib/format';
import { SUPPORT_EMAIL } from '@/lib/config';
import * as WebBrowser from 'expo-web-browser';

export default function Profile() {
  const { user, status, logout } = useAuth();

  if (status !== 'signedIn' || !user) {
    return (
      <Screen>
        <Text variant="title" accessibilityRole="header">Profilo</Text>
        <Empty title="Benvenuto" message="Accedi o crea un account per offrire, vendere e seguire le aste."
          action={<><Button title="Accedi" onPress={() => router.push('/auth/login')} /><Button title="Crea un account" variant="ghost" onPress={() => router.push('/auth/register')} /></>} />
        <LegalLinks />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text variant="title" accessibilityRole="header">{user.displayName}</Text>
      <Text variant="muted">{user.email} · iscritto dal {dateOnly(user.createdAt)}</Text>
      {!user.emailVerified && (
        <Notice tone="warning" action={<Button title="Invia di nuovo il link" variant="secondary" onPress={async () => {
          await api('/auth/resend-verification', { method: 'POST' }).catch(() => undefined);
          inform('Email inviata', `Controlla la casella ${user.email}.`);
        }} />}>Indirizzo email da confermare.</Notice>
      )}
      <Card>
        <ListItem title="Profilo pubblico" subtitle="Come ti vedono gli altri" onPress={() => router.push({ pathname: '/user/[id]', params: { id: user.id } })} />
        <ListItem title="Profilo venditore" subtitle={user.seller ? (user.seller.payoutsEnabled ? 'Pagamenti attivi' : 'Verifica da completare') : 'Non ancora attivato'}
          onPress={() => router.push('/sell/seller-profile')} />
        <ListItem title="Impostazioni e privacy" onPress={() => router.push('/settings')} />
        <ListItem title="Utenti bloccati" onPress={() => router.push('/settings/blocked')} />
        <ListItem title="Assistenza" subtitle={SUPPORT_EMAIL} onPress={() => void WebBrowser.openBrowserAsync(`mailto:${SUPPORT_EMAIL}`)} />
      </Card>
      <LegalLinks />
      <Button title="Esci" variant="secondary" onPress={() => void logout()} />
    </Screen>
  );
}

function LegalLinks() {
  return (
    <Card>
      <ListItem title="Termini e condizioni" onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'termini' } })} />
      <ListItem title="Informativa privacy" onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })} />
      <ListItem title="Regole della community" onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'regole' } })} />
    </Card>
  );
}
