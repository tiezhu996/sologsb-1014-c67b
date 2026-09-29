export type StepType = 'premise' | 'derivation' | 'goal';
export type CheckSeverity = 'error' | 'warning' | 'info';

/**
 * 成立条件：证明过程中临时引入的限制（如分母不为零、根号内非负）。
 * 条件随引用链向后代传递，可被某一步收回（discharges）。
 */
export interface ProofCondition {
  id: string;
  text: string;
}

export interface ProofStep {
  id: string;
  type: StepType;
  statement: string;
  rule: string;
  references: string[];
  note: string;
  counterexample: string;
  alternative: string;
  /** 本步引入的成立条件 */
  conditions: ProofCondition[];
  /** 本步收回（证明其已满足）的条件 id */
  discharges: string[];
}

/**
 * 分支：同一证明的不同推导路径，各自保存步骤、目标与条件/收回记录。
 */
export interface ProofBranch {
  id: string;
  name: string;
  steps: ProofStep[];
  goal: string;
}

export interface ProofVersion {
  id: string;
  name: string;
  createdAt: string;
  steps: ProofStep[];
  goal: string;
}

export interface ProofDocument {
  id: string;
  title: string;
  author: string;
  goal: string;
  symbols: Record<string, string>;
  steps: ProofStep[];
  branches: ProofBranch[];
  activeBranchId: string;
  versions: ProofVersion[];
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
