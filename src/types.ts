export type StepType = 'premise' | 'derivation' | 'goal';
export type CheckSeverity = 'error' | 'warning' | 'info';

export interface ProofStep {
  id: string;
  type: StepType;
  statement: string;
  rule: string;
  references: string[];
  note: string;
  counterexample: string;
  alternative: string;
  /** 所属分支；旧稿没有该字段时按主分支处理。 */
  branchId?: string;
  /** 本步引入的成立条件（证明义务）id。 */
  introducedConditions: string[];
  /** 本步收回的成立条件 id。 */
  dischargedConditions: string[];
}

export interface ProofCondition {
  id: string;
  /** 条件所属分支，各分支独立保存条件与收回记录。 */
  branchId: string;
  /** 条件文本，例如 `$a \\ne 0$`、`$x \\ge 0$`。 */
  label: string;
  /** 引入该条件的步骤 id。 */
  introducedAt: string;
  createdAt: string;
}

export interface ProofBranch {
  id: string;
  name: string;
  createdAt: string;
}

export interface ProofVersion {
  id: string;
  name: string;
  createdAt: string;
  steps: ProofStep[];
  goal: string;
  /** 快照所属分支（旧快照可能没有）。 */
  branchId?: string;
  branchName?: string;
  conditions?: ProofCondition[];
}

export interface ProofDocument {
  id: string;
  title: string;
  author: string;
  goal: string;
  symbols: Record<string, string>;
  steps: ProofStep[];
  versions: ProofVersion[];
  branches: ProofBranch[];
  activeBranchId: string;
  conditions: ProofCondition[];
  updatedAt: string;
}

export interface ProofCheck {
  id: string;
  severity: CheckSeverity;
  title: string;
  detail: string;
  stepId?: string;
}

export interface ProofDiff {
  kind: 'same' | 'added' | 'removed' | 'changed';
  label: string;
  before: string;
  after: string;
}
