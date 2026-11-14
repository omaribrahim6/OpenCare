// SPEC revision 6 shapes come from @abdulcare/contracts (bills.ts); this file adds display labels.

import type { BillEventType, PolicyApplicationStatus, PolicyKind } from "@abdulcare/contracts";

export type {
  Bill,
  BillEvent,
  BillStep,
  CaseDetail,
  DecisionBrief,
  InsurancePlan,
  PatientBillResponse,
  PolicyApplication,
  Visit,
  VisitTemplate,
} from "@abdulcare/contracts";

export const POLICY_STATUS_LABEL: Record<PolicyApplicationStatus, string> = {
  prepared: "Application prepared",
  submitted_simulated: "Submitted (simulated)",
  approved_simulated: "Approved by the hospital (simulated)",
  denied_simulated: "Not approved (simulated)",
};

export const POLICY_KIND_LABEL: Record<PolicyKind, string> = {
  charity_care: "Charity care",
  self_pay_discount: "Self-pay discount",
  catastrophic_cap: "Catastrophic cost cap",
};

export const BILL_STEP_NAME: Record<BillEventType, string> = {
  charge: "Charged",
  insurance_adjustment: "Insurance paid",
  hospital_assistance: "Hospital assistance",
  fund_grant: "Community care fund",
  patient_payment: "You paid",
};
