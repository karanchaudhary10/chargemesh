import crypto from "node:crypto";
import type { AuthSession, User, UserRole } from "@chargemesh/shared";

export interface AuthRepo {
  createUser(input: Omit<User, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<User>;
  getUserById(id: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  updateUserName(id: string, name: string): Promise<User | null>;
  createSession(userId: string, role: UserRole, ttlMs?: number): Promise<AuthSession>;
  getSession(sessionId: string): Promise<AuthSession | null>;
  deleteSession(sessionId: string): Promise<void>;
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt as crypto.BinaryLike, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const derived = crypto.scryptSync(password, salt as crypto.BinaryLike, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(derived, "hex"));
  } catch {
    return false;
  }
}

export class AuthService {
  constructor(private readonly repo: AuthRepo) {}

  async register(input: {
    email: string;
    name: string;
    password: string;
    role?: UserRole;
    propertyIds?: string[];
    roomIds?: string[];
  }): Promise<User> {
    const existing = await this.repo.getUserByEmail(input.email.toLowerCase());
    if (existing) {
      throw new Error("email_exists");
    }
    const now = new Date().toISOString();
    const user = {
      email: input.email.toLowerCase(),
      name: input.name,
      role: input.role ?? "landlord",
      passwordHash: hashPassword(input.password),
      propertyIds: input.propertyIds ?? [],
      roomIds: input.roomIds ?? [],
      createdAt: now,
      updatedAt: now
    } as Omit<User, "id" | "createdAt" | "updatedAt">;
    const created = await this.repo.createUser(user);
    const { passwordHash: _pw, ...safe } = created as any;
    return safe as User;
  }

  async login(email: string, password: string): Promise<{ user: User; session: AuthSession }> {
    const user = await this.repo.getUserByEmail(email.toLowerCase());
    if (!user || !user.passwordHash) {
      throw new Error("invalid_credentials");
    }
    if (!verifyPassword(password, user.passwordHash)) {
      throw new Error("invalid_credentials");
    }
    const session = await this.repo.createSession(user.id, user.role);
    const { passwordHash: _pw, ...safe } = user as any;
    return { user: safe as User, session };
  }

  async logout(sessionId: string): Promise<void> {
    await this.repo.deleteSession(sessionId);
  }

  async me(sessionId: string): Promise<User | null> {
    const session = await this.repo.getSession(sessionId);
    if (!session) return null;
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      await this.repo.deleteSession(sessionId);
      return null;
    }
    const user = await this.repo.getUserById(session.userId);
    if (!user) return null;
    const { passwordHash: _pw, ...safe } = user as any;
    return safe as User;
  }

  async userByEmail(email: string): Promise<User | null> {
    const user = await this.repo.getUserByEmail(email.trim().toLowerCase());
    if (!user) return null;
    const { passwordHash: _passwordHash, ...safe } = user;
    return safe;
  }

  async updateName(id: string, name: string): Promise<User | null> {
    const user = await this.repo.updateUserName(id, name.trim());
    if (!user) return null;
    const { passwordHash: _passwordHash, ...safe } = user;
    return safe;
  }

  async userById(id: string): Promise<User | null> {
    const user = await this.repo.getUserById(id);
    if (!user) return null;
    const { passwordHash: _passwordHash, ...safe } = user;
    return safe;
  }

  async requireAuth(sessionId?: string | null): Promise<{ user: User; session: AuthSession }> {
    if (!sessionId) throw new Error("unauthorized");
    const session = await this.repo.getSession(sessionId);
    if (!session) throw new Error("unauthorized");
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      await this.repo.deleteSession(sessionId);
      throw new Error("unauthorized");
    }
    const user = await this.repo.getUserById(session.userId);
    if (!user) throw new Error("unauthorized");
    const { passwordHash: _pw, ...safe } = user as any;
    return { user: safe as User, session };
  }

  requireRole(user: User, roles: UserRole[]): void {
    if (!roles.includes(user.role)) {
      throw new Error("forbidden");
    }
  }
}
