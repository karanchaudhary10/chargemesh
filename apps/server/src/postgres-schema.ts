// One PostgreSQL database, one schema per data category. Each entity row keeps
// the full object in `data` and copies the fields we look up by into indexed
// columns. `pos` preserves insertion order so list() returns rows in the order
// they were created, matching the insertion-order semantics the services expect.
export const POSTGRES_SCHEMA_SQL = `
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS property;
CREATE SCHEMA IF NOT EXISTS metering;
CREATE SCHEMA IF NOT EXISTS billing;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS system;

CREATE TABLE IF NOT EXISTS identity.users (
  id         text PRIMARY KEY,
  pos        bigserial,
  email      text NOT NULL UNIQUE,
  role       text NOT NULL,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity.sessions (
  session_id text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  role       text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON identity.sessions (user_id);

CREATE TABLE IF NOT EXISTS property.properties (
  id         text PRIMARY KEY,
  pos        bigserial,
  owner_id   text,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS properties_owner_idx ON property.properties (owner_id);

CREATE TABLE IF NOT EXISTS property.rooms (
  id          text PRIMARY KEY,
  pos         bigserial,
  property_id text,
  data        jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rooms_property_idx ON property.rooms (property_id);

CREATE TABLE IF NOT EXISTS property.tenancies (
  id         text PRIMARY KEY,
  pos        bigserial,
  room_id    text NOT NULL REFERENCES property.rooms(id),
  user_id    text NOT NULL REFERENCES identity.users(id),
  status     text NOT NULL,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenancies_room_idx ON property.tenancies (room_id, status);
CREATE INDEX IF NOT EXISTS tenancies_user_idx ON property.tenancies (user_id, status);

CREATE TABLE IF NOT EXISTS metering.meters (
  id         text PRIMARY KEY,
  pos        bigserial,
  meter_id   text,
  room_id    text,
  status     text,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meters_meter_id_idx ON metering.meters (meter_id);
CREATE INDEX IF NOT EXISTS meters_room_idx ON metering.meters (room_id, status);

CREATE TABLE IF NOT EXISTS metering.meter_keys (
  meter_id        text PRIMARY KEY,
  private_key_pem text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS metering.readings (
  id           text PRIMARY KEY,
  pos          bigserial,
  reading_id   text,
  payload_hash text NOT NULL,
  meter_id     text NOT NULL,
  room_id      text,
  session_id   text,
  status       text NOT NULL,
  sequence     bigint,
  received_at  timestamptz,
  data         jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS readings_reading_id_idx ON metering.readings (reading_id);
CREATE INDEX IF NOT EXISTS readings_payload_hash_idx ON metering.readings (payload_hash);
CREATE INDEX IF NOT EXISTS readings_meter_seq_idx ON metering.readings (meter_id, sequence);
CREATE INDEX IF NOT EXISTS readings_room_idx ON metering.readings (room_id);
CREATE INDEX IF NOT EXISTS readings_session_idx ON metering.readings (session_id);

CREATE TABLE IF NOT EXISTS billing.tariffs (
  id         text PRIMARY KEY,
  pos        bigserial,
  tariff_id  text,
  room_id    text,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tariffs_tariff_id_idx ON billing.tariffs (tariff_id);

CREATE TABLE IF NOT EXISTS billing.bills (
  id         text PRIMARY KEY,
  pos        bigserial,
  bill_id    text,
  room_id    text,
  status     text,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bills_bill_id_idx ON billing.bills (bill_id);
CREATE INDEX IF NOT EXISTS bills_room_idx ON billing.bills (room_id, status);

CREATE TABLE IF NOT EXISTS billing.disputes (
  id         text PRIMARY KEY,
  pos        bigserial,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit.events (
  id   text PRIMARY KEY,
  pos  bigserial,
  seq  bigint NOT NULL UNIQUE,
  data jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS audit.cre_reports (
  report_id text PRIMARY KEY,
  pos       bigserial,
  data      jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS system.integration_state (
  id         text PRIMARY KEY DEFAULT 'singleton',
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity.user_wallets (
  id         text PRIMARY KEY,
  pos        bigserial,
  user_id    text NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  is_default boolean NOT NULL DEFAULT FALSE,
  is_active  boolean NOT NULL DEFAULT TRUE,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_wallets_user_idx ON identity.user_wallets (user_id);
CREATE INDEX IF NOT EXISTS user_wallets_default_idx ON identity.user_wallets (user_id, is_default);
`;

export const POSTGRES_TRUNCATE_ALL_SQL = `
TRUNCATE identity.users, identity.sessions, identity.user_wallets,
  property.properties, property.rooms, property.tenancies,
  metering.meters, metering.meter_keys, metering.readings,
  billing.tariffs, billing.bills, billing.disputes,
  audit.events, audit.cre_reports,
  system.integration_state
RESTART IDENTITY CASCADE;
`;
