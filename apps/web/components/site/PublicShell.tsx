"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon, type IconName } from "../Icon";

const STATIONS: { href: string; icon: IconName; label: string }[] = [
  { href: "/kiosk", icon: "tap", label: "Patient kiosk" },
  { href: "/review", icon: "queue", label: "Fund admin" },
  { href: "/provider", icon: "store", label: "Provider terminal" },
];

export function PublicShell<T extends string>({
  tabs,
  tab,
  onTab,
  onDonate,
  search,
  onSearch,
  children,
}: {
  tabs: { id: T; label: string }[];
  tab: T;
  onTab: (t: T) => void;
  onDonate: () => void;
  search: string;
  onSearch: (query: string) => void;
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const icons: IconName[] = ["grid", "wallet", "info"];

  function openTab(id: T) {
    setDraft("");
    onSearch("");
    onTab(id);
  }

  return (
    <div className="pub violet">
      <div className="pub-frame">
        <header className="pub-top">
          <Link href="/" className="v-brand" aria-label="AbdulCare home">
            <span /><span /><span /><span />
          </Link>
          <form className="v-search" role="search" onSubmit={(event) => {
            event.preventDefault();
            onSearch(tab === tabs[1].id ? search : draft);
          }}>
            <button type="submit" aria-label="Search ledger"><Icon name="search" /></button>
            <input aria-label="Search the public ledger" placeholder="Search ledger…" type="search" value={tab === tabs[1].id ? search : draft} onChange={(event) => {
              setDraft(event.target.value);
              if (tab === tabs[1].id) onSearch(event.target.value);
            }} />
          </form>
          <div className="pub-actions">
            <button className="v-outline" onClick={onDonate}><Icon name="plus" /> Donate</button>
            <Link href="/pair" className="v-round v-outline" aria-label="Staff device setup" title="Staff device setup"><Icon name="key" /></Link>
          </div>
        </header>
        <nav className="rail" aria-label="AbdulCare apps">
          {tabs.map((item, index) => (
            <button key={item.id} type="button" onClick={() => openTab(item.id)} aria-current={tab === item.id ? "page" : undefined} aria-label={item.label} title={item.label}>
              <Icon name={icons[index]} />
            </button>
          ))}
          {STATIONS.map((station) => (
            <Link key={station.href} href={station.href} aria-label={station.label} title={station.label}><Icon name={station.icon} /></Link>
          ))}
        </nav>
        <main className="pub-body">{children}</main>
      </div>
    </div>
  );
}
