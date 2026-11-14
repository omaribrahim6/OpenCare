// Live check against Gemini. Not run by the tests.
//   GEMINI_API_KEY=... npx tsx apps/api/src/ai/smoke.ts path/to/bill.jpg
// Prints only the extracted fields, never the key.
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { classifyTransactions, explainDocument, extractFromImage, matchPrograms, type ConfirmedFields } from "./index";

const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

async function main() {
  const path = process.argv[2];
  if (path) {
    const mimeType = MIME[extname(path).toLowerCase()];
    if (!mimeType) throw new Error("Use a .jpg, .png or .webp image");
    const extraction = await extractFromImage({ data: readFileSync(path), mimeType });
    console.log("extraction:", JSON.stringify(extraction, null, 2));
    const f = extraction.fields;
    const confirmed: ConfirmedFields = {
      provider: f.provider.value,
      documentType: f.documentType.value,
      currency: f.currency.value,
      totalCents: f.totalCents.value,
      date: f.date.value,
    };
    console.log("explanation:", JSON.stringify(await explainDocument(confirmed, { supportingText: extraction.supportingText }), null, 2));
    console.log("matches:", JSON.stringify(matchPrograms(confirmed, { householdSize: 2, annualIncomeCents: 3_000_000 }).map((m) => [m.name, m.fit, m.maxCents])));
  }
  const classes = await classifyTransactions([
    { id: "a", kind: "purchase", merchant: "Riverside Community Pharmacy", amountCents: 4500 },
    { id: "b", kind: "purchase", merchant: "Shell Gas Station", amountCents: 3200 },
    { id: "c", kind: "bill", merchant: "Valley Pediatrics LLC", amountCents: 8000 },
  ]);
  console.log("classification:", JSON.stringify(classes));
}

main().catch((err) => {
  console.error("smoke failed:", (err as Error).message);
  process.exit(1);
});
