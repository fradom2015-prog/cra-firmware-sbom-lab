import { router } from 'expo-router';
import { Button, Empty, Screen } from '@/components/ui';

export default function NotFound() {
  return <Screen><Empty title="Pagina non trovata" action={<Button title="Torna alle aste" onPress={() => router.replace('/')} />} /></Screen>;
}
