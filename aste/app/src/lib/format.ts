import type { AuctionStatus, Condition, OrderStatus } from './types';

const euroFmt = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
export const euro = (cents: number) => euroFmt.format(cents / 100);

// "12,50", "12.50", "1.250,00", "€ 30" → centesimi; null se non valido.
export function parseEuro(text: string): number | null {
  let s = text.replace(/[€\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export const centsToInput = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

export function timeLeft(endsAt: string | null, now: number): string {
  if (!endsAt) return '';
  const s = Math.floor((new Date(endsAt).getTime() - now) / 1000);
  if (s <= 0) return 'Conclusa';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}g ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(sec).padStart(2, '0')}s`;
}

export const isEndingSoon = (endsAt: string | null, now: number) =>
  !!endsAt && new Date(endsAt).getTime() - now < 60 * 60 * 1000;

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const dateOnly = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

export const CONDITIONS: Record<Condition, string> = {
  new: 'Nuovo',
  like_new: 'Come nuovo',
  good: 'Buone condizioni',
  fair: 'Condizioni discrete',
  for_parts: 'Per ricambi / non funzionante',
};

export const AUCTION_STATUS: Record<AuctionStatus, string> = {
  draft: 'Bozza',
  active: 'In corso',
  ended_sold: 'Venduta',
  ended_unsold: 'Non venduta',
  cancelled: 'Ritirata',
  removed: 'Rimossa',
};

export const ORDER_STATUS: Record<OrderStatus, string> = {
  awaiting_payment: 'Da pagare',
  paid: 'Pagato, da spedire',
  shipped: 'Spedito',
  disputed: 'In contestazione',
  completed: 'Concluso',
  cancelled: 'Annullato',
  refunded: 'Rimborsato',
};
