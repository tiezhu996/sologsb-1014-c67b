import { redraw } from 'mithril';
import { analyzeBranch, activeBranchId, branchConditions, MAIN_BRANCH, stepBranchId } from './obligations';
import type {
  ProofBranch,
  ProofCheck,
  ProofCondition,
  ProofDocument,
  ProofStep,
  ProofVersion,
} from './types';

const STORAGE_KEY = 'sologsb-1014-proof-workspace-v2';
const LEGACY_STORAGE_KEY = 'sologsb-1014-proof-workspace-v1';
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const clone = <T>(value: T): T => structuredClone(value);

export const RULES = [
  '前提', '定义展开', '代入', '等式变形', '分配律', '同类项合并',
  '数学归纳', '反证法', '构造法', '分情况讨论', '结论',
];

function baseStep(partial: Partial<ProofStep> & Pick<ProofStep, 'id' | 'type' | 'statement' | 'rule'>): ProofStep {
  return {
    references: [],
    note: '',
    counterexample: '',
    alternative: '',
    branchId: MAIN_BRANCH,
    introducedConditions: [],
    dischargedConditions: [],
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* 示例数据                                                            */
/* ------------------------------------------------------------------ */

function sampleSteps(): ProofStep[] {
  return [
    baseStep({ id: 's1', type: 'premise', statement: '$a,b$ 是实数', rule: '前提', note: '采用实数域中的交换律与分配律。' }),
    baseStep({ id: 's2', type: 'derivation', statement: '$(a+b)^2=(a+b)(a+b)$', rule: '定义展开', references: ['s1'], note: '把平方写成两个相同因式之积。' }),
    baseStep({ id: 's3', type: 'derivation', statement: '$(a+b)(a+b)=a^2+ab+ba+b^2$', rule: '分配律', references: ['s2'], alternative: '也可先展开后半部分。' }),
    baseStep({ id: 's4', type: 'derivation', statement: '$a^2+ab+ba+b^2=a^2+2ab+b^2$', rule: '同类项合并', references: ['s3'], note: '由实数的交换律，$ab=ba$。' }),
    baseStep({ id: 's5', type: 'goal', statement: '$(a+b)^2=a^2+2ab+b^2$', rule: '结论', references: ['s4'], note: '目标已由步骤 1 至 4 逐项推出。' }),
  ];
}

function issueSteps(): ProofStep[] {
  return [
    baseStep({ id: 'i1', type: 'premise', statement: '$n$ 是正整数', rule: '前提' }),
    baseStep({ id: 'i2', type: 'derivation', statement: '$P(1)$ 成立', rule: '前提', references: ['i1'], note: '归纳基例。' }),
    baseStep({ id: 'i3', type: 'derivation', statement: '若 $P(k)$ 成立，则 $P(k+1)$ 也成立', rule: '数学归纳', references: ['missing-step'], note: '这里故意保留一个失效引用，用于演示检查。' }),
    baseStep({ id: 'i4', type: 'goal', statement: '$P(n)$ 对所有正整数 $n$ 成立', rule: '结论', references: ['i3'], note: '尚未补齐归纳假设。' }),
  ];
}

function conditionalSteps(): ProofStep[] {
  return [
    baseStep({ id: 'c1', type: 'premise', statement: '$x$ 是实数', rule: '前提' }),
    baseStep({ id: 'c2', type: 'derivation', statement: '由 $2x-1=0$ 得 $\\dfrac{1}{2x-1}=1$', rule: '等式变形', references: ['c1'], introducedConditions: ['cc-denom'], note: '两边除以 $2x-1$，需要分母非零。' }),
    baseStep({ id: 'c3', type: 'goal', statement: '$x=\\dfrac{1}{2}$', rule: '结论', references: ['c2'] }),
  ];
}

function conditionalStepsRestricted(): ProofStep[] {
  const branch = 'branch-restricted';
  return [
    baseStep({ id: 'r1', type: 'premise', statement: '$x$ 是实数', rule: '前提', branchId: branch }),
    baseStep({ id: 'r2', type: 'premise', statement: '$2x-1 \\ne 0$（限制参数）', rule: '前提', references: ['r1'], introducedConditions: ['rc-denom'], branchId: branch }),
    baseStep({ id: 'r3', type: 'derivation', statement: '由 $2x-1=0$ 两边除以 $2x-1$', rule: '等式变形', references: ['r2'], branchId: branch }),
    baseStep({ id: 'r4', type: 'derivation', statement: '分情况：$2x-1=0$ 时直接解得 $x=\\dfrac{1}{2}$，分母情形不出现', rule: '分情况讨论', references: ['r3'], dischargedConditions: ['rc-denom'], note: '在该情形下分母为零的分支不成立，义务收回。', branchId: branch }),
    baseStep({ id: 'r5', type: 'goal', statement: '$x=\\dfrac{1}{2}$', rule: '结论', references: ['r4'], branchId: branch }),
  ];
}

function initialDocuments(): ProofDocument[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'doc-algebra',
      title: '完全平方公式证明',
      author: '数学组',
      goal: '$(a+b)^2=a^2+2ab+b^2$',
      symbols: { a: '实数', b: '实数', P: '关于正整数的命题', n: '正整数', k: '正整数' },
      steps: sampleSteps(),
      versions: [],
      branches: [{ id: MAIN_BRANCH, name: '主分支', createdAt: now }],
      activeBranchId: MAIN_BRANCH,
      conditions: [],
      updatedAt: now,
    },
    {
      id: 'doc-induction',
      title: '数学归纳法待核对稿',
      author: '学生工作区',
      goal: '$P(n)$ 对所有正整数 $n$ 成立',
      symbols: { P: '关于正整数的命题', n: '正整数', k: '正整数' },
      steps: issueSteps(),
      versions: [],
      branches: [{ id: MAIN_BRANCH, name: '主分支', createdAt: now }],
      activeBranchId: MAIN_BRANCH,
      conditions: [],
      updatedAt: now,
    },
    {
      id: 'doc-conditions',
      title: '含参数限制的证明（条件传递）',
      author: '数学组',
      goal: '$x=\\dfrac{1}{2}$',
      symbols: { x: '实数' },
      steps: [...conditionalSteps(), ...conditionalStepsRestricted()],
      versions: [],
      branches: [
        { id: MAIN_BRANCH, name: '主分支（先除后补）', createdAt: now },
        { id: 'branch-restricted', name: '替代分支（先限制参数）', createdAt: now },
      ],
      activeBranchId: MAIN_BRANCH,
      conditions: [
        { id: 'cc-denom', branchId: MAIN_BRANCH, label: '$2x-1 \\ne 0$（分母非零）', introducedAt: 'c2', createdAt: now },
        { id: 'rc-denom', branchId: 'branch-restricted', label: '$2x-1 \\ne 0$（分母非零）', introducedAt: 'r2', createdAt: now },
      ],
      updatedAt: now,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* 旧稿迁移：没有分支信息的步骤与条件统一归到主分支继续打开            */
/* ------------------------------------------------------------------ */

function migrateDocument(raw: Record<string, unknown>): ProofDocument {
  const document = raw as Partial<ProofDocument>;
  const branches: ProofBranch[] =
    Array.isArray(document.branches) && document.branches.length
      ? (document.branches as ProofBranch[])
      : [{ id: MAIN_BRANCH, name: '主分支', createdAt: new Date().toISOString() }];
  const activeBranchId =
    typeof document.activeBranchId === 'string' && branches.some((branch) => branch.id === document.activeBranchId)
      ? document.activeBranchId
      : branches[0].id;
  const steps: ProofStep[] = Array.isArray(document.steps)
    ? (document.steps as ProofStep[]).map((step) => ({
        ...step,
        branchId: step.branchId || activeBranchId,
        introducedConditions: Array.isArray(step.introducedConditions) ? step.introducedConditions : [],
        dischargedConditions: Array.isArray(step.dischargedConditions) ? step.dischargedConditions : [],
      }))
    : [];
  const knownConditionIds = new Set(
    (Array.isArray(document.conditions) ? (document.conditions as ProofCondition[]) : []).map((condition) => condition.id),
  );
  const conditions: ProofCondition[] = Array.isArray(document.conditions)
    ? (document.conditions as ProofCondition[]).map((condition) => ({
        ...condition,
        branchId: condition.branchId || activeBranchId,
      }))
    // 极端旧稿：把步骤引用到、但台账缺失的条件补登记到主分支。
    : [];
  steps.forEach((step) => {
    step.introducedConditions.forEach((conditionId) => {
      if (!knownConditionIds.has(conditionId)) {
        conditions.push({
          id: conditionId,
          branchId: stepBranchId(step),
          label: '未命名条件',
          introducedAt: step.id,
          createdAt: new Date().toISOString(),
        });
      }
    });
  });
  return {
    id: String(document.id ?? uid('doc')),
    title: String(document.title ?? '未命名证明'),
    author: String(document.author ?? '本地用户'),
    goal: String(document.goal ?? ''),
    symbols: (document.symbols as Record<string, string>) ?? {},
    steps,
    versions: Array.isArray(document.versions) ? (document.versions as ProofVersion[]) : [],
    branches,
    activeBranchId,
    conditions,
    updatedAt: String(document.updatedAt ?? new Date().toISOString()),
  };
}

function loadDocuments(): ProofDocument[] {
  for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.length) return parsed.map((item) => migrateDocument(item as Record<string, unknown>));
    } catch {
      // 损坏的数据继续尝试下一个键。
    }
  }
  return initialDocuments();
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export class ProofStore {
  documents = loadDocuments();
  activeId = this.documents[0]?.id ?? '';
  selectedStepId = '';
  compareVersionId = '';
  dragStepId = '';
  lastInput: HTMLTextAreaElement | HTMLInputElement | null = null;
  undoStack: ProofDocument[][] = [];
  redoStack: ProofDocument[][] = [];
  toast = '';

  constructor() {
    this.ensureSelection();
  }

  get current(): ProofDocument {
    return this.documents.find((item) => item.id === this.activeId) ?? this.documents[0];
  }

  get branchId(): string {
    return activeBranchId(this.current);
  }

  get branchSteps(): ProofStep[] {
    return this.current.steps.filter((step) => stepBranchId(step) === this.branchId);
  }

  get branch(): ProofBranch {
    return this.current.branches.find((branch) => branch.id === this.branchId) ?? this.current.branches[0];
  }

  get selectedStep(): ProofStep | undefined {
    return this.current?.steps.find((step) => step.id === this.selectedStepId && stepBranchId(step) === this.branchId);
  }

  get checks(): ProofCheck[] {
    return validate(this.current);
  }

  save(): void {
    this.current.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.documents));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }

  update(mutator: (document: ProofDocument) => void): void {
    this.undoStack.push(clone(this.documents));
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
    mutator(this.current);
    this.save();
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(clone(this.documents));
    this.documents = previous;
    this.ensureSelection();
    this.save();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(clone(this.documents));
    this.documents = next;
    this.ensureSelection();
    this.save();
  }

  selectDocument(id: string): void {
    this.activeId = id;
    this.compareVersionId = '';
    this.ensureSelection();
  }

  selectBranch(branchId: string): void {
    if (!this.current.branches.some((branch) => branch.id === branchId)) return;
    this.current.activeBranchId = branchId;
    this.compareVersionId = '';
    this.ensureSelection();
    this.save();
  }

  selectStep(id: string): void {
    this.selectedStepId = id;
  }

  ensureSelection(): void {
    if (!this.documents.some((item) => item.id === this.activeId)) this.activeId = this.documents[0]?.id ?? '';
    const branchId = this.branchId;
    const inBranch = this.current?.steps.some(
      (step) => step.id === this.selectedStepId && stepBranchId(step) === branchId,
    );
    if (!inBranch) {
      this.selectedStepId =
        this.current?.steps.find((step) => stepBranchId(step) === branchId)?.id ?? '';
    }
  }

  addDocument(): void {
    const id = uid('doc');
    const firstStep = baseStep({
      id: uid('step'),
      type: 'premise',
      statement: '在这里输入前提',
      rule: '前提',
    });
    const document: ProofDocument = {
      id,
      title: '未命名证明',
      author: '本地用户',
      goal: '$A=B$',
      symbols: { A: '待定义对象', B: '待定义对象' },
      steps: [firstStep],
      versions: [],
      branches: [{ id: MAIN_BRANCH, name: '主分支', createdAt: new Date().toISOString() }],
      activeBranchId: MAIN_BRANCH,
      conditions: [],
      updatedAt: new Date().toISOString(),
    };
    this.undoStack.push(clone(this.documents));
    this.documents.unshift(document);
    this.activeId = id;
    this.selectedStepId = firstStep.id;
    this.save();
  }

  removeDocument(id: string): void {
    if (this.documents.length <= 1) {
      this.notify('至少保留一个证明文档');
      return;
    }
    this.undoStack.push(clone(this.documents));
    this.documents = this.documents.filter((item) => item.id !== id);
    this.ensureSelection();
    this.save();
  }

  addStep(type: ProofStep['type'] = 'derivation'): void {
    const step = baseStep({
      id: uid('step'),
      type,
      statement: type === 'goal' ? '$A=B$' : '输入新的推导式',
      rule: type === 'goal' ? '结论' : '等式变形',
      branchId: this.branchId,
      references: this.selectedStep ? [this.selectedStepId] : [],
    });
    this.update((document) => {
      const steps = document.steps;
      if (type === 'goal') {
        // 结论放在当前分支末尾（其他分支的步骤保持原位）。
        let lastIndex = -1;
        steps.forEach((item, index) => {
          if (stepBranchId(item) === this.branchId) lastIndex = index;
        });
        steps.splice(lastIndex + 1, 0, step);
      } else {
        const selectedIndex = steps.findIndex(
          (item) => item.id === this.selectedStepId && stepBranchId(item) === this.branchId,
        );
        steps.splice(selectedIndex >= 0 ? selectedIndex + 1 : steps.length, 0, step);
      }
    });
    this.selectedStepId = step.id;
  }

  removeStep(id: string): void {
    this.update((document) => {
      const removed = document.steps.find((step) => step.id === id);
      document.steps = document.steps.filter((step) => step.id !== id);
      document.steps.forEach((step) => {
        step.references = step.references.filter((reference) => reference !== id);
        step.introducedConditions = step.introducedConditions.filter((conditionId) => {
          const condition = document.conditions.find((item) => item.id === conditionId);
          return !(condition && condition.introducedAt === id);
        });
        step.dischargedConditions = step.dischargedConditions.filter((conditionId) => {
          const condition = document.conditions.find((item) => item.id === conditionId);
          return !(condition && condition.introducedAt === id);
        });
      });
      // 连同该步引入的条件台账与收回记录一起清理。
      if (removed) {
        const removedConditionIds = new Set(removed.introducedConditions);
        document.conditions = document.conditions.filter((condition) => !removedConditionIds.has(condition.id));
        document.steps.forEach((step) => {
          step.dischargedConditions = step.dischargedConditions.filter((conditionId) => !removedConditionIds.has(conditionId));
        });
      }
    });
    this.ensureSelection();
  }

  moveStep(sourceId: string, targetId: string): void {
    if (sourceId === targetId) return;
    this.update((document) => {
      const source = document.steps.find((step) => step.id === sourceId);
      const target = document.steps.find((step) => step.id === targetId);
      if (!source || !target || stepBranchId(source) !== stepBranchId(target)) return;
      const from = document.steps.findIndex((step) => step.id === sourceId);
      const to = document.steps.findIndex((step) => step.id === targetId);
      const [moved] = document.steps.splice(from, 1);
      document.steps.splice(to, 0, moved);
    });
  }

  updateStep(patch: Partial<ProofStep>): void {
    const id = this.selectedStepId;
    this.update((document) => {
      const step = document.steps.find((item) => item.id === id);
      if (step) Object.assign(step, patch);
    });
  }

  /* ---------------- 成立条件（证明义务） ---------------- */

  addCondition(stepId: string, label: string): string {
    const id = uid('cond');
    this.update((document) => {
      const step = document.steps.find((item) => item.id === stepId);
      if (!step) return;
      document.conditions.push({
        id,
        branchId: stepBranchId(step),
        label: label.trim() || '未命名条件',
        introducedAt: stepId,
        createdAt: new Date().toISOString(),
      });
      if (!step.introducedConditions.includes(id)) step.introducedConditions.push(id);
    });
    return id;
  }

  removeCondition(conditionId: string): void {
    this.update((document) => {
      document.conditions = document.conditions.filter((condition) => condition.id !== conditionId);
      document.steps.forEach((step) => {
        step.introducedConditions = step.introducedConditions.filter((id) => id !== conditionId);
        step.dischargedConditions = step.dischargedConditions.filter((id) => id !== conditionId);
      });
    });
  }

  toggleDischarge(stepId: string, conditionId: string): void {
    this.update((document) => {
      const step = document.steps.find((item) => item.id === stepId);
      if (!step) return;
      if (step.dischargedConditions.includes(conditionId)) {
        step.dischargedConditions = step.dischargedConditions.filter((id) => id !== conditionId);
      } else {
        step.dischargedConditions.push(conditionId);
      }
    });
  }

  /* ---------------- 分支 ---------------- */

  /** 从指定步骤处另开分支：复制当前分支中到该步为止的内容。 */
  forkBranch(name: string, fromStepId?: string): void {
    const sourceSteps = this.current.steps.filter((step) => stepBranchId(step) === this.branchId);
    if (sourceSteps.length === 0) {
      this.notify('当前分支还是空的，可使用“空白分支”');
      return;
    }
    const cutoff = fromStepId ? sourceSteps.findIndex((step) => step.id === fromStepId) : sourceSteps.length - 1;
    if (cutoff < 0) {
      this.notify('请先选择要分叉到哪一步');
      return;
    }
    const branchId = uid('branch');
    this.update((document) => {
      const copied = sourceSteps.slice(0, cutoff + 1);
      const idMap = new Map<string, string>();
      copied.forEach((step) => idMap.set(step.id, uid('step')));
      const conditionMap = new Map<string, string>();
      branchConditions(document, this.branchId).forEach((condition) => {
        if (copied.some((step) => step.introducedConditions.includes(condition.id))) {
          conditionMap.set(condition.id, uid('cond'));
        }
      });
      copied.forEach((step) => {
        const cloneStep = clone(step);
        cloneStep.id = idMap.get(step.id)!;
        cloneStep.branchId = branchId;
        cloneStep.references = step.references
          .map((reference) => idMap.get(reference) ?? '')
          .filter(Boolean);
        cloneStep.introducedConditions = step.introducedConditions
          .map((conditionId) => conditionMap.get(conditionId) ?? '')
          .filter(Boolean);
        cloneStep.dischargedConditions = step.dischargedConditions
          .map((conditionId) => conditionMap.get(conditionId) ?? '')
          .filter(Boolean);
        document.steps.push(cloneStep);
      });
      document.conditions.push(
        ...branchConditions(document, this.branchId)
          .filter((condition) => conditionMap.has(condition.id))
          .map((condition) => {
            const cloned = clone(condition);
            cloned.id = conditionMap.get(condition.id)!;
            cloned.branchId = branchId;
            cloned.introducedAt = idMap.get(condition.introducedAt) ?? cloned.introducedAt;
            return cloned;
          }),
      );
      document.branches.push({ id: branchId, name: name.trim() || `分支 ${document.branches.length + 1}`, createdAt: new Date().toISOString() });
      document.activeBranchId = branchId;
      this.selectedStepId = idMap.get(fromStepId ?? copied[copied.length - 1]?.id ?? '') ?? '';
    });
  }

  addBlankBranch(): void {
    const branchId = uid('branch');
    const firstStep = baseStep({
      id: uid('step'),
      type: 'premise',
      statement: '输入新分支的前提',
      rule: '前提',
      branchId,
    });
    this.update((document) => {
      document.branches.push({ id: branchId, name: `分支 ${document.branches.length + 1}`, createdAt: new Date().toISOString() });
      document.steps.push(firstStep);
      document.activeBranchId = branchId;
      this.selectedStepId = firstStep.id;
    });
  }

  renameBranch(branchId: string, name: string): void {
    this.update((document) => {
      const branch = document.branches.find((item) => item.id === branchId);
      if (branch) branch.name = name.trim() || branch.name;
    });
  }

  removeBranch(branchId: string): void {
    if (branchId === MAIN_BRANCH) {
      this.notify('主分支不能删除');
      return;
    }
    this.update((document) => {
      if (document.branches.length <= 1) return;
      document.steps = document.steps.filter((step) => stepBranchId(step) !== branchId);
      document.conditions = document.conditions.filter((condition) => condition.branchId !== branchId);
      document.branches = document.branches.filter((branch) => branch.id !== branchId);
      document.activeBranchId = MAIN_BRANCH;
      this.ensureSelection();
    });
  }

  /* ---------------- 版本快照 ---------------- */

  createVersion(): void {
    const branchId = this.branchId;
    const branch = this.branch;
    this.update((document) => {
      const version: ProofVersion = {
        id: uid('version'),
        name: `${branch.name} · 版本 ${document.versions.filter((version) => version.branchId === branchId).length + 1}`,
        createdAt: new Date().toISOString(),
        steps: clone(branchStepsOf(document, branchId)),
        goal: document.goal,
        branchId,
        branchName: branch.name,
        conditions: clone(branchConditions(document, branchId)),
      };
      document.versions.unshift(version);
      this.compareVersionId = version.id;
    });
    this.notify('已保存当前分支快照');
  }

  notify(message: string): void {
    this.toast = message;
    window.setTimeout(() => {
      if (this.toast === message) {
        this.toast = '';
        redraw();
      }
    }, 2200);
  }
}

function branchStepsOf(document: ProofDocument, branchId: string): ProofStep[] {
  return document.steps.filter((step) => stepBranchId(step) === branchId);
}

/* ------------------------------------------------------------------ */
/* 检查：只检查当前分支；目标带着未收回条件即报告证明缺口              */
/* ------------------------------------------------------------------ */

function stripLatexCommands(text: string): string {
  return text.replace(/\\[A-Za-z]+/g, ' ').replace(/[{}_^]/g, ' ');
}

const conditionLabel = (document: ProofDocument, conditionId: string): string =>
  document.conditions.find((condition) => condition.id === conditionId)?.label ?? conditionId;

export function validate(document: ProofDocument): ProofCheck[] {
  const checks: ProofCheck[] = [];
  const branchId = activeBranchId(document);
  const branch = document.branches.find((item) => item.id === branchId);
  const analysis = analyzeBranch(document, branchId);
  const steps = analysis.steps;
  const stepIndex = new Map(steps.map((step, index) => [step.id, index]));
  const symbolKeys = new Set(Object.keys(document.symbols));
  const ignored = new Set(['a', 'A', 'b', 'B', 'n', 'k', 'P', 'Q', 'R', 'x', 'y', 'to', 'text', 'frac', 'dfrac', 'sqrt', 'ne', 'ge', 'le']);

  checks.push({
    id: 'branch-scope',
    severity: 'info',
    title: `当前检查范围：${branch?.name ?? '主分支'}`,
    detail: `本分支共 ${steps.length} 步，检查、目标与导出均只依据该分支；共 ${analysis.openConditions.length} 个条件尚未完全收回。`,
  });

  steps.forEach((step, index) => {
    const tokens = stripLatexCommands(step.statement).match(/\b[A-Za-z][A-Za-z0-9']*\b/g) ?? [];
    const unknown = [...new Set(tokens.filter((token) => !symbolKeys.has(token) && !ignored.has(token)))];
    if (unknown.length) {
      checks.push({ id: `symbol-${step.id}`, severity: 'warning', title: '发现未定义符号', detail: `步骤 ${index + 1} 使用了：${unknown.join('、')}`, stepId: step.id });
    }

    step.references.forEach((reference) => {
      if (steps.some((item) => item.id === reference)) return;
      const foreign = document.steps.find((item) => item.id === reference);
      if (foreign) {
        const foreignBranch = document.branches.find((item) => item.id === stepBranchId(foreign));
        checks.push({
          id: `crossbranch-${step.id}-${reference}`,
          severity: 'error',
          title: '引用了其他分支的步骤',
          detail: `步骤 ${index + 1} 引用的步骤属于「${foreignBranch?.name ?? '其他分支'}」，条件不会跨分支传递，请改为引用当前分支内的步骤。`,
          stepId: step.id,
        });
      } else {
        checks.push({ id: `missing-${step.id}-${reference}`, severity: 'error', title: '引用步骤不存在', detail: `步骤 ${index + 1} 引用了已删除的步骤 ${reference}`, stepId: step.id });
      }
    });
  });

  if (analysis.cyclicSteps.size) {
    checks.push({ id: 'cycle', severity: 'error', title: '检测到循环引用', detail: '引用链形成闭环，请调整步骤关系。', stepId: [...analysis.cyclicSteps][0] });
  }

  // 无效收回：某步声称收回了当前并未传到该步的条件。
  const danglingReported = new Set<string>();
  analysis.invalidDischarges.forEach(({ stepId, conditionId }) => {
    const key = `${stepId}-${conditionId}`;
    if (danglingReported.has(key)) return;
    danglingReported.add(key);
    checks.push({
      id: `bad-discharge-${stepId}-${conditionId}`,
      severity: 'warning',
      title: '收回了未生效的条件',
      detail: `步骤 ${(stepIndex.get(stepId) ?? 0) + 1} 试图收回「${conditionLabel(document, conditionId)}」，但该条件此刻并不在其证明义务中。`,
      stepId,
    });
  });

  // 条件台账缺失。
  const danglingIntroReported = new Set<string>();
  analysis.danglingIntroductions.forEach(({ stepId, conditionId }) => {
    const key = `${stepId}-${conditionId}`;
    if (danglingIntroReported.has(key)) return;
    danglingIntroReported.add(key);
    checks.push({
      id: `dangling-intro-${stepId}-${conditionId}`,
      severity: 'warning',
      title: '条件缺少台账记录',
      detail: `步骤 ${(stepIndex.get(stepId) ?? 0) + 1} 引入的条件 ${conditionId} 不在「${branch?.name ?? '当前分支'}」的条件台账中。`,
      stepId,
    });
  });

  const goalStep = analysis.goalStep;
  if (!goalStep) {
    checks.push({ id: 'goal-missing', severity: 'error', title: '目标未被证明', detail: '请在当前分支添加“结论”类型的最终步骤。' });
  } else {
    const goalIndex = stepIndex.get(goalStep.id) ?? 0;
    if (goalStep.references.length === 0) {
      checks.push({ id: 'goal-unlinked', severity: 'warning', title: '结论尚无推导支撑', detail: '最终步骤没有引用任何前置步骤。', stepId: goalStep.id });
    }
    if (analysis.goalOpenConditions.length) {
      const labels = analysis.goalOpenConditions.map((conditionId) => `「${conditionLabel(document, conditionId)}」`).join('、');
      checks.push({
        id: 'goal-open-conditions',
        severity: 'error',
        title: '证明缺口：目标仍带未收回条件',
        detail: `步骤 ${goalIndex + 1} 推出目标时仍有 ${analysis.goalOpenConditions.length} 项成立条件未收回：${labels}。需要在某一步收回（如补回被排除的情形），否则目标只在附加限制下成立。`,
        stepId: goalStep.id,
      });
    }
  }

  if (!checks.some((check) => check.severity === 'error')) {
    checks.push({
      id: 'proof-ok',
      severity: 'info',
      title: analysis.openConditions.length === 0 ? '结构检查通过' : '结构可检查，仍有待收回条件',
      detail:
        analysis.openConditions.length === 0
          ? '当前分支上的条件已全部收回，未发现缺失引用、循环引用或未证明目标。'
          : `分支中仍有 ${analysis.openConditions.length} 项条件在传递，但尚未到达目标：${analysis.openConditions
              .map((conditionId) => `「${conditionLabel(document, conditionId)}」`)
              .join('、')}。`,
    });
  }
  return checks;
}

/* ------------------------------------------------------------------ */
/* 版本比较：只在同一分支的快照间展开                                   */
/* ------------------------------------------------------------------ */

export function compareVersion(document: ProofDocument, version: ProofVersion) {
  const result = [];
  const current = version.branchId ? branchStepsOf(document, version.branchId) : document.steps;
  const size = Math.max(current.length, version.steps.length);
  for (let index = 0; index < size; index += 1) {
    const before = version.steps[index]?.statement ?? '';
    const after = current[index]?.statement ?? '';
    const kind = !before ? 'added' : !after ? 'removed' : before === after ? 'same' : 'changed';
    result.push({ kind, label: `步骤 ${index + 1}`, before, after } as const);
  }
  return result;
}

export function createId(prefix: string): string {
  return uid(prefix);
}
