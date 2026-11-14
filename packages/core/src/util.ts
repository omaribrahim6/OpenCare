import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { ErrorCode } from "@abdulcare/contracts";

/** Errors that route handlers turn into ApiError responses. */
export class CoreError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CoreError";
  }
}

/** HTTP status for each error code. */
export const STATUS_FOR_CODE: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_state: 409,
  conflict: 409,
  insufficient_funds: 422,
  upstream_error: 502,
  internal: 500,
};

/** Random, unguessable ID with a readable prefix, e.g. "grt_Xq3...". */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

/** 256-bit secret for cookies and card tokens. */
export function newSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hmac(key: string, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function isPositiveCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

export function isoOrNull(value: unknown): string | null {
  return value == null ? null : iso(value);
}
