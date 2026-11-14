import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import "./site.css";
import "./kiosk.css";
import "./desk.css";
import "./terminal.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "AbdulCare", template: "%s · AbdulCare" },
  description:
    "Tap a CareCard, understand your medical bill, and get help paying it from a community fund. People decide, AI assists, and every dollar has a public receipt.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f3f3f1",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
