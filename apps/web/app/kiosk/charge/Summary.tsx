import { money, total, type ChargeLine } from "./bill";

/** Original charges (itemized, collapsible), each discount, and what the patient pays. */
export function Summary({ items, discounts, paid = false }: { items: ChargeLine[]; discounts: ChargeLine[]; paid?: boolean }) {
  const original = total(items);
  const off = total(discounts);
  return (
    <div className="kc-summary">
      <details>
        <summary>
          <span>Original bill · {items.length} {items.length === 1 ? "item" : "items"}</span>
          <b>{money(original)}</b>
        </summary>
        <ul>
          {items.map((l, n) => <li key={`${n}-${l.label}`}><span>{l.label}</span><span>{money(l.cents)}</span></li>)}
        </ul>
      </details>
      {discounts.map((d) => (
        <div key={d.label} className="kc-row kc-off"><span>{d.label}</span><b>−{money(d.cents)}</b></div>
      ))}
      <div className="kc-row kc-off kc-subtle"><span>Total discount</span><b>−{money(off)}</b></div>
      <div className="kc-row kc-final"><span>{paid ? "Paid" : "Patient pays"}</span><b>{money(original - off)}</b></div>
    </div>
  );
}
