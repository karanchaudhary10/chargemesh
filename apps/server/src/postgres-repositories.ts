import crypto from "node:crypto";
import pg from "pg";
import type {
  AuditEvent,
  AuthSession,
  CreReport,
  Dispute,
  Meter,
  Property,
  Reading,
  Room,
  Session,
  Tariff,
  Tenancy,
  User,
  UserRole
} from "@chargemesh/shared";
import type { AuthRepo } from "./auth.js";
import { POSTGRES_SCHEMA_SQL } from "./postgres-schema.js";
import type {
  AuditEventRepository,
  BillRepository,
  CreReportRepository,
  DisputeRepository,
  IntegrationState,
  IntegrationStateRepository,
  MeterKeyRepository,
  MeterRepository,
  PropertyRepository,
  ReadingFilter,
  ReadingRepository,
  Repositories,
  RepositoryTransaction,
  RoomRepository,
  TariffRepository,
  TenancyRepository,
  UserRepository,
  UserWalletRepository
} from "./repositories.js";

type Queryable = Pick<pg.Pool | pg.PoolClient, "query">;

// Arbitrary constant key so transactions are serialized across API processes,
// so read-then-write checks (e.g. audit chain sequencing) never interleave.
const TRANSACTION_LOCK_KEY = 0x63686d73;

async function rows<T>(db: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query<{ data: T }>(sql, params);
  return result.rows.map((row) => row.data);
}

async function first<T>(db: Queryable, sql: string, params: unknown[] = []): Promise<T | null> {
  return (await rows<T>(db, sql, params))[0] ?? null;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

class PgPropertyRepository implements PropertyRepository {
  constructor(private readonly db: Queryable) {}

  list(): Promise<Property[]> {
    return rows(this.db, "SELECT data FROM property.properties ORDER BY pos");
  }

  findById(id: string): Promise<Property | null> {
    return first(this.db, "SELECT data FROM property.properties WHERE id = $1", [id]);
  }

  findByOwnerId(ownerId: string): Promise<Property[]> {
    return rows(this.db, "SELECT data FROM property.properties WHERE owner_id = $1 ORDER BY pos", [ownerId]);
  }

  async save(property: Property): Promise<void> {
    await this.db.query(
      `INSERT INTO property.properties (id, owner_id, data) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id, data = EXCLUDED.data, updated_at = now()`,
      [property.id, property.ownerId ?? null, json(property)]
    );
  }
}

class PgRoomRepository implements RoomRepository {
  constructor(private readonly db: Queryable) {}

  list(): Promise<Room[]> {
    return rows(this.db, "SELECT data FROM property.rooms ORDER BY pos");
  }

  findById(id: string): Promise<Room | null> {
    return first(this.db, "SELECT data FROM property.rooms WHERE id = $1", [id]);
  }

  findByPropertyId(propertyId: string): Promise<Room[]> {
    return rows(this.db, "SELECT data FROM property.rooms WHERE property_id = $1 ORDER BY pos", [propertyId]);
  }

  async save(room: Room): Promise<void> {
    await this.db.query(
      `INSERT INTO property.rooms (id, property_id, data) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET property_id = EXCLUDED.property_id, data = EXCLUDED.data, updated_at = now()`,
      [room.id, room.propertyId ?? null, json(room)]
    );
  }
}

class PgTenancyRepository implements TenancyRepository {
  constructor(private readonly db: Queryable) {}

  list(): Promise<Tenancy[]> {
    return rows(this.db, "SELECT data FROM property.tenancies ORDER BY pos");
  }

  findById(id: string): Promise<Tenancy | null> {
    return first(this.db, "SELECT data FROM property.tenancies WHERE id = $1", [id]);
  }

  findByRoomId(roomId: string): Promise<Tenancy[]> {
    return rows(this.db, "SELECT data FROM property.tenancies WHERE room_id = $1 ORDER BY pos", [roomId]);
  }

  findByUserId(userId: string): Promise<Tenancy[]> {
    return rows(this.db, "SELECT data FROM property.tenancies WHERE user_id = $1 ORDER BY pos", [userId]);
  }

  findActiveByRoom(roomId: string): Promise<Tenancy | null> {
    return first(
      this.db,
      "SELECT data FROM property.tenancies WHERE room_id = $1 AND status = 'active' ORDER BY pos LIMIT 1",
      [roomId]
    );
  }

  findActiveByUser(userId: string): Promise<Tenancy[]> {
    return rows(
      this.db,
      "SELECT data FROM property.tenancies WHERE user_id = $1 AND status = 'active' ORDER BY pos",
      [userId]
    );
  }

  async save(tenancy: Tenancy): Promise<void> {
    await this.db.query(
      `INSERT INTO property.tenancies (id, room_id, user_id, status, data) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET room_id = EXCLUDED.room_id, user_id = EXCLUDED.user_id,
         status = EXCLUDED.status, data = EXCLUDED.data, updated_at = now()`,
      [tenancy.tenancyId, tenancy.roomId, tenancy.userId, tenancy.status, json(tenancy)]
    );
  }
}

class PgUserRepository implements UserRepository {
  constructor(private readonly db: Queryable) {}

  list(): Promise<User[]> {
    return rows(this.db, "SELECT data FROM identity.users ORDER BY pos");
  }

  findById(id: string): Promise<User | null> {
    return first(this.db, "SELECT data FROM identity.users WHERE id = $1", [id]);
  }

  findByEmail(email: string): Promise<User | null> {
    return first(this.db, "SELECT data FROM identity.users WHERE email = $1", [email.toLowerCase()]);
  }

  async save(user: User): Promise<void> {
    await this.db.query(
      `INSERT INTO identity.users (id, email, role, data) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role,
         data = EXCLUDED.data, updated_at = now()`,
      [user.id, user.email.toLowerCase(), user.role, json(user)]
    );
  }
}

class PgMeterRepository implements MeterRepository {
  constructor(private readonly db: Queryable) {}

  list(): Promise<Meter[]> {
    return rows(this.db, "SELECT data FROM metering.meters ORDER BY pos");
  }

  findById(id: string): Promise<Meter | null> {
    return first(
      this.db,
      "SELECT data FROM metering.meters WHERE id = $1 OR meter_id = $1 ORDER BY pos LIMIT 1",
      [id]
    );
  }

  findByMeterId(meterId: string): Promise<Meter | null> {
    return this.findById(meterId);
  }

  findActiveByRoom(roomId: string): Promise<Meter | null> {
    return first(
      this.db,
      "SELECT data FROM metering.meters WHERE room_id = $1 AND status = 'active' ORDER BY pos LIMIT 1",
      [roomId]
    );
  }

  async save(meter: Meter): Promise<void> {
    const meterId = (meter as any).meterId ?? null;
    await this.db.query(
      `INSERT INTO metering.meters (id, meter_id, room_id, status, data) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET meter_id = EXCLUDED.meter_id, room_id = EXCLUDED.room_id,
         status = EXCLUDED.status, data = EXCLUDED.data, updated_at = now()`,
      [meter.id ?? meterId, meterId, (meter as any).roomId ?? null, (meter as any).status ?? null, json(meter)]
    );
  }
}

class PgMeterKeyRepository implements MeterKeyRepository {
  constructor(private readonly db: Queryable) {}

  async list(): Promise<Array<{ meterId: string; privateKeyPem: string }>> {
    const result = await this.db.query<{ meter_id: string; private_key_pem: string }>(
      "SELECT meter_id, private_key_pem FROM metering.meter_keys"
    );
    return result.rows.map((row) => ({ meterId: row.meter_id, privateKeyPem: row.private_key_pem }));
  }

  async save(meterId: string, privateKeyPem: string): Promise<void> {
    await this.db.query(
      `INSERT INTO metering.meter_keys (meter_id, private_key_pem) VALUES ($1, $2)
       ON CONFLICT (meter_id) DO UPDATE SET private_key_pem = EXCLUDED.private_key_pem`,
      [meterId, privateKeyPem]
    );
  }
}

class PgReadingRepository implements ReadingRepository {
  constructor(private readonly db: Queryable) {}

  list(filter: ReadingFilter = {}): Promise<Reading[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const add = (column: string, value: unknown) => {
      params.push(value);
      clauses.push(`${column} = $${params.length}`);
    };
    if (filter.meterId) add("meter_id", filter.meterId);
    if (filter.roomId) add("room_id", filter.roomId);
    if (filter.sessionId) add("session_id", filter.sessionId);
    if (filter.status) add("status", filter.status);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return rows(this.db, `SELECT data FROM metering.readings ${where} ORDER BY pos`, params);
  }

  findById(id: string): Promise<Reading | null> {
    return first(
      this.db,
      "SELECT data FROM metering.readings WHERE id = $1 OR reading_id = $1 ORDER BY pos LIMIT 1",
      [id]
    );
  }

  findByReadingId(readingId: string): Promise<Reading | null> {
    return this.findById(readingId);
  }

  findByPayloadHash(payloadHash: string): Promise<Reading | null> {
    return first(
      this.db,
      "SELECT data FROM metering.readings WHERE payload_hash = $1 ORDER BY pos LIMIT 1",
      [payloadHash]
    );
  }

  findByMeterAndSequence(meterId: string, sequence: number): Promise<Reading | null> {
    return first(
      this.db,
      "SELECT data FROM metering.readings WHERE meter_id = $1 AND sequence = $2 ORDER BY pos LIMIT 1",
      [meterId, sequence]
    );
  }

  async save(reading: Reading): Promise<void> {
    const sequence = Number.isSafeInteger(reading.payload?.sequence) ? reading.payload.sequence : null;
    await this.db.query(
      `INSERT INTO metering.readings
         (id, reading_id, payload_hash, meter_id, room_id, session_id, status, sequence, received_at, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET reading_id = EXCLUDED.reading_id, payload_hash = EXCLUDED.payload_hash,
         meter_id = EXCLUDED.meter_id, room_id = EXCLUDED.room_id, session_id = EXCLUDED.session_id,
         status = EXCLUDED.status, sequence = EXCLUDED.sequence, received_at = EXCLUDED.received_at,
         data = EXCLUDED.data`,
      [
        reading.id ?? reading.readingId,
        reading.readingId ?? null,
        reading.payloadHash,
        reading.meterId,
        reading.roomId ?? null,
        reading.sessionId ?? null,
        reading.status,
        sequence,
        reading.receivedAt ?? null,
        json(reading)
      ]
    );
  }
}

class PgTariffRepository implements TariffRepository {
  constructor(private readonly db: Queryable) {}

  list(): Promise<Tariff[]> {
    return rows(this.db, "SELECT data FROM billing.tariffs ORDER BY pos");
  }

  findById(id: string): Promise<Tariff | null> {
    return first(
      this.db,
      "SELECT data FROM billing.tariffs WHERE id = $1 OR tariff_id = $1 ORDER BY pos LIMIT 1",
      [id]
    );
  }

  async save(tariff: Tariff): Promise<void> {
    await this.db.query(
      `INSERT INTO billing.tariffs (id, tariff_id, room_id, data) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET tariff_id = EXCLUDED.tariff_id, room_id = EXCLUDED.room_id,
         data = EXCLUDED.data, updated_at = now()`,
      [tariff.id ?? tariff.tariffId, tariff.tariffId ?? null, tariff.roomId ?? null, json(tariff)]
    );
  }
}

class PgBillRepository implements BillRepository {
  constructor(private readonly db: Queryable) {}

  list(): Promise<Session[]> {
    return rows(this.db, "SELECT data FROM billing.bills ORDER BY pos");
  }

  findById(id: string): Promise<Session | null> {
    return first(
      this.db,
      "SELECT data FROM billing.bills WHERE id = $1 OR bill_id = $1 ORDER BY pos LIMIT 1",
      [id]
    );
  }

  findActiveByRoom(roomId: string): Promise<Session | null> {
    return first(
      this.db,
      "SELECT data FROM billing.bills WHERE room_id = $1 AND status = 'active' ORDER BY pos LIMIT 1",
      [roomId]
    );
  }

  async save(bill: Session): Promise<void> {
    const billId = (bill as any).billId ?? null;
    await this.db.query(
      `INSERT INTO billing.bills (id, bill_id, room_id, status, data) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET bill_id = EXCLUDED.bill_id, room_id = EXCLUDED.room_id,
         status = EXCLUDED.status, data = EXCLUDED.data, updated_at = now()`,
      [bill.id ?? billId, billId, bill.roomId ?? null, bill.status ?? null, json(bill)]
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.query("DELETE FROM billing.bills WHERE id = $1 OR bill_id = $1", [id]);
  }
}

class PgDisputeRepository implements DisputeRepository {
  constructor(private readonly db: Queryable) {}

  list(): Promise<Dispute[]> {
    return rows(this.db, "SELECT data FROM billing.disputes ORDER BY pos");
  }

  findById(id: string): Promise<Dispute | null> {
    return first(this.db, "SELECT data FROM billing.disputes WHERE id = $1", [id]);
  }

  async save(dispute: Dispute): Promise<void> {
    await this.db.query(
      `INSERT INTO billing.disputes (id, data) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [dispute.id, json(dispute)]
    );
  }
}

class PgAuditEventRepository implements AuditEventRepository {
  constructor(private readonly db: Queryable) {}

  list(): Promise<AuditEvent[]> {
    return rows(this.db, "SELECT data FROM audit.events ORDER BY pos");
  }

  findById(id: string): Promise<AuditEvent | null> {
    return first(this.db, "SELECT data FROM audit.events WHERE id = $1", [id]);
  }

  head(): Promise<AuditEvent | null> {
    return first(this.db, "SELECT data FROM audit.events ORDER BY seq DESC LIMIT 1");
  }

  async save(event: AuditEvent): Promise<void> {
    await this.db.query(
      `INSERT INTO audit.events (id, seq, data) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET seq = EXCLUDED.seq, data = EXCLUDED.data`,
      [event.id, event.seq, json(event)]
    );
  }
}

class PgCreReportRepository implements CreReportRepository {
  constructor(private readonly db: Queryable) {}

  list(): Promise<CreReport[]> {
    return rows(this.db, "SELECT data FROM audit.cre_reports ORDER BY pos");
  }

  findById(reportId: string): Promise<CreReport | null> {
    return first(this.db, "SELECT data FROM audit.cre_reports WHERE report_id = $1", [reportId]);
  }

  async save(report: CreReport): Promise<void> {
    await this.db.query(
      `INSERT INTO audit.cre_reports (report_id, data) VALUES ($1, $2)
       ON CONFLICT (report_id) DO UPDATE SET data = EXCLUDED.data`,
      [report.reportId, json(report)]
    );
  }
}

class PgSingletonRepository<T> {
  constructor(
    private readonly db: Queryable,
    private readonly table: string,
    private readonly fallback: () => T
  ) {}

  async get(): Promise<T> {
    return (await first<T>(this.db, `SELECT data FROM ${this.table} WHERE id = 'singleton'`)) ?? this.fallback();
  }

  async save(state: T): Promise<void> {
    await this.db.query(
      `INSERT INTO ${this.table} (id, data) VALUES ('singleton', $1)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [json(state)]
    );
  }
}

class PgIntegrationStateRepository
  extends PgSingletonRepository<IntegrationState>
  implements IntegrationStateRepository
{
  constructor(db: Queryable) {
    super(db, "system.integration_state", () => ({ hedera: {} }));
  }
}

class PgUserWalletRepository implements UserWalletRepository {
  constructor(private readonly db: Queryable) {}

  listByUserId(userId: string): Promise<any[]> {
    return rows(this.db, "SELECT data FROM identity.user_wallets WHERE user_id = $1 ORDER BY pos", [userId]);
  }

  findById(id: string): Promise<any | null> {
    return first(this.db, "SELECT data FROM identity.user_wallets WHERE id = $1", [id]);
  }

  findDefaultByUserId(userId: string): Promise<any | null> {
    return first(
      this.db,
      "SELECT data FROM identity.user_wallets WHERE user_id = $1 AND is_default = TRUE AND is_active = TRUE ORDER BY pos LIMIT 1",
      [userId]
    );
  }

  async save(wallet: any): Promise<void> {
    await this.db.query(
      `INSERT INTO identity.user_wallets (id, user_id, is_default, is_active, data)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, is_default = EXCLUDED.is_default, is_active = EXCLUDED.is_active, data = EXCLUDED.data, updated_at = now()`,
      [wallet.id, wallet.userId, Boolean(wallet.isDefault), wallet.isActive !== false, json(wallet)]
    );
  }

  async clearDefaultForUser(userId: string): Promise<void> {
    await this.db.query("UPDATE identity.user_wallets SET is_default = FALSE, updated_at = now() WHERE user_id = $1", [userId]);
  }

  async delete(id: string): Promise<void> {
    await this.db.query("DELETE FROM identity.user_wallets WHERE id = $1", [id]);
  }
}

class PgRepositorySet implements RepositoryTransaction {
  readonly properties: PropertyRepository;
  readonly rooms: RoomRepository;
  readonly meters: MeterRepository;
  readonly meterKeys: MeterKeyRepository;
  readonly readings: ReadingRepository;
  readonly tariffs: TariffRepository;
  readonly bills: BillRepository;
  readonly disputes: DisputeRepository;
  readonly auditEvents: AuditEventRepository;
  readonly creReports: CreReportRepository;
  readonly integrations: IntegrationStateRepository;
  readonly tenancies: TenancyRepository;
  readonly users: UserRepository;
  readonly userWallets: UserWalletRepository;

  constructor(db: Queryable) {
    this.properties = new PgPropertyRepository(db);
    this.rooms = new PgRoomRepository(db);
    this.meters = new PgMeterRepository(db);
    this.meterKeys = new PgMeterKeyRepository(db);
    this.readings = new PgReadingRepository(db);
    this.tariffs = new PgTariffRepository(db);
    this.bills = new PgBillRepository(db);
    this.disputes = new PgDisputeRepository(db);
    this.auditEvents = new PgAuditEventRepository(db);
    this.creReports = new PgCreReportRepository(db);
    this.integrations = new PgIntegrationStateRepository(db);
    this.tenancies = new PgTenancyRepository(db);
    this.users = new PgUserRepository(db);
    this.userWallets = new PgUserWalletRepository(db);
  }
}

export class PostgresRepositories extends PgRepositorySet implements Repositories {
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(readonly pool: pg.Pool) {
    super(pool);
  }

  static async connect(connectionString: string): Promise<PostgresRepositories> {
    const pool = new pg.Pool({ connectionString });
    await pool.query(POSTGRES_SCHEMA_SQL);
    return new PostgresRepositories(pool);
  }

  async transaction<T>(fn: (tx: RepositoryTransaction) => Promise<T> | T): Promise<T> {
    const run = async (): Promise<T> => {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [TRANSACTION_LOCK_KEY]);
        const result = await fn(new PgRepositorySet(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}

export class PostgresAuthRepository implements AuthRepo {
  private readonly users: PgUserRepository;

  constructor(private readonly db: Queryable) {
    this.users = new PgUserRepository(db);
  }

  async createUser(input: Omit<User, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<User> {
    const now = new Date().toISOString();
    const user: User = {
      id: input.id ?? `usr_${crypto.randomBytes(9).toString("hex")}`,
      email: input.email.toLowerCase(),
      name: input.name,
      role: input.role,
      passwordHash: input.passwordHash,
      propertyIds: input.propertyIds ?? [],
      roomIds: input.roomIds ?? [],
      createdAt: now,
      updatedAt: now
    };
    try {
      await this.db.query(
        "INSERT INTO identity.users (id, email, role, data) VALUES ($1, $2, $3, $4)",
        [user.id, user.email, user.role, json(user)]
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new Error("email_exists");
      }
      throw error;
    }
    return user;
  }

  getUserById(id: string): Promise<User | null> {
    return this.users.findById(id);
  }

  getUserByEmail(email: string): Promise<User | null> {
    return this.users.findByEmail(email);
  }

  listUsers(): Promise<User[]> {
    return this.users.list();
  }

  async updateUserName(id: string, name: string): Promise<User | null> {
    const user = await this.users.findById(id);
    if (!user) return null;
    const updated = { ...user, name, updatedAt: new Date().toISOString() };
    await this.users.save(updated);
    return updated;
  }

  async createSession(userId: string, role: UserRole, ttlMs = 1000 * 60 * 60 * 24 * 7): Promise<AuthSession> {
    const now = new Date();
    const session: AuthSession = {
      sessionId: `sess_${crypto.randomBytes(24).toString("hex")}`,
      userId,
      role,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString()
    };
    await this.db.query(
      "INSERT INTO identity.sessions (session_id, user_id, role, expires_at, created_at) VALUES ($1, $2, $3, $4, $5)",
      [session.sessionId, session.userId, session.role, session.expiresAt, session.createdAt]
    );
    return session;
  }

  async getSession(sessionId: string): Promise<AuthSession | null> {
    const result = await this.db.query<{
      session_id: string;
      user_id: string;
      role: UserRole;
      expires_at: Date;
      created_at: Date;
    }>("SELECT session_id, user_id, role, expires_at, created_at FROM identity.sessions WHERE session_id = $1", [
      sessionId
    ]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      sessionId: row.session_id,
      userId: row.user_id,
      role: row.role,
      expiresAt: row.expires_at.toISOString(),
      createdAt: row.created_at.toISOString()
    };
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.db.query("DELETE FROM identity.sessions WHERE session_id = $1", [sessionId]);
  }
}
