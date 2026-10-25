export type Condition = 'new' | 'like_new' | 'good' | 'fair' | 'for_parts';
export type AuctionStatus = 'draft' | 'active' | 'ended_sold' | 'ended_unsold' | 'cancelled' | 'removed';
export type OrderStatus = 'awaiting_payment' | 'paid' | 'shipped' | 'disputed' | 'completed' | 'cancelled' | 'refunded';

export interface Image {
  id: string;
  url: string;
  width: number;
  height: number;
}

export interface Auction {
  id: string;
  title: string;
  description: string;
  condition: Condition;
  category: { slug: string; name: string };
  seller: { id: string; displayName: string; type: 'private' | 'business' | null };
  images: Image[];
  startingPrice: number;
  currentPrice: number | null;
  minimumBid: number | null;
  shippingPrice: number;
  durationDays: number;
  bidCount: number;
  hasReserve: boolean;
  reserveMet: boolean | null;
  leader: string | null;
  status: AuctionStatus;
  startsAt: string | null;
  endsAt: string | null;
  viewer: { isSeller: boolean; isLeader: boolean; maxBid: number | null } | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Bid {
  id: number;
  amount: number;
  isAuto: boolean;
  createdAt: string;
  bidder: string;
  isMine: boolean;
}

export interface Me {
  id: string;
  email: string;
  displayName: string;
  role: 'user' | 'admin';
  emailVerified: boolean;
  createdAt: string;
  seller: { type: 'private' | 'business'; payoutsEnabled: boolean } | null;
}

export interface Address {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  province?: string;
  country: string;
  phone: string;
}

export interface Order {
  id: string;
  auctionId: string;
  title: string;
  role: 'buyer' | 'seller';
  buyer: string;
  seller: string;
  status: OrderStatus;
  itemAmount: number;
  shippingAmount: number;
  buyerFee?: number;
  totalAmount?: number;
  sellerFee?: number;
  payout?: number;
  shippingAddress: Address | null;
  paymentDueAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  tracking: { carrier: string; number: string } | null;
  disputeReason: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface PublicUser {
  id: string;
  displayName: string;
  memberSince: string;
  suspended: boolean;
  sellerType: 'private' | 'business' | null;
  business: { legalName: string; vatNumber: string; address: string; phone: string; email: string } | null;
  rating: { average: number; count: number } | null;
  completedSales: number;
  reviews: { rating: number; comment: string; createdAt: string; reviewer: string }[];
}

export interface Category {
  slug: string;
  name: string;
}
