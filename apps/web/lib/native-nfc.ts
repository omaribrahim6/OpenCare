// Bridge to the OpenCare Kiosk iPhone app (apps/kiosk-ios). iOS browsers have no Web NFC, so the
// app wraps the kiosk site in a WKWebView and reads the CareCard with Core NFC. The page asks for
// a scan through the "carecard" message handler; the app answers with a "carecard" window event.
// The token then goes through the normal tap(token) call, so cookies and all checks stay
// server-side. Contract: apps/kiosk-ios/README.md.

import type { TapResult } from "@abdulcare/contracts";
import { CARD_PATH, loadPending } from "@/app/kiosk/charge/pending";
import { tap } from "@/lib/api";

const TOKEN_RE = /^[A-Za-z0-9_-]{10,64}$/;

type ScanReply = { id: string; token?: string; error?: string };
type Bridge = { postMessage: (message: { action: "scan"; id: string }) => void };

declare global {
  interface Window {
    webkit?: { messageHandlers?: { carecard?: Bridge } };
  }
}

/** Why a native scan failed: the patient closed the sheet, it timed out, or the read failed. */
export class NativeScanError extends Error {
  constructor(readonly code: "cancelled" | "timeout" | "invalid_card" | "nfc_unavailable" | "busy" | "not_in_app" | string) {
    super(`CareCard scan failed: ${code}`);
    this.name = "NativeScanError";
  }
}

function bridge(): Bridge | null {
  if (typeof window === "undefined") return null;
  return window.webkit?.messageHandlers?.carecard ?? null;
}

/** True inside the OpenCare Kiosk iPhone app, where a native CareCard scan is available. */
export function isKioskApp(): boolean {
  return bridge() !== null;
}

/** Opens the app's NFC sheet and resolves with the card's token. Rejects with NativeScanError. */
export function scanCareCard(): Promise<string> {
  const handler = bridge();
  if (!handler) return Promise.reject(new NativeScanError("not_in_app"));
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    const onReply = (event: Event) => {
      const reply = (event as CustomEvent<ScanReply>).detail;
      if (!reply || reply.id !== id) return;
      window.removeEventListener("carecard", onReply);
      if (reply.token && TOKEN_RE.test(reply.token)) resolve(reply.token);
      else reject(new NativeScanError(reply.error ?? "invalid_card"));
    };
    window.addEventListener("carecard", onReply);
    handler.postMessage({ action: "scan", id });
  });
}

/** Where the kiosk goes after a tap started a patient session (same rule as the /t/<token> page). */
export function pathAfterSessionTap(): string {
  const waiting = loadPending();
  return waiting && !waiting.outcome ? CARD_PATH : "/kiosk/check";
}

/**
 * Scan → tap(token) → route, for a "Tap your CareCard" button. A session goes to the waiting
 * charge or the bill walk; any other result opens /t/<token>, which explains it (unpaired device,
 * unknown card). Rejects with NativeScanError if the scan fails; a cancel can be ignored.
 */
export async function tapWithNativeScan(navigate: (path: string) => void): Promise<TapResult> {
  const token = await scanCareCard();
  const result = await tap(token);
  navigate(result.kind === "session" ? pathAfterSessionTap() : `/t/${encodeURIComponent(token)}`);
  return result;
}
