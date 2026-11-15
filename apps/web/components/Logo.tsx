import Image from "next/image";
import Link from "next/link";

const MARK_SRC = "/brand/opencare-mark.svg";
const WORDMARK_SRC = "/brand/opencare-wordmark.svg";

export function LogoMark({ className = "logo-mark" }: { className?: string }) {
  return <Image className={className} src={MARK_SRC} width={28} height={28} alt="" unoptimized />;
}

export function LogoWordmark({ compact = false }: { compact?: boolean }) {
  const wordmark = (
    <Image
      className="logo-wordmark"
      src={WORDMARK_SRC}
      width={1066}
      height={204}
      alt="OpenCare"
      unoptimized
    />
  );

  if (!compact) return wordmark;

  return (
    <picture className="logo-adaptive">
      <source media="(max-width: 480px)" srcSet={MARK_SRC} />
      {wordmark}
    </picture>
  );
}

export function Logo({ href = "/", compact = false }: { href?: string | null; compact?: boolean }) {
  const wordmark = <LogoWordmark compact={compact} />;

  if (href === null) return <span className="logo">{wordmark}</span>;

  return (
    <Link href={href} className="logo" aria-label="OpenCare home">
      {wordmark}
    </Link>
  );
}
