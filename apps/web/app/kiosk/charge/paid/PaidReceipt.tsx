"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Logo } from "@/components/Logo";
import { LIVE, sendKioskCharge, type KioskChargeResult } from "@/lib/api";
import { money, total, type ChargeMethod } from "../bill";
import { clearPending, demoCharge, loadPending, savePending, type PendingCharge } from "../pending";
import { Summary } from "../Summary";

// /kiosk/charge/paid: where the card reader lands once a card or phone is scanned (today the
// presenter's hold on the reader; later the NFC scan). It pays the charge staff set up on
// /kiosk/charge, shows the receipt and sends it to admin once. The payment is simulated.

const PROCESSING_MS = 1800;

const SEND_NOTE: Record<Exclude<KioskChargeResult, { sent: true }>["reason"], string> = {
  mock: "Demo mode: this receipt stays on this phone.",
  not_kiosk: "Not sent to admin: pair this phone as a kiosk with the staff PIN first.",
  unavailable: "Not sent to admin yet: the admin route isn't live. The receipt stays on this phone.",
  failed: "Couldn't reach admin. The receipt stays on this phone.",
};

const receiptNumber = () => `KC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

export function PaidReceipt({ method }: { method: ChargeMethod }) {
  const router = useRouter();
  const [charge, setCharge] = useState<PendingCharge | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const pending = loadPending() ?? demoCharge();
    // Already paid (a reload, or the reader opened the page twice): show it, don't send again.
    if (pending.receipt) {
      setCharge(pending);
      return;
    }
    const paid: PendingCharge = {
      ...pending,
      receipt: { no: receiptNumber(), paidAt: new Date().toISOString(), method, sent: null },
    };
    savePending(paid);
    const sending = sendKioskCharge({ items: paid.items, discounts: paid.discounts, method, preset: paid.preset });
    void Promise.all([sending, new Promise((r) => window.setTimeout(r, PROCESSING_MS))]).then(([sent]) => {
      const done = { ...paid, receipt: { ...paid.receipt!, sent } };
      savePending(done);
      setCharge(done);
    });
  }, [method]);

  const newBill = () => {
    clearPending();
    router.push("/kiosk/charge");
  };

  if (!charge?.receipt) {
    return (
      <main className="kc-scan kc">
        <section className="kc-pay" aria-labelledby="kc-title">
          <span className="kc-disc is-paying" aria-hidden="true"><span className="kc-spin kc-spin-lg" /></span>
          <h1 id="kc-title">Card read</h1>
          <p className="kc-nfc" role="status">Processing payment (simulated)…</p>
        </section>
      </main>
    );
  }

  const { items, discounts, receipt } = charge;
  const paidCents = total(items) - total(discounts);
  const sent = receipt.sent;
  return (
    <main className="page station station-session kc kc-receipt">
      <div className="station-bar">
        <Logo href={null} />
        <span className="kc-who"><Icon name="user" size={15} /> Patient</span>
      </div>
      {!LIVE && <p className="kc-demo"><Icon name="info" size={15} /> Demo · simulated payment</p>}
      <section aria-labelledby="kc-title">
        <div className="kc-paid">
          <Icon name="checkCircle" size={30} />
          <div>
            <h1 id="kc-title">Paid {money(paidCents)}</h1>
            <p className="muted">
              {new Date(receipt.paidAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} · {receipt.no}
            </p>
          </div>
        </div>
        <Summary items={items} discounts={discounts} paid />
        <dl className="kc-meta">
          <div><dt>Paid with</dt><dd>Contactless card</dd></div>
          <div><dt>Payment</dt><dd>Simulated · no card data read</dd></div>
        </dl>
        <p className={`kc-sent${sent?.sent ? " is-sent" : ""}`} role="status">
          <Icon name={sent?.sent ? "check" : "info"} size={15} />
          {sent?.sent ? "Sent to admin for review." : sent ? SEND_NOTE[sent.reason] : "Sending to admin…"}
        </p>
        <button type="button" className="btn btn-lg kc-primary" onClick={newBill}>
          <Icon name="plus" size={18} /> New bill
        </button>
      </section>
    </main>
  );
}
