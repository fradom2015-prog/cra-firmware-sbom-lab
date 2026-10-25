import type { ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text as RNText, TextInput, View,
  type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewProps, type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { radius, spacing, useColors, type Colors } from '@/theme';

type Variant = 'title' | 'heading' | 'body' | 'muted' | 'small' | 'price' | 'label';

const variants: Record<Variant, TextStyle> = {
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.3 },
  heading: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 23 },
  muted: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13 },
  price: { fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  label: { fontSize: 14, fontWeight: '600' },
};

export function Text({ variant = 'body', color, style, ...props }: TextProps & { variant?: Variant; color?: keyof Colors }) {
  const c = useColors();
  const tint = color ? c[color] : variant === 'muted' || variant === 'small' ? c.textMuted : c.text;
  return <RNText {...props} style={[variants[variant], { color: tint }, style]} />;
}

export function Screen({ children, scroll = true, edges = ['top'], style }: { children: ReactNode; scroll?: boolean; edges?: Edge[]; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: c.bg }}>
      {scroll ? (
        <ScrollView contentContainerStyle={[styles.screen, style]} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      ) : (
        <View style={[styles.screen, { flex: 1 }, style]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

export function Button({ title, onPress, variant = 'primary', loading, disabled, style, accessibilityHint }: ButtonProps) {
  const c = useColors();
  const bg = { primary: c.accent, secondary: c.surface, danger: c.danger, ghost: 'transparent' }[variant];
  const fg = { primary: c.accentText, secondary: c.text, danger: '#FFFFFF', ghost: c.accent }[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: variant === 'secondary' ? c.border : bg, opacity: inactive ? 0.55 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <RNText style={[styles.buttonText, { color: fg }]}>{title}</RNText>}
    </Pressable>
  );
}

export function Field({ label, error, hint, style, ...props }: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  const c = useColors();
  return (
    <View style={{ gap: spacing(1.5) }}>
      <Text variant="label">{label}</Text>
      <TextInput
        placeholderTextColor={c.textMuted}
        accessibilityLabel={label}
        {...props}
        style={[styles.input, { backgroundColor: c.surface, color: c.text, borderColor: error ? c.danger : c.border }, props.multiline && { minHeight: 110, textAlignVertical: 'top' }, style]}
      />
      {error ? <Text variant="small" color="danger" accessibilityLiveRegion="polite">{error}</Text> : hint ? <Text variant="small">{hint}</Text> : null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }, style]}>{children}</View>;
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'accent' | 'success' | 'danger' | 'warning' }) {
  const c = useColors();
  const [bg, fg] = {
    neutral: [c.surfaceAlt, c.textMuted], accent: [c.accentSoft, c.accent], success: [c.successSoft, c.success],
    danger: [c.dangerSoft, c.danger], warning: [c.warningSoft, c.warning],
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <RNText style={{ color: fg, fontSize: 12, fontWeight: '600' }}>{label}</RNText>
    </View>
  );
}

export function Notice({ children, tone = 'neutral', action }: { children: ReactNode; tone?: 'neutral' | 'success' | 'danger' | 'warning' | 'accent'; action?: ReactNode }) {
  const c = useColors();
  const [bg, fg] = {
    neutral: [c.surfaceAlt, c.text], accent: [c.accentSoft, c.accent], success: [c.successSoft, c.success],
    danger: [c.dangerSoft, c.danger], warning: [c.warningSoft, c.warning],
  }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: bg }]} accessibilityRole="summary">
      <RNText style={{ color: fg, fontSize: 15, lineHeight: 21 }}>{children}</RNText>
      {action}
    </View>
  );
}

export function Loading() {
  const c = useColors();
  return <View style={styles.center}><ActivityIndicator size="large" color={c.accent} accessibilityLabel="Caricamento" /></View>;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Qualcosa è andato storto.';
  return (
    <View style={[styles.center, { gap: spacing(3) }]}>
      <Text variant="muted" style={{ textAlign: 'center' }}>{message}</Text>
      {onRetry && <Button title="Riprova" variant="secondary" onPress={onRetry} />}
    </View>
  );
}

export function Empty({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <View style={[styles.center, { gap: spacing(2), paddingVertical: spacing(10) }]}>
      <Text variant="heading" style={{ textAlign: 'center' }}>{title}</Text>
      {message && <Text variant="muted" style={{ textAlign: 'center' }}>{message}</Text>}
      {action}
    </View>
  );
}

export function Row({ children, style, ...props }: ViewProps) {
  return <View {...props} style={[{ flexDirection: 'row', alignItems: 'center', gap: spacing(2) }, style]}>{children}</View>;
}

export function ListItem({ title, subtitle, onPress, right, destructive }: { title: string; subtitle?: string; onPress?: () => void; right?: ReactNode; destructive?: boolean }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.listItem, { borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text color={destructive ? 'danger' : undefined}>{title}</Text>
        {subtitle && <Text variant="small">{subtitle}</Text>}
      </View>
      {right ?? <Text variant="muted">›</Text>}
    </Pressable>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const c = useColors();
  return (
    <View style={[styles.segmented, { backgroundColor: c.surfaceAlt }]} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="tab" accessibilityState={{ selected: active }}
            style={[styles.segment, active && { backgroundColor: c.surface }]}>
            <RNText numberOfLines={1} style={{ color: active ? c.text : c.textMuted, fontWeight: active ? '600' : '500', fontSize: 14 }}>{o.label}</RNText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!selected }}
      style={[styles.chip, { backgroundColor: selected ? c.accent : c.surface, borderColor: selected ? c.accent : c.border }]}>
      <RNText style={{ color: selected ? c.accentText : c.text, fontSize: 14, fontWeight: '500' }}>{label}</RNText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing(4), gap: spacing(4), paddingBottom: spacing(10) },
  button: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing(5) },
  buttonText: { fontSize: 16, fontWeight: '600' },
  input: { minHeight: 50, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing(3.5), paddingVertical: spacing(3), fontSize: 16 },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing(4), gap: spacing(3) },
  badge: { alignSelf: 'flex-start', paddingHorizontal: spacing(2), paddingVertical: 3, borderRadius: radius.pill },
  notice: { borderRadius: radius.md, padding: spacing(3.5), gap: spacing(2.5) },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing(6) },
  listItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing(3.5), borderBottomWidth: StyleSheet.hairlineWidth, gap: spacing(3), minHeight: 52 },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 3 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: spacing(2), borderRadius: radius.sm },
  chip: { paddingHorizontal: spacing(3.5), paddingVertical: spacing(2), borderRadius: radius.pill, borderWidth: 1 },
});
