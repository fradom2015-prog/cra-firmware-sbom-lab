import { useState } from 'react';
import { Platform, Share } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Field, Notice, Screen, Text } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { confirm, inform } from '@/lib/dialog';

export default function Settings() {
  const { user, reloadUser, forget } = useAuth();
  const [name, setName] = useState(user?.displayName ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [msg, setMsg] = useState<Record<string, string | null>>({});
  if (!user) return null;

  const attempt = (key: string, fn: () => Promise<void>) => async () => {
    setMsg((m) => ({ ...m, [key]: null }));
    try {
      await fn();
    } catch (e) {
      setMsg((m) => ({ ...m, [key]: e instanceof ApiError ? e.message : 'Operazione non riuscita' }));
    }
  };

  const exportData = attempt('export', async () => {
    const data = await api('/me/export');
    const json = JSON.stringify(data, null, 2);
    if (Platform.OS === 'web') {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'i-miei-dati.json';
      link.click();
      URL.revokeObjectURL(url);
    } else {
      await Share.share({ title: 'I miei dati', message: json });
    }
  });

  return (
    <Screen edges={[]}>
      <Card>
        <Text variant="heading">Nome utente</Text>
        <Field label="Nome utente" value={name} onChangeText={setName} autoCapitalize="none" error={msg.name} />
        <Button title="Salva" variant="secondary" disabled={name === user.displayName} onPress={attempt('name', async () => {
          await api('/me', { method: 'PATCH', body: { displayName: name.trim() } });
          await reloadUser();
          inform('Nome utente aggiornato');
        })} />
      </Card>

      <Card>
        <Text variant="heading">Cambia password</Text>
        <Field label="Password attuale" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" />
        <Field label="Nuova password" value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" hint="Almeno 10 caratteri" error={msg.password} />
        <Button title="Aggiorna password" variant="secondary" disabled={!current || next.length < 10} onPress={attempt('password', async () => {
          await api('/auth/change-password', { body: { currentPassword: current, newPassword: next } });
          setCurrent('');
          setNext('');
          inform('Password aggiornata', 'Le sessioni sugli altri dispositivi sono state chiuse.');
        })} />
      </Card>

      <Card>
        <Text variant="heading">Sicurezza</Text>
        <Button title="Esci da tutti i dispositivi" variant="secondary" onPress={attempt('all', async () => {
          if (!(await confirm('Uscire ovunque?', 'Dovrai accedere di nuovo su tutti i dispositivi, compreso questo.', 'Esci ovunque'))) return;
          await api('/auth/logout-all', { method: 'POST' });
          await forget();
          router.replace('/');
        })} />
      </Card>

      <Card>
        <Text variant="heading">I tuoi dati</Text>
        <Text variant="muted">Scarica una copia di tutti i dati che conserviamo su di te (GDPR, art. 20).</Text>
        {msg.export && <Notice tone="danger">{msg.export}</Notice>}
        <Button title="Esporta i miei dati" variant="secondary" onPress={exportData} />
      </Card>

      <Card>
        <Text variant="heading" color="danger">Elimina account</Text>
        <Text variant="muted">
          L&apos;account viene chiuso e i tuoi dati personali anonimizzati. Conserviamo solo i dati degli ordini conclusi per gli obblighi fiscali. Prima devi concludere aste in corso con offerte e ordini aperti.
        </Text>
        <Field label="Conferma con la password" value={deletePassword} onChangeText={setDeletePassword} secureTextEntry autoComplete="current-password" error={msg.delete} />
        <Button title="Elimina definitivamente" variant="danger" disabled={!deletePassword} onPress={attempt('delete', async () => {
          if (!(await confirm('Eliminare l\'account?', 'L\'operazione non si può annullare.', 'Elimina', true))) return;
          await api('/me', { method: 'DELETE', body: { password: deletePassword } });
          await forget();
          inform('Account eliminato', 'Ci dispiace vederti andare via.');
          router.replace('/');
        })} />
      </Card>
    </Screen>
  );
}
