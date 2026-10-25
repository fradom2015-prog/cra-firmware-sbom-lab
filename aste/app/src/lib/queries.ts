import { useEffect } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { realtime } from './realtime';
import type { Auction, Bid, Category, Order, Page, PublicUser } from './types';

export const keys = {
  auction: (id: string) => ['auction', id] as const,
  bids: (id: string) => ['auction', id, 'bids'] as const,
};

export const useCategories = () =>
  useQuery({ queryKey: ['categories'], queryFn: () => api<{ categories: Category[] }>('/categories').then((r) => r.categories), staleTime: Infinity });

export interface SearchParams {
  q?: string;
  category?: string;
  sort?: string;
  status?: 'active' | 'ended';
}

export function useAuctionSearch(params: SearchParams) {
  return useInfiniteQuery({
    queryKey: ['auctions', params],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ page: String(pageParam) });
      for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
      return api<Page<Auction>>(`/auctions?${qs}`);
    },
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
}

export const useMyList = (kind: 'auctions' | 'bidding' | 'watchlist', enabled = true) =>
  useQuery({ queryKey: ['me', kind], queryFn: () => api<Page<Auction>>(`/me/${kind}`), enabled });

export const useOrders = (role: 'buyer' | 'seller', enabled = true) =>
  useQuery({ queryKey: ['orders', role], queryFn: () => api<{ orders: Order[] }>(`/orders?role=${role}`).then((r) => r.orders), enabled });

export const useOrder = (id: string) =>
  useQuery({ queryKey: ['order', id], queryFn: () => api<{ order: Order }>(`/orders/${id}`).then((r) => r.order) });

export const usePublicUser = (id: string) =>
  useQuery({ queryKey: ['user', id], queryFn: () => api<{ user: PublicUser }>(`/users/${id}`).then((r) => r.user) });

export function useAuction(id: string) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: keys.auction(id), queryFn: () => api<{ auction: Auction; watching: boolean }>(`/auctions/${id}`) });
  const bids = useQuery({ queryKey: keys.bids(id), queryFn: () => api<{ bids: Bid[] }>(`/auctions/${id}/bids`).then((r) => r.bids) });

  // Aggiornamenti in tempo reale: alla prima notizia si ricaricano asta e storico,
  // così i dati personali (sono in testa? il mio massimo) restano corretti.
  useEffect(() => realtime.subscribeAuction(id, () => {
    void qc.invalidateQueries({ queryKey: keys.auction(id) });
  }), [id, qc]);

  return { ...query, bids };
}

export interface Meta {
  buyerFeeBps: number;
  sellerFeeBps: number;
  paymentDueDays: number;
  autoReleaseDays: number;
  antiSnipingMinutes: number;
  termsVersion: string;
}

export const useMeta = () => useQuery({ queryKey: ['meta'], queryFn: () => api<Meta>('/meta'), staleTime: 60 * 60_000 });
