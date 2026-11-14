import Link from "next/link";

export function LogoMark({ className = "logo-mark" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true">
      <rect width="28" height="28" rx="8" fill="#134e47" />
      <path d="M12 7.5h4v4.5h4.5v4H16v4.5h-4V16H7.5v-4H12z" fill="#e8d99a" />
    </svg>
  );
}

export function Logo({ href = "/" }: { href?: string | null }) {
  const inner = (
    <>
      <LogoMark />
      AbdulCare
    </>
  );
  if (href === null) return <span className="logo">{inner}</span>;
  return (
    <Link href={href} className="logo">
      {inner}
    </Link>
  );
}
