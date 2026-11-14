"use client";

import { useState } from "react";
import type { Device } from "@abdulcare/contracts";
import { Icon } from "@/components/Icon";
import { LogoMark } from "@/components/Logo";
import { ApiRequestError, pairDevice } from "@/lib/api";

/** Admin sign-in: a staff PIN authorizes this browser as a reviewer device before any admin data loads. */
export function AdminGate({ onSignedIn, expired = false }: { onSignedIn: (device: Device) => void; expired?: boolean }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await pairDevice({ role: "reviewer", pin: pin.trim(), label: "Admin browser" });
      onSignedIn(r.device);
    } catch (err) {
      setPin("");
      setError(
        err instanceof ApiRequestError && (err.status === 401 || err.status === 403)
          ? "That PIN wasn't accepted."
          : err instanceof Error
            ? err.message
            : "Sign-in failed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="d-login">
      <form className="d-login-card" onSubmit={submit}>
        <div className="d-login-brand">
          <LogoMark />
          Admin
        </div>
        <span className="d-login-lock" aria-hidden="true">
          <Icon name="lock" size={22} />
        </span>
        <h1>Staff access required</h1>
        <p>{expired ? "This browser's admin access ended. Enter your staff PIN again." : "Enter your staff PIN to open the admin panel."}</p>
        <label className="d-login-field">
          <span>Staff PIN</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "d-login-error" : undefined}
          />
        </label>
        {error && (
          <p className="d-login-error" id="d-login-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="d-btn d-btn-teal" disabled={!pin.trim() || busy}>
          <Icon name="key" /> {busy ? "Checking…" : "Open admin"}
        </button>
      </form>
    </main>
  );
}
