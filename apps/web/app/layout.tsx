import type { Metadata, Viewport } from "next";
import { Geist_Mono, Lexend } from "next/font/google";
import "./globals.css";
import "./site.css";
import "./kiosk.css";
import "./desk.css";
import "./terminal.css";
import "./opencare.css";

// Lexend was designed from reading-fluency research; the whole site uses it.
const lexend = Lexend({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "OpenCare", template: "%s · OpenCare" },
  description:
    "Tap a CareCard, understand your medical bill, and get help paying it from a community fund. People decide, AI assists, and every dollar has a public receipt.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f4f5fb",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${lexend.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
