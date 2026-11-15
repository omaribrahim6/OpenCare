import Link from "next/link";
import { Icon } from "./Icon";
import { LogoWordmark } from "./Logo";

export type SitePage = "home" | "ledger" | "proof" | "account";

const LINKS: { page: SitePage; href: string; label: string }[] = [
  { page: "home", href: "/", label: "Home" },
  { page: "ledger", href: "/fund", label: "Public ledger" },
  { page: "proof", href: "/proof", label: "Verify" },
  { page: "account", href: "/user", label: "My account" },
];

/** The site's one menu (home, ledger, account, plus Staff). The current page is highlighted. */
export function SiteNav({ current }: { current?: SitePage }) {
  return (
    <nav className="site-nav" aria-label="Main">
      {LINKS.map((l) => (
        <Link key={l.page} href={l.href} aria-current={current === l.page ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
      <Link href="/admin" className="site-nav-staff" title="Staff sign-in">
        <Icon name="lock" size={14} /> Staff
      </Link>
    </nav>
  );
}

/** Logo plus menu, for pages that don't have their own header bar. */
export function SiteHeader({ current }: { current?: SitePage }) {
  return (
    <header className="site-bar">
      <Link href="/" className="site-brand" aria-label="OpenCare home">
        <LogoWordmark />
      </Link>
      <SiteNav current={current} />
    </header>
  );
}
