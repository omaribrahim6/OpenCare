"use client";

import Link from "next/link";
import { useState } from "react";
import type { Device } from "@abdulcare/contracts";
import { Icon } from "../Icon";
import { LogoMark } from "../Logo";

export type DeskView = "queue" | "decided";

export function DeskShell({
  view,
  onView,
  title,
  device,
  pending,
  actions,
  children,
}: {
  view: DeskView;
  onView: (v: DeskView) => void;
  title: string;
  device: Device | null;
  pending: number | null;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [menu, setMenu] = useState(false);
  const name = device?.label ?? "Caseworker";
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="desk">
      <aside className={`d-side${menu ? " open" : ""}`}>
        <div className="d-logo">
          <LogoMark />
          Fund admin
        </div>

        <div className="d-device">
          <span className="d-device-icon">
            <Icon name="laptop" />
          </span>
          <span style={{ minWidth: 0 }}>
            <strong>{name}</strong>
            <small>{device ? "Caseworker device" : "Not paired"}</small>
          </span>
          <Link href="/pair" className="d-dots" aria-label="Device setup" title="Device setup">
            <Icon name="more" strokeWidth={2.4} />
          </Link>
        </div>

        <p className="d-section">Review</p>
        <nav className="d-nav" aria-label="Review">
          <button
            aria-current={view === "queue" ? "page" : undefined}
            onClick={() => {
              onView("queue");
              setMenu(false);
            }}
          >
            <Icon name="inbox" />
            Queue
            {pending != null && pending > 0 && <span className="d-count">{pending}</span>}
          </button>
          <button
            aria-current={view === "decided" ? "page" : undefined}
            onClick={() => {
              onView("decided");
              setMenu(false);
            }}
          >
            <Icon name="checkCircle" />
            Decided
          </button>
        </nav>

        <p className="d-side-foot">Prototype. Fictional patients, Nessie sandbox money and Solana devnet receipts.</p>
      </aside>

      <div className="d-main">
        <header className="d-head">
          <button className="d-icon-btn d-menu" onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu}>
            <Icon name="menu" />
          </button>
          <h1>{title}</h1>
          {actions}
          <div className="d-profile">
            <span className="d-avatar" aria-hidden="true">
              {initials || "CW"}
            </span>
            <div>
              <strong>{name}</strong>
              <small>{device ? "Caseworker" : "Not paired"}</small>
            </div>
          </div>
        </header>
        <div className="d-body" onClick={() => menu && setMenu(false)}>
          {children}
        </div>
      </div>
    </div>
  );
}
