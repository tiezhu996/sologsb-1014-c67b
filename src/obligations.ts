import type { ProofCondition, ProofDocument, ProofStep } from './types';

export const MAIN_BRANCH = 'main';

export function stepBranchId(step: ProofStep): string {
  return step.branchId || MAIN_BRANCH;
}

export function activeBranchId(document: ProofDocument): string {
  return document.branches.some((branch) => branch.id === document.activeBranchId)
    ? document.activeBranchId
    : document.branches[0]?.id ?? MAIN_BRANCH;
}

/** 取当前分支的步骤（按文档顺序）。 */
export function branchSteps(document: ProofDocument, branchId = activeBranchId(document)): ProofStep[] {
  return document.steps.filter((step) => stepBranchId(step) === branchId);
}

export function branchConditions(document: ProofDocument, branchId: string): ProofCondition[] {
  return document.conditions.filter((condition) => condition.branchId === branchId);
}

export interface BranchAnalysis {
  branchId: string;
  steps: ProofStep[];
  /** 引用了缺失/跨分支步骤的引用对。 */
  invalidReferences: { stepId: string; reference: string }[];
  /** 参与成环的步骤。 */
  cyclicSteps: Set<string>;
  /** 每个步骤的入向义务（所有被引用步骤的未收回条件之并）。 */
  incoming: Map<string, Set<string>>;
  /** 每个步骤的出向义务（入向 − 本步收回，再并入本步引入）。 */
  outgoing: Map<string, Set<string>>;
  /** 本步收回的条件并不在其义务范围内（收回了不存在/已无关的条件）。 */
  invalidDischarges: { stepId: string; conditionId: string }[];
  /** 引入的条件不在本分支台账中。 */
  danglingIntroductions: { stepId: string; conditionId: string }[];
  /** 最终结论步骤；没有时为 undefined。 */
  goalStep?: ProofStep;
  /** 目标上仍未收回的条件 id。 */
  goalOpenConditions: string[];
  /** 分支内仍未收回的全部条件 id（按条件台账顺序）。 */
  openConditions: string[];
}

function sortByIds(ids: Set<string>, orderedIds: string[]): string[] {
  const remaining = new Set(ids);
  const ordered = orderedIds.filter((id) => remaining.delete(id));
  return [...ordered, ...remaining];
}

/**
 * 计算单个分支上的成立条件传递情况。
 *
 * 条件随引用传递：某步引用其他步骤时，继承那些步骤尚未收回的条件；
 * 某一步收回条件后，条件不再向其后续传递。成环的步骤不参与传递，
 * 相关问题交给结构检查报告。
 */
export function analyzeBranch(document: ProofDocument, branchId = activeBranchId(document)): BranchAnalysis {
  const steps = branchSteps(document, branchId);
  const ids = new Set(steps.map((step) => step.id));
  const conditions = branchConditions(document, branchId);
  const conditionIds = new Set(conditions.map((condition) => condition.id));

  const invalidReferences: BranchAnalysis['invalidReferences'] = [];
  const graph = new Map<string, string[]>();
  steps.forEach((step) => {
    const validRefs: string[] = [];
    step.references.forEach((reference) => {
      if (!ids.has(reference)) {
        invalidReferences.push({ stepId: step.id, reference });
      } else {
        validRefs.push(reference);
      }
    });
    graph.set(step.id, validRefs);
  });

  // 循环引用检测。
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cyclicSteps = new Set<string>();
  const findCycle = (id: string, path: string[]): void => {
    if (visiting.has(id)) {
      path.slice(path.indexOf(id)).forEach((item) => cyclicSteps.add(item));
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    (graph.get(id) ?? []).forEach((next) => findCycle(next, [...path, id]));
    visiting.delete(id);
    visited.add(id);
  };
  steps.forEach((step) => findCycle(step.id, []));

  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  const computing = new Set<string>();
  const invalidDischarges: BranchAnalysis['invalidDischarges'] = [];
  const danglingIntroductions: BranchAnalysis['danglingIntroductions'] = [];

  const compute = (id: string): Set<string> => {
    const cached = outgoing.get(id);
    if (cached) return cached;
    const open = new Set<string>();
    if (!cyclicSteps.has(id) && !computing.has(id)) {
      computing.add(id);
      (graph.get(id) ?? []).forEach((reference) => {
        compute(reference).forEach((conditionId) => open.add(conditionId));
      });
      computing.delete(id);
    }
    const step = steps.find((item) => item.id === id)!;
    incoming.set(id, new Set(open));

    // 本步自己引入的条件在同一步即可收回（引入与收回同步合法）。
    step.introducedConditions.forEach((conditionId) => {
      if (!conditionIds.has(conditionId)) danglingIntroductions.push({ stepId: id, conditionId });
      open.add(conditionId);
    });
    // 收回条件必须针对当前在义务范围内的条件（引用继承 ∪ 本步引入）。
    step.dischargedConditions.forEach((conditionId) => {
      if (!open.has(conditionId)) invalidDischarges.push({ stepId: id, conditionId });
    });
    step.dischargedConditions.forEach((conditionId) => open.delete(conditionId));
    outgoing.set(id, new Set(open));
    return outgoing.get(id)!;
  };
  steps.forEach((step) => compute(step.id));

  // 文档中的最终结论（取第一个结论类型步骤）。
  const goalStep = steps.find((step) => step.type === 'goal' && step.rule === '结论');
  const goalOpen = goalStep ? sortByIds(outgoing.get(goalStep.id) ?? new Set(), conditions.map((c) => c.id)) : [];

  // 分支内仍未收回的条件 = 所有“末端步骤”（不被本分支任何步骤引用）的出向义务之并。
  const referenced = new Set<string>();
  steps.forEach((step) => (graph.get(step.id) ?? []).forEach((reference) => referenced.add(reference)));
  const terminalOpen = new Set<string>();
  steps.forEach((step) => {
    if (!referenced.has(step.id)) {
      (outgoing.get(step.id) ?? new Set()).forEach((conditionId) => terminalOpen.add(conditionId));
    }
  });

  return {
    branchId,
    steps,
    invalidReferences,
    cyclicSteps,
    incoming,
    outgoing,
    invalidDischarges,
    danglingIntroductions,
    goalStep,
    goalOpenConditions: goalOpen,
    openConditions: sortByIds(terminalOpen, conditions.map((c) => c.id)),
  };
}

/** 从公式里临时猜测常见的成立条件（分母非零、根号内非负等）。 */
export function suggestConditions(statement: string): string[] {
  const suggestions: string[] = [];
  const push = (label: string) => {
    if (!suggestions.includes(label)) suggestions.push(label);
  };
  const fracPattern = /\\d?frac\s*\{[^{}]*\}\s*\{[^{}]*\}/g;
  const fracs = statement.match(fracPattern) ?? [];
  fracs.forEach((frac) => {
    const parts = frac.match(/\\d?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/);
    const denominator = parts?.[2]?.trim();
    if (denominator && denominator !== '0') push(`$${denominator} \\ne 0$`);
  });
  if (/\\sqrt/.test(statement)) push('$\\text{根号内表达式} \\ge 0$');
  return suggestions;
}
