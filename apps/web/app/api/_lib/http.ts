// Shared plumbing for the api lane's route handlers (SPEC §9). Folders starting with "_" are
// private in the App Router, so nothing here becomes a route.

import { NextResponse } from "next/server";
import type { ApiError } from "@abdulcare/contracts";
import { CoreError, STATUS_FOR_CODE } from "@abdulcare/core";

/** Wrap a handler so every CoreError becomes an ApiError with its HTTP status (SPEC §9). */
export function route<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof CoreError) {
    return NextResponse.json<ApiError>(
      { error: { code: err.code, message: err.message } },
      { status: STATUS_FOR_CODE[err.code] ?? 500 },
    );
  }
  // Never echo unknown errors: they may carry upstream details or keys.
  console.error("[api] unhandled error", err);
  return NextResponse.json<ApiError>({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
}

export function ok<T>(body: T, status = 200): Response {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Parse a JSON object body or throw bad_request. */
export async function readJson<T extends object>(req: Request): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new CoreError("bad_request", "Request body must be JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new CoreError("bad_request", "Request body must be a JSON object");
  }
  return body as T;
}

/** Route params in Next 16 are a promise. */
export type IdParams = { params: Promise<{ id: string }> };
