-- 0019 — the customer portal's storage (task #35, the third door).
--
-- src/portal/account.ts has shipped since cycle 29 with scrypt hashing,
-- single-use invites and a timing-safe sign-in, and NOWHERE TO PUT ANY OF IT.
-- Found by the 2026-08-04 audit: a fully built, fully tested door with no
-- table behind it and no route in front of it. This is the table half.
--
-- §4.3: both tables are service-role only. The portal never talks to Postgres
-- from a browser — the server reads on the customer's behalf after checking a
-- session, exactly like the crew and admin doors.

-- ===========================================================================
-- PORTAL ACCOUNT — one login, one property. Deliberately not one-to-many:
-- `src/portal/customerView.ts` shapes ONE property and cannot express more
-- than one, so an account that could reach two would be a door wider than the
-- room behind it. A customer with two properties gets two accounts.
-- ===========================================================================
create table if not exists portal_account (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references property(id) on delete cascade,
  -- Stored lowercased and trimmed by provisionPortalInvite(). Unique so a
  -- second provision for the same address cannot silently create a rival
  -- login that the first customer's password no longer opens.
  email         text not null unique,
  -- scrypt: `salthex:keyhex`, per-account salt, plaintext never stored.
  -- Nullable ON PURPOSE — the row exists from the moment the invite is
  -- prepared, and stays passwordless until the customer sets one. A null
  -- here means "invited, never signed up", which is a different fact from
  -- "no account" and the portal says so.
  password_hash text,
  last_sign_in_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint portal_account_hash_shape
    check (password_hash is null or password_hash ~ '^[0-9a-f]+:[0-9a-f]+$')
);
create index if not exists portal_account_property_idx on portal_account (property_id);

-- ===========================================================================
-- PORTAL INVITE — 32 random bytes, single use, seven-day life.
--
-- THERE IS NO `sent_at` COLUMN AND THERE MUST NOT BE ONE. Arbo prepares the
-- invite; it does not send it ("Never send email. Ever." — CLAUDE.md; R7
-- keeps Resend out of scope). `ProvisionResult.emailSent` is typed as the
-- literal `false` in the code, and the schema agrees with it: there is
-- nowhere here to record a send, because no send happens.
-- ===========================================================================
create table if not exists portal_invite (
  token        text primary key check (char_length(token) = 64),
  property_id  uuid not null references property(id) on delete cascade,
  email        text not null,
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  -- Set once, when the customer uses it. A used invite is dead and stays on
  -- file: "this link was used at 09:12" is a fact worth keeping.
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists portal_invite_property_idx on portal_invite (property_id);
create index if not exists portal_invite_email_idx on portal_invite (email);

-- Service-role only, same as the rest of the spine (§4.3).
alter table portal_account enable row level security;
alter table portal_invite enable row level security;
