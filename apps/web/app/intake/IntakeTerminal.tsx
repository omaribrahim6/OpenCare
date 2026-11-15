"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Device, PatientSummary } from "@abdulcare/contracts";
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
 * demo list), pick the visit, and create a bill.
 */
export function IntakeTerminal() {
  const [device, setDevice] = useState<Device | null | undefined>(undefined);
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [patientId, setPatientId] = useState("");
  const [tapped, setTapped] = useState<PatientSummary | null>(null);
  const [templates, setTemplates] = useState<VisitTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
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
  }, []);

  const authorized = !LIVE || device?.role === "reviewer" || device?.role === "hospital" || device?.role === "provider";

  async function loadChoices() {
    setLoading(true);
    setLoadError(false);
    try {
      const [patientList, visitList] = await Promise.all([listPatients(), getVisitTemplates()]);
      setPatients(patientList.patients);
      setTemplates(visitList.templates);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authorized) void loadChoices();
  }, [authorized]);

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
    setPatientId("");
    setTemplateId("");
  }

  return (
    <main className="page station portal-screen">
      <header className="station-bar">
        <Logo href={null} />
        <Link className="btn secondary" href="/review">Back to Admin</Link>
      </header>
      {bill ? (
        <IntakeResult bill={bill} onNext={reset} />
      ) : (
        <>
          <div className="portal-intro">
            <h1>Create a hospital bill</h1>
            <p>Choose a patient and a visit template. The bill will appear under the patient’s visits.</p>
          </div>
          {LIVE && device === undefined ? (
            <p className="portal-panel" role="status">Checking staff access…</p>
          ) : !authorized ? (
            <div className="portal-panel">
              <p>Hospital staff or caseworkers can create a bill.</p>
              <Link className="btn" href="/pair">Set up staff access</Link>
            </div>
          ) : loading ? (
            <p className="portal-panel" role="status">Loading patients and visit templates…</p>
          ) : loadError ? (
            <div className="portal-panel" role="alert">
              <p>Patients or visit templates couldn’t load.</p>
              <button type="button" className="btn secondary" onClick={loadChoices}>Try again</button>
            </div>
          ) : (
            <form className="portal-form" onSubmit={submit}>
              <div className="portal-panel">
                <label htmlFor="patient">Patient</label>
                <select id="patient" value={patientId} onChange={(e) => {
                  setPatientId(e.target.value);
                  key.current = null;
                }} disabled={busy}>
                  <option value="">Choose a patient</option>
                  {tapped && !patients.some((p) => p.id === tapped.id) && <option value={tapped.id}>{tapped.displayName}</option>}
                  {patients.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                </select>
                {tapped?.id === patientId && <p className="muted">Selected by CareCard.</p>}
                {!patients.length && !tapped && <p className="muted">No patients are available for this device.</p>}
              </div>
              <div className="portal-panel">
                <label htmlFor="visit-template">Visit template</label>
                {templates.length ? (
                  <select id="visit-template" value={templateId} onChange={(e) => {
                    setTemplateId(e.target.value);
                    key.current = null;
                  }} disabled={busy}>
                    <option value="">Choose a visit</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.label} · {usd(t.totalCents)}</option>)}
                  </select>
                ) : <p className="muted">No visit templates are available for this device.</p>}
                {template && (
                  <dl className="portal-charges">
                    {template.lineItems.map((item, index) => (
                      <div key={index}><dt>{item.description}</dt><dd>{usd(item.cents)}</dd></div>
                    ))}
                  </dl>
                )}
              </div>
              {error && <p role="alert" className="badge bad">{error}</p>}
              <button className="btn" type="submit" disabled={busy || !template || !patient}>
                {busy ? "Creating bill…" : "Create bill"}
              </button>
            </form>
          )}
        </>
      )}
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
                <small>{s.simulated ? "Hospital decision" : i === 0 ? "Hospital-attested" : "Confirmed"}</small>
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
      <p className="muted">The patient can open this bill from My visits after tapping their CareCard.</p>
      <button className="btn secondary block" onClick={onNext}>
        Next patient
      </button>
    </div>
  );
}
