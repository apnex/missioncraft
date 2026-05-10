// ApprovalPolicy pluggable interface (Design v4.8 §2.1.2)
// Default v1 implementation: TrustAllPolicy (`{approved: true}` for every context).

export type ApprovalAction =
  | 'commit'
  | 'push'
  | 'force-push'          // v0.2 fold per §C.2 — distinct from regular push
  | 'pull'                // v0.2 fold per §C.2
  | 'merge'
  | 'branch-create'       // v0.2 fold per §C.2 — F16 wip-branch needs approval surface
  | 'branch-delete'       // v0.2 fold per §C.2 — wip-branch cleanup gate
  | 'mission-start'       // v0.2 fold per §C.2 — operator lifecycle gate
  | 'mission-complete'
  | 'mission-abandon';    // v0.2 fold per §C.2

export interface ApprovalContext {
  readonly missionId: string;
  readonly repoUrl: string;
  readonly branch: string;
  readonly action: ApprovalAction;
  readonly metadata: Record<string, unknown>;
}

export interface ApprovalDecision {
  readonly approved: boolean;
  readonly reason?: string;
}

export interface ApprovalPolicy {
  /** Decide whether an action proceeds. Called at each gated action. */
  decide(context: ApprovalContext): Promise<ApprovalDecision>;
}
