import type {
  AuditEvent,
  CreReport,
  Dispute,
  Meter,
  Property,
  Reading,
  ReadingStatus,
  Room,
  Session,
  Tariff,
  Tenancy,
  User
} from "@chargemesh/shared";

export interface IntegrationState {
  hedera: {
    topicId?: string;
    lastMessageSequence?: string;
  };
}

export interface ReadingFilter {
  meterId?: string;
  roomId?: string;
  sessionId?: string;
  status?: ReadingStatus;
}

export interface PropertyRepository {
  list(): Promise<Property[]>;
  findById(id: string): Promise<Property | null>;
  findByOwnerId?(ownerId: string): Promise<Property[]>;
  save(property: Property): Promise<void>;
}

export interface RoomRepository {
  list(): Promise<Room[]>;
  findById(id: string): Promise<Room | null>;
  findByPropertyId?(propertyId: string): Promise<Room[]>;
  save(room: Room): Promise<void>;
}

export interface TenancyRepository {
  list(): Promise<Tenancy[]>;
  findById(id: string): Promise<Tenancy | null>;
  findByRoomId(roomId: string): Promise<Tenancy[]>;
  findByUserId(userId: string): Promise<Tenancy[]>;
  findActiveByRoom(roomId: string): Promise<Tenancy | null>;
  findActiveByUser(userId: string): Promise<Tenancy[]>;
  save(tenancy: Tenancy): Promise<void>;
}

export interface UserRepository {
  list(): Promise<User[]>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  save(user: User): Promise<void>;
}

export interface MeterRepository {
  list(): Promise<Meter[]>;
  findById(id: string): Promise<Meter | null>;
  findByMeterId?(meterId: string): Promise<Meter | null>;
  findActiveByRoom(roomId: string): Promise<Meter | null>;
  save(meter: Meter): Promise<void>;
}

export interface MeterKeyRepository {
  list(): Promise<Array<{ meterId: string; privateKeyPem: string }>>;
  save(meterId: string, privateKeyPem: string): Promise<void>;
}

export interface ReadingRepository {
  list(filter?: ReadingFilter): Promise<Reading[]>;
  findById?(id: string): Promise<Reading | null>;
  findByReadingId?(readingId: string): Promise<Reading | null>;
  findByPayloadHash(payloadHash: string): Promise<Reading | null>;
  findByMeterAndSequence(meterId: string, sequence: number): Promise<Reading | null>;
  save(reading: Reading): Promise<void>;
}

export interface TariffRepository {
  list(): Promise<Tariff[]>;
  findById(id: string): Promise<Tariff | null>;
  save(tariff: Tariff): Promise<void>;
}

export interface BillRepository {
  list(): Promise<Session[]>;
  findById(id: string): Promise<Session | null>;
  findActiveByRoom(roomId: string): Promise<Session | null>;
  save(bill: Session): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface DisputeRepository {
  list(): Promise<Dispute[]>;
  findById(id: string): Promise<Dispute | null>;
  save(dispute: Dispute): Promise<void>;
}

export interface AuditEventRepository {
  list(): Promise<AuditEvent[]>;
  findById(id: string): Promise<AuditEvent | null>;
  head(): Promise<AuditEvent | null>;
  save(event: AuditEvent): Promise<void>;
}

export interface CreReportRepository {
  list(): Promise<CreReport[]>;
  findById(reportId: string): Promise<CreReport | null>;
  save(report: CreReport): Promise<void>;
}

export interface IntegrationStateRepository {
  get(): Promise<IntegrationState>;
  save(state: IntegrationState): Promise<void>;
}

export interface UserWalletRepository {
  listByUserId(userId: string): Promise<any[]>;
  findById(id: string): Promise<any | null>;
  findDefaultByUserId(userId: string): Promise<any | null>;
  save(wallet: any): Promise<void>;
  clearDefaultForUser(userId: string): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface RepositoryTransaction {
  properties?: PropertyRepository;
  rooms: RoomRepository;
  meters: MeterRepository;
  meterKeys?: MeterKeyRepository;
  readings: ReadingRepository;
  tariffs: TariffRepository;
  bills: BillRepository;
  disputes: DisputeRepository;
  auditEvents: AuditEventRepository;
  creReports: CreReportRepository;
  integrations: IntegrationStateRepository;
  tenancies?: TenancyRepository;
  users?: UserRepository;
  userWallets?: UserWalletRepository;
}

export interface Repositories extends RepositoryTransaction {
  userWallets?: UserWalletRepository;
  transaction<T>(fn: (tx: RepositoryTransaction) => Promise<T> | T): Promise<T>;
}
