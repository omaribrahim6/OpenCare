"use client";

import Link from "next/link";
import { Logo } from "@/components/Logo";
import { useEffect, useState } from "react";
import type { Device, DeviceRole, Provider } from "@abdulcare/contracts";
import { ApiRequestError, currentDevice, listProviders, pairDevice } from "@/lib/api";

const ROLES: { role: DeviceRole; label: string; home: string; help: string }[] = [
  { role: "kiosk", label: "Kiosk", home: "/kiosk", help: "The clinic's check-in phone. Patients tap their CareCard here." },
  { role: "hospital", label: "Hospital intake", home: "/intake", help: "Hospital staff log a patient's visit here after tapping their CareCard." },
  { role: "reviewer", label: "Caseworker", home: "/review", help: "Reviews and approves requests." },
];

/** Staff screen: pair this browser as a kiosk, provider terminal or caseworker device (PIN-protected). */
export function PairDevice() {
  const [device, setDevice] = useState<Device | null | undefined>(undefined);
  const [role, setRole] = useState<DeviceRole>("reviewer");
  const [label, setLabel] = useState("Caseworker laptop");
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
    if (role !== "hospital" || providers !== null) return;
    listProviders()
      .then((r) => {
        const hospitals = r.providers.filter((provider) => provider.kind === "hospital");
        setProviders(hospitals);
        if (hospitals[0]) setProviderId((id) => id || hospitals[0].id);
      })
      .catch(() => setProviders([]));
  }, [role, providers]);

  const activeRole = device?.role === "provider" ? "hospital" : device?.role;
  const activeStation = ROLES.find((r) => r.role === activeRole);
  const home = activeStation?.home ?? "/";
  const valid = pin.trim().length > 0 && label.trim().length > 0 && (role !== "hospital" || providerId.trim().length > 0);

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
        providerId: role === "hospital" ? providerId.trim() : undefined,
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
    <main className="page station portal-screen">
      <header className="station-bar"><Logo /><Link href="/review" className="btn secondary">Back to Admin</Link></header>
      <div className="portal-intro"><h1>Staff access</h1><p>Choose what this browser will be used for, then enter your staff PIN.</p></div>

      {device === undefined ? (
        <p role="status">Checking this device…</p>
      ) : device ? (
        <div className="portal-panel" role="status">
          <p style={{ marginTop: 0 }}>
            This browser is paired as <strong>{activeStation?.label ?? device.role}</strong>
            : {device.label}
          </p>
          <Link className="btn" href={home}>
            Open the {activeStation?.label.toLowerCase() ?? "home"} screen
          </Link>
          <p className="muted" style={{ marginBottom: 0, marginTop: 12 }}>
            To change it, pair again below.
          </p>
        </div>
      ) : (
        null
      )}

      <form className="portal-panel portal-form" onSubmit={submit} aria-labelledby="pair-title">
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
                    setLabel(r.role === "kiosk" ? "Front desk kiosk" : r.role === "hospital" ? "Hospital intake desk" : "Caseworker laptop");
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

        {role === "hospital" &&
          (providers && providers.length > 0 ? (
            <div>
              <label htmlFor="hospital">Hospital</label>
              <select id="hospital" value={providerId} onChange={(e) => setProviderId(e.target.value)} disabled={busy}>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label htmlFor="provider-id">Hospital ID</label>
              <input id="provider-id" value={providerId} onChange={(e) => setProviderId(e.target.value)} disabled={busy} />
              <small className="muted">Ask the team for the hospital ID if it is missing from the list.</small>
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
          {busy ? "Pairing…" : "Authorize browser"}
        </button>
      </form>
    </main>
  );
}
