import type { Db } from "../src/db";

/** Clear rehearsal records while keeping the seeded public history intact. */
export async function clearDemoData(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query("lock table grants, donations, fund in share row exclusive mode");

    // Historical grant events use the public receipt reference, not the grant ID.
    await tx.query(`
      delete from fund_events e
      where not exists (
        select 1 from grants g
        where starts_with(g.patient_id, 'pat_hist_')
          and (e.grant_ref = g.public_ref or e.grant_ref = g.id)
      ) and not exists (
        select 1 from donations d
        where starts_with(d.id, 'don_hist_') and e.grant_ref = d.id
      )
    `);
    await tx.query(`
      delete from payment_attempts
      where grant_id in (select id from grants where not starts_with(patient_id, 'pat_hist_'))
    `);
    await tx.query("delete from grants where not starts_with(patient_id, 'pat_hist_')");
    await tx.query(`
      delete from documents d
      where not starts_with(d.patient_id, 'pat_hist_')
        and not exists (select 1 from grants g where g.document_id = d.id)
    `);
    await tx.query(`
      delete from visits v
      where not starts_with(v.patient_id, 'pat_hist_')
        and not exists (select 1 from grants g where g.visit_id = v.id)
    `);
    await tx.query("delete from queue_rankings");
    await tx.query("delete from donations where not starts_with(id, 'don_hist_')");

    await tx.query(`
      update fund
      set total_cents = (select coalesce(sum(amount_cents), 0) from donations),
          paid_cents = (
            select coalesce(sum(approved_cents), 0) from grants where status = 'paid'
          ),
          reserved_cents = (
            select coalesce(sum(approved_cents), 0) from grants
            where status in ('approved', 'payment_pending')
          )
      where id = 'community'
    `);
    await tx.query(`
      update sessions set ended_at = now()
      where ended_at is null and not starts_with(patient_id, 'pat_hist_')
    `);
  });
}
