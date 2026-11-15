import type { Metadata, Viewport } from "next";
import { kioskFonts } from "./tap/fonts";
import { KioskTap, type KioskLang } from "./tap/KioskTap";
import "./tap/tap.css";

// Added to the Home Screen, the kiosk runs full screen with the background behind the status bar.
export const metadata: Metadata = {
  title: "Patient kiosk",
  manifest: "/kiosk.webmanifest",
  appleWebApp: { capable: true, title: "CareCard", statusBarStyle: "black-translucent" },
  icons: { apple: "/kiosk-icon-180.png" },
};

export const viewport: Viewport = {
  themeColor: "#c9c1f0",
  viewportFit: "cover",
};

const LANGS: KioskLang[] = ["en", "es", "ar"];

export default async function KioskPage({
  searchParams,
}: {
  searchParams: Promise<{ ended?: string; lang?: string; who?: string }>;
}) {
  const { ended, lang, who } = await searchParams;
  return (
    <div className={kioskFonts}>
      <KioskTap
        lang={LANGS.includes(lang as KioskLang) ? (lang as KioskLang) : "en"}
        ended={Boolean(ended)}
        who={who}
      />
    </div>
  );
}
