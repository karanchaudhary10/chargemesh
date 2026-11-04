import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@chargemesh/shared";
import { AppError } from "./errors.js";
import type { AuthService } from "./auth.js";

export function getSessionId(req: Request): string | null {
  const header = req.header("x-session-id");
  if (header && header.trim()) return header.trim();
  const cookie = req.header("cookie");
  if (cookie) {
    const match = cookie.match(/chargemesh_session=([^;]+)/);
    if (match && match[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function requireAuth(auth: AuthService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sid = getSessionId(req);
      const { user, session } = await auth.requireAuth(sid);
      (req as any).user = user;
      (req as any).session = session;
      next();
    } catch (error) {
      if (error instanceof AppError) {
        next(error);
      } else if (error instanceof Error && error.message === "unauthorized") {
        next(new AppError(401, "unauthorized", "Authentication required"));
      } else {
        next(error);
      }
    }
  };
}

export function requireRole(auth: AuthService, roles: UserRole[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sid = getSessionId(req);
      const { user, session } = await auth.requireAuth(sid);
      if (!roles.includes(user.role)) {
        throw new AppError(403, "forbidden", "Insufficient permissions");
      }
      (req as any).user = user;
      (req as any).session = session;
      next();
    } catch (error) {
      if (error instanceof AppError) {
        next(error);
        return;
      }
      if (error instanceof Error && error.message === "unauthorized") {
        next(new AppError(401, "unauthorized", "Authentication required"));
        return;
      }
      next(error);
    }
  };
}
