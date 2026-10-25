import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Chip, Field, Loading, Notice, Row, Screen, Text } from '@/components/ui';
import { api, ApiError, uploadImage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { confirm, inform } from '@/lib/dialog';
import { centsToInput, CONDITIONS, euro, parseEuro } from '@/lib/format';
import { useCategories, useMeta } from '@/lib/queries';
import { feeOf } from '@/lib/bidding';
import type { Auction, Condition } from '@/lib/types';
import { radius, spacing, useColors } from '@/theme';

const DURATIONS = [3, 5, 7, 10];
const MAX_PHOTOS = 10;

interface Photo {
  id?: string;
  uri: string;
  mimeType?: string;
}

export default function NewAuction() {
  const { id: draftId } = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuth();
  const c = useColors();
  const qc = useQueryClient();
  const categories = useCategories();
  const meta = useMeta();

  const [loaded, setLoaded] = useState(!draftId);
  const [auctionId, setAuctionId] = useState<string | undefined>(draftId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>();
  const [condition, setCondition] = useState<Condition>();
  const [startingPrice, setStartingPrice] = useState('');
  const [reservePrice, setReservePrice] = useState('');
  const [shippingPrice, setShippingPrice] = useState('');
  const [duration, setDuration] = useState(7);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<null | 'save' | 'publish'>(null);

  // Riapertura di una bozza esistente.
  useEffect(() => {
    if (!draftId) return;
    api<{ auction: Auction }>(`/auctions/${draftId}`).then(({ auction: a }) => {
      setTitle(a.title);
      setDescription(a.description);
      setCategory(a.category.slug);
      setCondition(a.condition);
      setStartingPrice(centsToInput(a.startingPrice));
      setShippingPrice(a.shippingPrice ? centsToInput(a.shippingPrice) : '');
      setDuration(a.durationDays);
      setPhotos(a.images.map((i) => ({ id: i.id, uri: i.url })));
      setLoaded(true);
    }).catch(() => router.back());
  }, [draftId]);

  if (!loaded) return <Loading />;

  const pick = async (camera: boolean) => {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return inform('Permesso negato', camera ? 'Consenti l\'accesso alla fotocamera dalle impostazioni.' : 'Consenti l\'accesso alle foto dalle impostazioni.');
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.85, exif: false, allowsMultipleSelection: !camera, selectionLimit: MAX_PHOTOS - photos.length };
    const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled) return;
    setPhotos((p) => [...p, ...res.assets.map((a) => ({ uri: a.uri, mimeType: a.mimeType ?? 'image/jpeg' }))].slice(0, MAX_PHOTOS));
  };

  const removePhoto = async (index: number) => {
    const photo = photos[index]!;
    if (photo.id && auctionId) await api(`/auctions/${auctionId}/images/${photo.id}`, { method: 'DELETE' }).catch(() => undefined);
    setPhotos((p) => p.filter((_, i) => i !== index));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    const start = parseEuro(startingPrice);
    const reserve = reservePrice ? parseEuro(reservePrice) : null;
    const shipping = shippingPrice ? parseEuro(shippingPrice) : 0;
    if (title.trim().length < 5) e.title = 'Almeno 5 caratteri';
    if (!category) e.category = 'Scegli una categoria';
    if (!condition) e.condition = 'Indica le condizioni';
    if (start == null || start < 100) e.startingPrice = 'Almeno 1,00 €';
    if (reservePrice && (reserve == null || (start != null && reserve < start))) e.reservePrice = 'Deve essere uguale o superiore alla base d\'asta';
    if (shipping == null) e.shippingPrice = 'Importo non valido';
    setErrors(e);
    if (Object.keys(e).length) return null;
    return {
      title: title.trim(), description: description.trim(), categorySlug: category!, condition: condition!,
      startingPrice: start!, reservePrice: reserve, shippingPrice: shipping!, durationDays: duration,
    };
  };

  // Salva la bozza e carica le foto nuove. Restituisce l'id dell'asta.
  const save = async (): Promise<string | null> => {
    const body = validate();
    if (!body) return null;
    let id = auctionId;
    if (id) await api(`/auctions/${id}`, { method: 'PATCH', body });
    else {
      id = (await api<{ auction: Auction }>('/auctions', { body })).auction.id;
      setAuctionId(id);
    }
    const uploaded: Photo[] = [];
    for (const p of photos) {
      if (p.id) uploaded.push(p);
      else {
        const { image } = await uploadImage(id, p.uri, p.mimeType);
        uploaded.push({ id: image.id, uri: image.url });
      }
    }
    setPhotos(uploaded);
    void qc.invalidateQueries({ queryKey: ['me', 'auctions'] });
    return id;
  };

  const run = async (kind: 'save' | 'publish') => {
    setBusy(kind);
    try {
      const id = await save();
      if (!id) return;
      if (kind === 'save') {
        inform('Bozza salvata');
        return router.back();
      }
      if (!photos.length) return setErrors((e) => ({ ...e, photos: 'Aggiungi almeno una foto' }));
      if (!(await confirm('Pubblicare l\'asta?', `L'asta durerà ${duration} giorni. Dopo la pubblicazione non potrai modificarla e potrai ritirarla solo finché non riceve offerte.`, 'Pubblica'))) return;
      const { auction } = await api<{ auction: Auction }>(`/auctions/${id}/publish`, { method: 'POST' });
      void qc.invalidateQueries({ queryKey: ['auctions'] });
      router.replace({ pathname: '/auction/[id]', params: { id: auction.id } });
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err?.code === 'seller_profile_required' || err?.code === 'payouts_not_enabled') {
        if (await confirm('Manca un passaggio', `${err.message}. La bozza è salvata.`, 'Continua')) router.push('/sell/seller-profile');
      } else inform('Operazione non riuscita', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const start = parseEuro(startingPrice);
  const sellerFee = meta.data && start ? feeOf(start, meta.data.sellerFeeBps) : null;

  return (
    <Screen edges={[]}>
      {!user?.seller?.payoutsEnabled && (
        <Notice tone="accent">Puoi preparare la bozza ora; per pubblicarla dovrai completare il profilo venditore.</Notice>
      )}

      <View style={{ gap: spacing(2) }}>
        <Text variant="label">Foto ({photos.length}/{MAX_PHOTOS})</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing(2) }}>
          {photos.map((p, i) => (
            <View key={p.uri}>
              <Image source={p.uri} style={{ width: 96, height: 96, borderRadius: radius.md, backgroundColor: c.surfaceAlt }} contentFit="cover" />
              <Pressable onPress={() => void removePhoto(i)} accessibilityRole="button" accessibilityLabel={`Rimuovi foto ${i + 1}`} hitSlop={8}
                style={{ position: 'absolute', top: 4, right: 4, backgroundColor: '#000a', borderRadius: radius.pill }}>
                <Ionicons name="close" size={18} color="#fff" />
              </Pressable>
              {i === 0 && <Text variant="small" style={{ textAlign: 'center' }}>Copertina</Text>}
            </View>
          ))}
          {photos.length < MAX_PHOTOS && (
            <>
              <PhotoButton icon="camera-outline" label="Scatta" onPress={() => void pick(true)} />
              <PhotoButton icon="images-outline" label="Galleria" onPress={() => void pick(false)} />
            </>
          )}
        </ScrollView>
        {errors.photos ? <Text variant="small" color="danger">{errors.photos}</Text> : <Text variant="small">Foto nitide e luminose vendono meglio. La posizione GPS viene rimossa.</Text>}
      </View>

      <Field label="Titolo" value={title} onChangeText={setTitle} maxLength={100} error={errors.title} placeholder="Es. Macchina fotografica Leica M6 con obiettivo 50mm" />
      <Field label="Descrizione" value={description} onChangeText={setDescription} multiline maxLength={10000}
        placeholder="Condizioni, difetti, accessori inclusi, misure…" hint="Descrivi anche i difetti: evita contestazioni." />

      <View style={{ gap: spacing(2) }}>
        <Text variant="label">Categoria</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {categories.data?.map((cat) => <Chip key={cat.slug} label={cat.name} selected={category === cat.slug} onPress={() => setCategory(cat.slug)} />)}
        </Row>
        {errors.category && <Text variant="small" color="danger">{errors.category}</Text>}
      </View>

      <View style={{ gap: spacing(2) }}>
        <Text variant="label">Condizioni</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {(Object.keys(CONDITIONS) as Condition[]).map((k) => <Chip key={k} label={CONDITIONS[k]} selected={condition === k} onPress={() => setCondition(k)} />)}
        </Row>
        {errors.condition && <Text variant="small" color="danger">{errors.condition}</Text>}
      </View>

      <Field label="Base d'asta (€)" value={startingPrice} onChangeText={setStartingPrice} keyboardType="decimal-pad" placeholder="10,00" error={errors.startingPrice}
        hint={sellerFee != null ? `Commissione di vendita: ${euro(sellerFee)} su questo prezzo (${(meta.data!.sellerFeeBps / 100).toLocaleString('it-IT')}%), solo se vendi.` : undefined} />
      <Field label="Prezzo di riserva (€, facoltativo)" value={reservePrice} onChangeText={setReservePrice} keyboardType="decimal-pad" error={errors.reservePrice}
        hint="Prezzo minimo segreto: sotto questa cifra l'oggetto non viene venduto." />
      <Field label="Spese di spedizione (€)" value={shippingPrice} onChangeText={setShippingPrice} keyboardType="decimal-pad" placeholder="0,00 = gratuita" error={errors.shippingPrice} />

      <View style={{ gap: spacing(2) }}>
        <Text variant="label">Durata</Text>
        <Row>{DURATIONS.map((d) => <Chip key={d} label={`${d} giorni`} selected={duration === d} onPress={() => setDuration(d)} />)}</Row>
      </View>

      <Button title="Pubblica" loading={busy === 'publish'} disabled={!!busy} onPress={() => void run('publish')} />
      <Button title="Salva bozza" variant="secondary" loading={busy === 'save'} disabled={!!busy} onPress={() => void run('save')} />
    </Screen>
  );
}

function PhotoButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label === 'Scatta' ? 'Scatta una foto' : 'Scegli dalla galleria'}
      style={{ width: 96, height: 96, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: c.border, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: c.surface }}>
      <Ionicons name={icon} size={26} color={c.accent} />
      <Text variant="small">{label}</Text>
    </Pressable>
  );
}
