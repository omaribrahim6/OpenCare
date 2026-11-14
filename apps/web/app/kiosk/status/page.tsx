import Link from "next/link";
import { KioskSession } from "@/components/KioskSession";
import { ReadAloud } from "@/components/ReadAloud";
import { STATUS_LABEL, StatusBadge } from "@/components/StatusBadge";
import { formatCents, getMyGrant } from "@/lib/mock";
import type { GrantStatus } from "@/lib/types";

const NEXT_STEP: Record<GrantStatus, string> = {
  draft: "Finish your request to send it for review.",
  pending_review:
    "A person at the fund will review your request. You can check back any time by tapping your card here.",
  approved: "Take your card to the provider. They'll tap it and confirm, and the fund pays them directly.",
  rejected: "This request wasn't approved. Ask staff about other options.",
  canceled: "This request was canceled before payment.",
  payment_pending: "The fund is paying your provider now.",
  paid: "Your provider has been paid. Nothing else to do.",
};

// Screen 4: Request status.
export default async function RequestStatus({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const { new: isNew } = await searchParams;
  const grant = await getMyGrant();
  if (!grant) {
    return (
      <KioskSession step={3} totalSteps={3}>
        <h1>No requests yet</h1>
        <Link className="btn block" href="/kiosk/bills">
          Start a request
        </Link>
      </KioskSession>
    );
  }

  const amount = formatCents(grant.approvedCents ?? grant.requestedCents);
  const spoken = `Your request for ${amount} to ${grant.provider.name} is: ${STATUS_LABEL[grant.status]}. ${NEXT_STEP[grant.status]}`;

  return (
    <KioskSession step={3} totalSteps={3}>
      {isNew && (
        <p className="card" role="status">
          <strong>Request sent.</strong> We&apos;ve saved it for review.
        </p>
      )}
      <h1>Your request</h1>
      <div className="card">
        <StatusBadge status={grant.status} />
        <p className="big" style={{ marginTop: 12 }}>
          {amount}
        </p>
        <p>
          To <strong>{grant.provider.name}</strong>
        </p>
        <p>{NEXT_STEP[grant.status]}</p>
        <ReadAloud text={spoken} />
      </div>
      <Link className="btn secondary block" href="/?ended=user">
        Done, end session
      </Link>
    </KioskSession>
  );
}
