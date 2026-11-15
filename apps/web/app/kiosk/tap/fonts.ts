import { Bricolage_Grotesque, IBM_Plex_Sans_Arabic } from "next/font/google";

// The CareCard tap screen's fonts, shared by /kiosk and /kiosk/charge.
export const kioskDisplay = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-kiosk-display", display: "swap" });
export const kioskArabic = IBM_Plex_Sans_Arabic({ subsets: ["arabic"], weight: ["600", "700"], variable: "--font-kiosk-arabic", display: "swap" });

/** Class names that make the font variables available to the tap screen. */
export const kioskFonts = `${kioskDisplay.variable} ${kioskArabic.variable}`;
