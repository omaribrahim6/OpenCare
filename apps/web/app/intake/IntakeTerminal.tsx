"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Device, PatientSummary } from "@abdulcare/contracts";
import { Icon } from "@/components/Icon";
import { Logo } from "@/components/Logo";
import { ApiRequestError, LIVE, createVisit, currentDevice, getVisitTemplates, listPatients } from "@/lib/api";
import { stepLabel, usd } from "@/lib/format";
import type { Bill, VisitTemplate } from "@/lib/rev6";
import { POLICY_STATUS_LABEL } from "@/lib/rev6";

/** Key the tap page uses to hand the selected patient to this screen (name and ID only, same tab). */
export const INTAKE_PATIENT_KEY = "intake-patient";

function readTapped(): PatientSummary | null {
  try {
    const raw = sessionStorage.getItem(INTAKE_PATIENT_KEY);
    return raw ? (JSON.parse(raw) as PatientSummary) : null;
  } catch {
    return null;
  }
}

/**
 * Hospital intake (SPEC §4 screen 8, simulated hospital staff): pick the patient (CareCard tap or the
 * demo list), pick the visit, log it. The server runs insurance and every hospital policy and
 * returns the bill, which this screen shows step by step.
 */
export function IntakeTerminal() {
  const [device, setDevice] = useState<Device | null | undefined>(undefined);
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [patientId, setPatientId] = useState("");
  const [tapped, setTapped] = useState<PatientSummary | null>(null);
  const [templates, setTemplates] = useState<VisitTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bill, setBill] = useState<Bill | null>(null);
  const key = useRef<string | null>(null);

  useEffect(() => {
    currentDevice()
      .then((r) => setDevice(r.device))
      .catch(() => setDevice(null));
    const t = readTapped();
    if (t) {
      setTapped(t);
      setPatientId(t.id);
    }
    listPatients()
      .then((r) => {
        setPatients(r.patients);
        setPatientId((id) => id || r.patients[0]?.id || "");
      })
      .catch(() => setPatients([]));
    getVisitTemplates()
      .then((r) => {
        setTemplates(r.templates);
        setTemplateId((id) => id || r.templates[0]?.id || "");
      })
      .catch(() => setError("Visit templates didn't load."));
  }, []);

  const wrongDevice = LIVE && device !== undefined && (!device || device.role !== "provider");
  const template = templates.find((t) => t.id === templateId);
  const patient = tapped?.id === patientId ? tapped : patients.find((p) => p.id === patientId) ?? null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!templateId || !patientId || busy) return;
    setBusy(true);
    setError(null);
    key.current ??= crypto.randomUUID();
    try {
      const r = await createVisit({ templateId, patientId, idempotencyKey: key.current });
      setBill(r.bill);
      key.current = null;
    } catch (err) {
      setError(err instanceof ApiRequestError || err instanceof Error ? err.message : "The visit wasn't logged. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setBill(null);
    key.current = null;
    try {
      sessionStorage.removeItem(INTAKE_PATIENT_KEY);
    } catch {}
    setTapped(null);
  }

  return (
    <main className="page station">
      <header className="station-bar">
        <Logo href={null} />
        <span>Hospital intake</span>
      </header>

      {wrongDevice ? (
        <div className="card" role="alert">
          <p style={{ marginTop: 0 }}>This browser isn&apos;t paired as a hospital device.</p>
          <Link className="btn" href="/pair">
            Set up this device
          </Link>
        </div>
      ) : bill ? (
        <IntakeResult bill={bill} onNext={reset} />
      ) : (
        <form className="stack" onSubmit={submit}>
          <h1 style={{ marginBottom: 0 }}>Log a visit</h1>
          <p className="muted" style={{ marginTop: 0 }}>
            Simulated hospital staff. Tap the patient&apos;s CareCard on this device, or pick a demo patient.
          </p>

          <div className="card">
            <label htmlFor="patient">Patient</label>
            {tapped && tapped.id === patientId && (
              <p className="badge info" style={{ marginBottom: 8 }}>
                <Icon name="tap" /> Selected by CareCard tap
              </p>
            )}
            <select id="patient" value={patientId} onChange={(e) => setPatientId(e.target.value)} disabled={busy}>
              {tapped && !patients.some((p) => p.id === tapped.id) && <option value={tapped.id}>{tapped.displayName}</option>}
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
            {!LIVE && (
              <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 0 }}>
                Demo: <Link href="/t/hospital">simulate a CareCard tap</Link>
              </p>
            )}
          </div>

          <fieldset className="card" style={{ margin: 0 }} disabled={busy}>
            <legend style={{ fontWeight: 600 }}>Visit</legend>
            <div className="stack" style={{ gap: 8 }}>
              {templates.map((t) => (
                <label key={t.id} className="row" style={{ fontWeight: 400, gap: 10, margin: 0, alignItems: "flex-start" }}>
                  <input
                    type="radio"
                    name="template"
                    checked={templateId === t.id}
                    onChange={() => {
                      setTemplateId(t.id);
                      key.current = null;
                    }}
                    style={{ width: 22, minHeight: 22, marginTop: 3 }}
                  />
                  <span>
                    <strong>
                      {t.label}, {usd(t.totalCents)}
                    </strong>
                    <br />
                    <small className="muted">{t.lineItems.map((li) => li.description).join(" · ")}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {error && (
            <p role="alert" className="badge bad">
              {error}
            </p>
          )}

          <button className="btn block" type="submit" disabled={busy || !templateId || !patientId}>
            {busy ? "Logging visit and applying insurance and hospital assistance…" : `Log visit${template ? `, ${usd(template.totalCents)}` : ""}${patient ? ` for ${patient.displayName}` : ""}`}
          </button>
        </form>
      )}

      <footer className="station-foot">
        <Icon name="lock" /> Hospital-attested record. Insurance and hospital decisions are simulated.
      </footer>
    </main>
  );
}

function IntakeResult({ bill, onNext }: { bill: Bill; onNext: () => void }) {
  return (
    <div className="stack">
      <h1 style={{ marginBottom: 0 }}>Visit logged</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {bill.visit.patient.displayName} · {bill.visit.description} · {bill.visit.hospital.name}
      </p>
      <section className="card">
        <ol className="bill-steps">
          {bill.steps.map((s, i) => (
            <li key={`${s.label}-${i}`} className={`bill-step${i === 0 ? " charge" : ""} ${s.status}`}>
              <span>
                <strong>{stepLabel(s.label)}</strong>
                <small>{s.simulated ? "Simulated decision" : i === 0 ? "Hospital-attested" : "Confirmed"}</small>
              </span>
              <em>{i === 0 ? usd(s.balanceCents) : `−${usd(s.reductionCents)}`}</em>
            </li>
          ))}
          <li className="bill-step total">
            <span>
              <strong>Patient balance</strong>
            </span>
            <em>{usd(bill.remainingCents)}</em>
          </li>
        </ol>
      </section>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Hospital assistance</h2>
        <ul className="bill-policies">
          {bill.applications.map((a) => (
            <li key={a.id}>
              <strong>{a.policy.name}</strong>: {POLICY_STATUS_LABEL[a.status]}
              {a.reductionCents > 0 ? `, ${usd(a.reductionCents)} off` : ""}
              <br />
              <small className="muted">{a.evaluation.reason}</small>
            </li>
          ))}
        </ul>
      </section>
      <p className="muted">The patient can now tap their CareCard on the kiosk to see this bill and ask the fund for help.</p>
      <button className="btn secondary block" onClick={onNext}>
        Next patient
      </button>
    </div>
  );
}
