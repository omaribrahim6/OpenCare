"use client";

import { useState } from "react";
import { LIVE, saveDemoInsurance } from "@/lib/api";
import { usd } from "@/lib/format";
import type { InsurancePlan } from "@/lib/rev6";

const PLAN_AMOUNTS = ["deductibleCents", "deductibleMetCents", "outOfPocketMaxCents", "outOfPocketMetCents"] as const;

function parsePlan(data: unknown): InsurancePlan {
  if (!data || typeof data !== "object") throw new Error("Use the demo plan template to format your file.");
  const plan = data as Partial<InsurancePlan>;
  if (typeof plan.payerName !== "string" || !plan.payerName.trim() || plan.payerName.length > 100 ||
      typeof plan.coinsurancePct !== "number" || !Number.isFinite(plan.coinsurancePct) ||
      plan.coinsurancePct < 0 || plan.coinsurancePct > 100 ||
      PLAN_AMOUNTS.some((key) => !Number.isSafeInteger(plan[key]) || plan[key]! < 0) ||
      plan.deductibleMetCents! > plan.deductibleCents! || plan.outOfPocketMetCents! > plan.outOfPocketMaxCents!) {
    throw new Error("Check the plan name, amounts in cents, and coinsurance percentage against the template.");
  }
  return {
    payerName: plan.payerName.trim(),
    coinsurancePct: plan.coinsurancePct,
    deductibleCents: plan.deductibleCents!,
    deductibleMetCents: plan.deductibleMetCents!,
    outOfPocketMaxCents: plan.outOfPocketMaxCents!,
    outOfPocketMetCents: plan.outOfPocketMetCents!,
  };
}

export function InsuranceProfile({ plan, onSave, demo }: { plan: InsurancePlan | null; onSave: () => void; demo: boolean }) {
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const example = JSON.stringify({
    payerName: "Example Health Plan",
    deductibleCents: 150000,
    deductibleMetCents: 0,
    coinsurancePct: 20,
    outOfPocketMaxCents: 300000,
    outOfPocketMetCents: 0,
  }, null, 2);

  return (
    <>
      <h1>Insurance</h1>
      <section className="patient-panel">
        <h2>{plan?.payerName ?? "No plan on file"}</h2>
        {plan && (
          <dl className="patient-plan">
            <div><dt>Deductible</dt><dd>{usd(plan.deductibleCents)}</dd></div>
            <div><dt>Your share after deductible</dt><dd>{plan.coinsurancePct}%</dd></div>
            <div><dt>Out-of-pocket limit</dt><dd>{usd(plan.outOfPocketMaxCents)}</dd></div>
          </dl>
        )}
      </section>
      {(demo || !LIVE) && (
        <section className="patient-panel">
          <h2>Upload a demo plan</h2>
          <p className="muted">Use a fictional JSON plan. New demo visits use this plan. Existing bills keep the plan used to calculate them.</p>
          <a href={`data:application/json,${encodeURIComponent(example)}`} download="example-plan.json">Download the plan template</a>
          <label className="patient-upload">
            <span>Choose plan file</span>
            <input
              type="file"
              accept=".json,application/json"
              disabled={saving}
              onChange={async (event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                if (!file) return;
                setNotice(null);
                setSaving(true);
                try {
                  if (file.size > 16_384) throw new Error("Choose a JSON plan under 16 KB.");
                  let data: unknown;
                  try {
                    data = JSON.parse(await file.text());
                  } catch {
                    throw new Error("Choose a valid JSON file using the demo plan template.");
                  }
                  await saveDemoInsurance(parsePlan(data));
                  setNotice({ text: "Plan saved for future demo visits.", error: false });
                  onSave();
                } catch (error) {
                  setNotice({ text: error instanceof Error ? error.message : "The plan could not be saved.", error: true });
                } finally {
                  input.value = "";
                  setSaving(false);
                }
              }}
            />
          </label>
          {notice && <p role={notice.error ? "alert" : "status"}>{notice.text}</p>}
        </section>
      )}
    </>
  );
}
