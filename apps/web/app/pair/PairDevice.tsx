"use client";

import Link from "next/link";
import { Logo } from "@/components/Logo";
import { useEffect, useState } from "react";
import type { Device, DeviceRole, Provider } from "@abdulcare/contracts";
import { ApiRequestError, currentDevice, listProviders, pairDevice } from "@/lib/api";

const ROLES: { role: DeviceRole; label: string; home: string; help: string }[] = [
  { role: "kiosk", label: "Kiosk", home: "/kiosk", help: "The clinic's check-in phone. Patients tap their CareCard here." },
  { role: "provider", label: "Hospital intake", home: "/intake", help: "Hospital staff log a patient's visit here after tapping their CareCard." },
  { role: "reviewer", label: "Caseworker", home: "/review", help: "Reviews and approves requests." },
];

/** Staff screen: pair this browser as a kiosk, provider terminal or caseworker device (PIN-protected). */
export function PairDevice() {
  const [device, setDevice] = useState<Device | null | undefined>(undefined);
  const [role, setRole] = useState<DeviceRole>("kiosk");
  const [label, setLabel] = useState("Front desk kiosk");
  const [pin, setPin] = useState("");
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [providerId, setProviderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    currentDevice()
      .then((r) => setDevice(r.device))
      .catch(() => setDevice(null));
  }, []);

  // Allow manual provider entry if the provider list is unavailable.
  useEffect(() => {
    if (role !== "provider" || providers !== null) return;
    listProviders()
      .then((r) => {
        setProviders(r.providers);
        if (r.providers[0]) setProviderId((id) => id || r.providers[0].id);
      })
      .catch(() => setProviders([]));
  }, [role, providers]);

  const home = ROLES.find((r) => r.role === (device?.role ?? role))?.home ?? "/";
  const valid = pin.trim().length > 0 && label.trim().length > 0 && (role !== "provider" || providerId.trim().length > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const r = await pairDevice({
        role,
        pin: pin.trim(),
        label: label.trim(),
        providerId: role === "provider" ? providerId.trim() : undefined,
      });
      setDevice(r.device);
      setPin("");
    } catch (err) {
      setError(
        err instanceof ApiRequestError && (err.status === 401 || err.status === 403)
          ? "That PIN wasn't accepted."
          : err instanceof Error
            ? err.message
            : "Pairing failed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page station station-pair">
      <header className="station-bar"><Logo /><Link href="/review">Admin</Link></header>
      <h1>Set up staff access</h1>

      {device === undefined ? (
        <p role="status">Checking this device…</p>
      ) : device ? (
        <div className="card" role="status">
          <p style={{ marginTop: 0 }}>
            This browser is paired as <strong>{ROLES.find((r) => r.role === device.role)?.label ?? device.role}</strong>
            : {device.label}
          </p>
          <Link className="btn" href={home}>
            Open the {ROLES.find((r) => r.role === device.role)?.label.toLowerCase() ?? "home"} screen
          </Link>
          <p className="muted" style={{ marginBottom: 0, marginTop: 12 }}>
            To change it, pair again below.
          </p>
        </div>
      ) : (
        <p className="muted">Use your staff PIN to authorize this browser for one role. Choose Caseworker to open the admin queue and fund stats.</p>
      )}

      <form className="card stack" onSubmit={submit} aria-labelledby="pair-title">
        <h2 id="pair-title" className="sr-only">Pair this browser</h2>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={busy}>
          <legend style={{ fontWeight: 600, marginBottom: 6 }}>Role</legend>
          <div className="stack" style={{ gap: 8 }}>
            {ROLES.map((r) => (
              <label key={r.role} className="row" style={{ fontWeight: 400, gap: 10, margin: 0, alignItems: "flex-start" }}>
                <input
                  type="radio"
                  name="role"
                  checked={role === r.role}
                  onChange={() => {
                    setRole(r.role);
                    setLabel(r.role === "kiosk" ? "Front desk kiosk" : r.role === "provider" ? "Hospital intake desk" : "Caseworker laptop");
                  }}
                  style={{ width: 22, minHeight: 22, marginTop: 3 }}
                />
                <span>
                  <strong>{r.label}</strong>
                  <br />
                  <small className="muted">{r.help}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {role === "provider" &&
          (providers && providers.length > 0 ? (
            <div>
              <label htmlFor="provider">Hospital</label>
              <select id="provider" value={providerId} onChange={(e) => setProviderId(e.target.value)} disabled={busy}>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label htmlFor="provider-id">Provider ID</label>
              <input id="provider-id" value={providerId} onChange={(e) => setProviderId(e.target.value)} disabled={busy} />
              <small className="muted">The provider list loads once this device is paired; ask the team for the ID.</small>
            </div>
          ))}

        <div>
          <label htmlFor="label">Device name</label>
          <input id="label" value={label} onChange={(e) => setLabel(e.target.value)} disabled={busy} />
        </div>
        <div>
          <label htmlFor="pin">Staff PIN</label>
          <input
            id="pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            disabled={busy}
          />
        </div>

        {error && (
          <p role="alert" className="badge bad">
            {error}
          </p>
        )}

        <button className="btn block" type="submit" disabled={!valid || busy}>
          {busy ? "Pairing…" : "Pair this device"}
        </button>
      </form>
    </main>
  );
}
