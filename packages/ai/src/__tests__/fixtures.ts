// Shared test fixtures (not a test file). Jordan's fictional demo case.
import { SECOND_APPROVAL_ABOVE_CENTS, type BillStep, type BriefInput } from "@abdulcare/contracts";
import { assessNeed } from "../formula";

// Jordan's demo path.
export const demoPath: BillStep[] = [
  { label: "Charged by Valley General Hospital", reductionCents: 0, balanceCents: 480_000, simulated: false, status: "confirmed" },
  { label: "Insurance (Bluebird Health Plan)", reductionCents: 264_000, balanceCents: 216_000, simulated: true, status: "confirmed" },
  { label: "Charity care (hospital decision, simulated)", reductionCents: 172_800, balanceCents: 43_200, simulated: true, status: "confirmed" },
];

export function briefInput(over: Partial<BriefInput> = {}): BriefInput {
  const assessment = assessNeed({
    householdSize: 3,
    profileIncomeCents: 250_000,
    depositIncomeCents: null,
    insurance: "insured",
    billCents: 43_200,
    category: "emergency",
    daysWaiting: 2,
    priorPaidCount90d: 0,
    priorPaidCents90d: 0,
  });
  return {
    path: demoPath,
    remainingCents: 43_200,
    assessment,
    factors: assessment.factors,
    rank: 1,
    queueLength: 4,
    daysWaiting: 2,
    suspiciousContent: null,
    secondApprovalAboveCents: SECOND_APPROVAL_ABOVE_CENTS,
    ...over,
  };
}

