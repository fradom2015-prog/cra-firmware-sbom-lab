-- Schema iniziale. Importi in centesimi di euro (bigint), istanti in timestamptz.
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE user_role      AS ENUM ('user', 'admin');
CREATE TYPE user_status    AS ENUM ('active', 'suspended', 'deleted');
CREATE TYPE seller_type    AS ENUM ('private', 'business');
CREATE TYPE item_condition AS ENUM ('new', 'like_new', 'good', 'fair', 'for_parts');
CREATE TYPE auction_status AS ENUM ('draft', 'active', 'ended_sold', 'ended_unsold', 'cancelled', 'removed');
CREATE TYPE order_status   AS ENUM ('awaiting_payment', 'paid', 'shipped', 'disputed', 'completed', 'cancelled', 'refunded');

CREATE TABLE users (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                  citext NOT NULL UNIQUE,
  email_verified_at      timestamptz,
  password_hash          text,
  display_name           citext NOT NULL UNIQUE,
  role                   user_role NOT NULL DEFAULT 'user',
  status                 user_status NOT NULL DEFAULT 'active',
  failed_logins          int NOT NULL DEFAULT 0,
  locked_until           timestamptz,
  terms_version          text NOT NULL,
  terms_accepted_at      timestamptz NOT NULL,
  created_at             timestamptz NOT NULL,
  deleted_at             timestamptz
);

-- Sessioni per app e web: token opachi, nel DB solo l'hash SHA-256.
-- Il refresh token ruota a ogni uso; il riuso di un token già ruotato revoca tutta la famiglia.
CREATE TABLE sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id          uuid NOT NULL,
  access_hash        text NOT NULL UNIQUE,
  access_expires_at  timestamptz NOT NULL,
  refresh_hash       text NOT NULL UNIQUE,
  refresh_expires_at timestamptz NOT NULL,
  rotated_at         timestamptz,
  revoked_at         timestamptz,
  user_agent         text,
  ip                 inet,
  created_at         timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_family ON sessions(family_id);

CREATE TABLE email_tokens (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
CREATE INDEX email_tokens_user ON email_tokens(user_id, purpose);

-- Dati del venditore. Per i professionisti sono obbligatori (DSA art. 30, tracciabilità).
CREATE TABLE seller_profiles (
  user_id           uuid PRIMARY KEY REFERENCES users(id),
  type              seller_type NOT NULL,
  legal_name        text NOT NULL,
  vat_number        text,
  tax_code          text,
  address_line      text NOT NULL,
  city              text NOT NULL,
  postal_code       text NOT NULL,
  country           char(2) NOT NULL,
  phone             text,
  business_email    citext,
  stripe_account_id text UNIQUE,
  payouts_enabled   boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL,
  CHECK (type = 'private' OR (vat_number IS NOT NULL AND phone IS NOT NULL AND business_email IS NOT NULL))
);

CREATE TABLE categories (
  id   serial PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL
);
INSERT INTO categories (slug, name) VALUES
  ('elettronica', 'Elettronica'), ('collezionismo', 'Collezionismo'), ('arte', 'Arte'),
  ('orologi-gioielli', 'Orologi e gioielli'), ('moda', 'Moda'), ('casa', 'Casa e arredamento'),
  ('libri', 'Libri e fumetti'), ('sport', 'Sport'), ('motori', 'Ricambi e accessori auto/moto'),
  ('altro', 'Altro');

CREATE TABLE auctions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id        uuid NOT NULL REFERENCES users(id),
  category_id      int NOT NULL REFERENCES categories(id),
  title            text NOT NULL CHECK (char_length(title) BETWEEN 5 AND 100),
  description      text NOT NULL CHECK (char_length(description) <= 10000),
  condition        item_condition NOT NULL,
  starting_price   bigint NOT NULL CHECK (starting_price >= 100),
  reserve_price    bigint CHECK (reserve_price IS NULL OR reserve_price >= starting_price),
  shipping_price   bigint NOT NULL DEFAULT 0 CHECK (shipping_price >= 0),
  duration_days    int NOT NULL CHECK (duration_days BETWEEN 1 AND 14),
  current_price    bigint,
  leader_id        uuid REFERENCES users(id),
  leader_max       bigint,
  bid_count        int NOT NULL DEFAULT 0,
  status           auction_status NOT NULL DEFAULT 'draft',
  starts_at        timestamptz,
  ends_at          timestamptz,
  closed_at        timestamptz,
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL,
  search           tsvector GENERATED ALWAYS AS (
                     setweight(to_tsvector('italian', title), 'A') ||
                     setweight(to_tsvector('italian', description), 'B')) STORED,
  CHECK (status = 'draft' OR (starts_at IS NOT NULL AND ends_at IS NOT NULL))
);
CREATE INDEX auctions_active_end ON auctions(ends_at) WHERE status = 'active';
CREATE INDEX auctions_seller ON auctions(seller_id);
CREATE INDEX auctions_search ON auctions USING gin(search);

CREATE TABLE auction_images (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id  uuid NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  position    int NOT NULL,
  storage_key text NOT NULL,
  width       int NOT NULL,
  height      int NOT NULL,
  UNIQUE (auction_id, position)
);

-- Ogni riga è un'offerta visibile nello storico; max_amount (privato) è il massimo
-- dell'offerta automatica, null per i rilanci fatti dal sistema.
CREATE TABLE bids (
  id              bigserial PRIMARY KEY,
  auction_id      uuid NOT NULL REFERENCES auctions(id),
  bidder_id       uuid NOT NULL REFERENCES users(id),
  amount          bigint NOT NULL,
  max_amount      bigint,
  is_auto         boolean NOT NULL DEFAULT false,
  visible         boolean NOT NULL DEFAULT true,
  idempotency_key text,
  created_at      timestamptz NOT NULL,
  UNIQUE (bidder_id, idempotency_key)
);
CREATE INDEX bids_auction ON bids(auction_id, id DESC);

CREATE TABLE watchlist (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auction_id uuid NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, auction_id)
);

CREATE TABLE blocks (
  blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES users(id),
  target_type text NOT NULL CHECK (target_type IN ('auction', 'user')),
  target_id   uuid NOT NULL,
  reason      text NOT NULL CHECK (reason IN ('counterfeit', 'prohibited_item', 'fraud', 'offensive', 'spam', 'other')),
  details     text NOT NULL DEFAULT '' CHECK (char_length(details) <= 2000),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  resolution  text,
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL
);
CREATE INDEX reports_open ON reports(created_at) WHERE status = 'open';
CREATE UNIQUE INDEX reports_one_open_per_reporter ON reports(reporter_id, target_type, target_id) WHERE status = 'open';

CREATE TABLE orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id        uuid NOT NULL UNIQUE REFERENCES auctions(id),
  buyer_id          uuid NOT NULL REFERENCES users(id),
  seller_id         uuid NOT NULL REFERENCES users(id),
  item_amount       bigint NOT NULL,
  shipping_amount   bigint NOT NULL,
  buyer_fee         bigint NOT NULL,
  seller_fee        bigint NOT NULL,
  total_amount      bigint NOT NULL CHECK (total_amount = item_amount + shipping_amount + buyer_fee),
  status            order_status NOT NULL DEFAULT 'awaiting_payment',
  payment_intent_id text UNIQUE,
  transfer_id       text UNIQUE,
  refund_id         text UNIQUE,
  shipping_address  jsonb,
  payment_due_at    timestamptz NOT NULL,
  paid_at           timestamptz,
  shipped_at        timestamptz,
  tracking_carrier  text,
  tracking_number   text,
  dispute_reason    text,
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL
);
CREATE INDEX orders_buyer ON orders(buyer_id);
CREATE INDEX orders_seller ON orders(seller_id);
CREATE INDEX orders_status ON orders(status);

CREATE TABLE reviews (
  order_id    uuid PRIMARY KEY REFERENCES orders(id),
  seller_id   uuid NOT NULL REFERENCES users(id),
  reviewer_id uuid NOT NULL REFERENCES users(id),
  rating      int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text NOT NULL DEFAULT '' CHECK (char_length(comment) <= 1000),
  created_at  timestamptz NOT NULL
);
CREATE INDEX reviews_seller ON reviews(seller_id);

-- Eventi Stripe già elaborati: i webhook possono arrivare più volte.
CREATE TABLE payment_events (
  id           text PRIMARY KEY,
  type         text NOT NULL,
  processed_at timestamptz NOT NULL
);

CREATE TABLE push_tokens (
  token      text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform   text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  created_at timestamptz NOT NULL
);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  user_id    uuid,
  action     text NOT NULL,
  ip         inet,
  meta       jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL
);
CREATE INDEX audit_log_user ON audit_log(user_id, created_at);
