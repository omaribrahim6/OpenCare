// Nessie speaks dollars (decimals); everything we store is integer cents (SPEC §8).
// Convert only here, at the edge.

export function dollarsToCents(dollars: number): number {
  if (typeof dollars !== "number" || !Number.isFinite(dollars)) {
    throw new Error(`Not a dollar amount: ${dollars}`);
  }
  return Math.round(dollars * 100);
}

export function centsToDollars(cents: number): number {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`Not a cents amount: ${cents}`);
  return cents / 100;
}

/** YYYY-MM-DD in UTC, the date format Nessie expects. */
export function nessieDate(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
