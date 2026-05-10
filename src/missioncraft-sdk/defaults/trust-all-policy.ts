// Default ApprovalPolicy implementation (Design v4.8 §2.1.2)
// `{approved: true}` for every context. Operator opts in to ceremony explicitly via mission-config OR alternative pluggable.

import type {
  ApprovalContext,
  ApprovalDecision,
  ApprovalPolicy,
} from '../pluggables/approval.js';

export class TrustAllPolicy implements ApprovalPolicy {
  /** v1.5 fold per MEDIUM-R4.2 — providerName contract for SDK-injection vs mission-config string-name validation. */
  static readonly providerName: string = 'trust-all';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async decide(_context: ApprovalContext): Promise<ApprovalDecision> {
    return { approved: true };
  }
}
