import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AbdulCare",
  description: "Tap your card. Understand your bill. Get help paying for care.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="banner" role="note">
          Hackathon prototype · fictional people, mock bank data, test-network receipts only
        </div>
        {children}
      </body>
    </html>
  );
}
