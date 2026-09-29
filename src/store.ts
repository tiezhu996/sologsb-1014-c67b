import { redraw } from 'mithril';
import type { ProofBranch, ProofCheck, ProofCondition, ProofDocument, ProofStep, ProofVersion } from './types';

const STORAGE_KEY = 'sologsb-1014-proof-workspace-v1';
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const clone = <T>(value: T): T => structuredClone(value);

export const RULES = ['前提', '定义展开', '代入', '等式变形', '分配律', '同类项合并', '数学归纳', '反证法', '构造法', '结论'];

const c = (id: string, text: string): ProofCondition => ({ id, text });

function sampleSteps(): ProofStep[] {
  return [
    { id: 's1', type: 'premise', statement: '$a,b$ 是实数', rule: '前提', references: [], note: '采用实数域中的交换律与分配律。', counterexample: '', alternative: '', conditions: [], discharges: [] },
    { id: 's2', type: 'derivation', statement: '$(a+b)^2=(a+b)(a+b)$', rule: '定义展开', references: ['s1'], note: '把平方写成两个相同因式之积。', counterexample: '', alternative: '', conditions: [], discharges: [] },
    { id: 's3', type: 'derivation', statement: '$(a+b)(a+b)=a^2+ab+ba+b^2$', rule: '分配律', references: ['s2'], note: '', counterexample: '', alternative: '也可先展开后半部分。', conditions: [], discharges: [] },
    { id: 's4', type: 'derivation', statement: '$a^2+ab+ba+b^2=a^2+2ab+b^2$', rule: '同类项合并', references: ['s3'], note: '由实数的交换律，$ab=ba$。', counterexample: '', alternative: '', conditions: [], discharges: [] },
    { id: 's5', type: 'goal', statement: '$(a+b)^2=a^2+2ab+b^2$', rule: '结论', references: ['s4'], note: '目标已由步骤 1 至 4 逐项推出。', counterexample: '', alternative: '', conditions: [], discharges: [] },
  ];
}

function issueSteps(): ProofStep[] {
  return [
    { id: 'i1', type: 'premise', statement: '$n$ 是正整数', rule: '前提', references: [], note: '', counterexample: '', alternative: '', conditions: [c('c-n-pos', '$n$ 为正整数（$n \\ge 1$）')], discharges: [] },
    { id: 'i2', type: 'derivation', statement: '$P(1)$ 成立', rule: '前提', references: ['i1'], note: '归纳基例。', counterexample: '', alternative: '', conditions: [c('c-k-pos', '$k \\ge 1$：归纳假设对正整数 $k$ 成立')], discharges: [] },
    { id: 'i3', type: 'derivation', statement: '若 $P(k)$ 成立，则 $P(k+1)$ 也成立', rule: '数学归纳', references: ['i2', 'missing-step'], note: '递推在 $k \\ge 1$ 前提下进行，收回该条件；但递推步骤本身缺少引用。', counterexample: '', alternative: '', conditions: [], discharges: ['c-k-pos'] },
    { id: 'i4', type: 'goal', statement: '$P(n)$ 对所有正整数 $n$ 成立', rule: '结论', references: ['i3'], note: '基例与递推尚未补全。', counterexample: '', alternative: '', conditions: [], discharges: [] },
  ];
}

function initialDocuments(): ProofDocument[] {
  const now = new Date().toISOString();
  const build = (id: string, title: string, author: string, goal: string, symbols: ProofDocument['symbols'], steps: ProofStep[]): ProofDocument => ({
    id,
    title,
    author,
    goal,
    symbols,
    steps,
    branches: [{ id: 'main', name: '主分支', steps, goal }],
    activeBranchId: 'main',
    versions: [],
    updatedAt: now,
  });
  return [
    build('doc-algebra', '完全平方公式证明', '数学组', '$(a+b)^2=a^2+2ab+b^2$', { a: '实数', b: '实数', P: '关于正整数的命题', n: '正整数', k: '正整数' }, sampleSteps()),
    build('doc-induction', '数学归纳法待核对稿', '学生工作区', '$P(n)$ 对所有正整数 $n$ 成立', { P: '关于正整数的命题', n: '正整数', k: '正整数' }, issueSteps()),
  ];
}

/**
 * 旧稿迁移：没有分支信息的文档归到主分支继续打开；
 * 旧步骤补全 conditions / discharges 字段。
 */
function migrateDocument(document: ProofDocument): ProofDocument {
  if (!Array.isArray(document.branches) || document.branches.length === 0) {
    document.branches = [{ id: 'main', name: '主分支', steps: document.steps ?? [], goal: document.goal ?? '' }];
  }
  if (!document.activeBranchId || !document.branches.some((branch) => branch.id === document.activeBranchId)) {
    document.activeBranchId = document.branches[0].id;
  }
  document.branches.forEach((branch) => {
    branch.steps.forEach((step) => {
      step.conditions ??= [];
      step.discharges ??= [];
    });
  });
  return document;
}

function loadDocuments(): ProofDocument[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialDocuments();
    const parsed = JSON.parse(raw) as ProofDocument[];
    return Array.isArray(parsed) && parsed.length ? parsed : initialDocuments();
  } catch {
    return initialDocuments();
  }
}

export class ProofStore {
  documents = loadDocuments().map(migrateDocument);
  activeId = this.documents[0]?.id ?? '';
  selectedStepId = this.documents[0]?.steps[0]?.id ?? '';
  compareVersionId = '';
  dragStepId = '';
  lastInput: HTMLTextAreaElement | HTMLInputElement | null = null;
  undoStack: ProofDocument[][] = [];
  redoStack: ProofDocument[][] = [];
  toast = '';

  constructor() {
    this.realiasAll();
  }

  /** 把每个文档的工作副本（steps/goal）重新指向活动分支，保证撤销/重做后别名仍然成立。 */
  private realiasAll(): void {
    for (const document of this.documents) {
      const branch = document.branches.find((item) => item.id === document.activeBranchId) ?? document.branches[0];
      if (branch) {
        document.steps = branch.steps;
        document.goal = branch.goal;
      }
    }
  }

  /** 活动分支的工作副本可能被整体替换（如删除步骤），写回分支以保持一致。 */
  private syncActiveBranch(): void {
    const document = this.current;
    if (!document) return;
    const branch = document.branches.find((item) => item.id === document.activeBranchId) ?? document.branches[0];
    if (branch) {
      branch.steps = document.steps;
      branch.goal = document.goal;
    }
  }

  get current(): ProofDocument {
    return this.documents.find((item) => item.id === this.activeId) ?? this.documents[0];
  }

  get activeBranch(): ProofBranch | undefined {
    const document = this.current;
    return document?.branches.find((item) => item.id === document.activeBranchId) ?? document?.branches[0];
  }

  get selectedStep(): ProofStep | undefined {
    return this.current?.steps.find((step) => step.id === this.selectedStepId);
  }

  get checks(): ProofCheck[] {
    if (!this.current) return [];
    return validate(this.current);
  }

  save(): void {
    this.current.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.documents));
  }

  update(mutator: (document: ProofDocument) => void): void {
    this.undoStack.push(clone(this.documents));
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
    mutator(this.current);
    this.syncActiveBranch();
    this.save();
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(clone(this.documents));
    this.documents = previous;
    this.realiasAll();
    this.ensureSelection();
    this.save();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(clone(this.documents));
    this.documents = next;
    this.realiasAll();
    this.ensureSelection();
    this.save();
  }

  selectDocument(id: string): void {
    this.activeId = id;
    this.compareVersionId = '';
    this.realiasAll();
    this.selectedStepId = this.current?.steps[0]?.id ?? '';
  }

  selectStep(id: string): void {
    this.selectedStepId = id;
  }

  ensureSelection(): void {
    if (!this.documents.some((item) => item.id === this.activeId)) this.activeId = this.documents[0]?.id ?? '';
    if (!this.current?.steps.some((step) => step.id === this.selectedStepId)) {
      this.selectedStepId = this.current?.steps[0]?.id ?? '';
    }
  }

  addDocument(): void {
    const id = uid('doc');
    const firstStep: ProofStep = { id: uid('step'), type: 'premise', statement: '在这里输入前提', rule: '前提', references: [], note: '', counterexample: '', alternative: '', conditions: [], discharges: [] };
    const mainBranch: ProofBranch = { id: 'main', name: '主分支', steps: [firstStep], goal: '$A=B$' };
    const document: ProofDocument = {
      id,
      title: '未命名证明',
      author: '本地用户',
      goal: '$A=B$',
      symbols: { A: '待定义对象', B: '待定义对象' },
      steps: mainBranch.steps,
      branches: [mainBranch],
      activeBranchId: 'main',
      versions: [],
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
    const step: ProofStep = {
      id: uid('step'),
      type,
      statement: type === 'goal' ? '$A=B$' : '输入新的推导式',
      rule: type === 'goal' ? '结论' : '等式变形',
      references: this.selectedStepId ? [this.selectedStepId] : [],
      note: '',
      counterexample: '',
      alternative: '',
      conditions: [],
      discharges: [],
    };
    this.update((document) => {
      const selectedIndex = document.steps.findIndex((item) => item.id === this.selectedStepId);
      document.steps.splice(type === 'goal' ? document.steps.length : selectedIndex + 1, 0, step);
    });
    this.selectedStepId = step.id;
  }

  removeStep(id: string): void {
    this.update((document) => {
      document.steps = document.steps.filter((step) => step.id !== id);
      document.steps.forEach((step) => {
        step.references = step.references.filter((reference) => reference !== id);
      });
    });
    this.ensureSelection();
  }

  moveStep(sourceId: string, targetId: string): void {
    if (sourceId === targetId) return;
    this.update((document) => {
      const from = document.steps.findIndex((step) => step.id === sourceId);
      const to = document.steps.findIndex((step) => step.id === targetId);
      if (from < 0 || to < 0) return;
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

  createVersion(): void {
    this.update((document) => {
      const version: ProofVersion = {
        id: uid('version'),
        name: `版本 ${document.versions.length + 1}`,
        createdAt: new Date().toISOString(),
        steps: clone(document.steps),
        goal: document.goal,
      };
      document.versions.unshift(version);
      this.compareVersionId = version.id;
    });
    this.notify('已保存当前证明快照');
  }

  switchBranch(id: string): void {
    const document = this.current;
    const branch = document.branches.find((item) => item.id === id);
    if (!branch || branch.id === document.activeBranchId) return;
    this.undoStack.push(clone(this.documents));
    document.activeBranchId = branch.id;
    document.steps = branch.steps;
    document.goal = branch.goal;
    this.selectedStepId = branch.steps[0]?.id ?? '';
    this.save();
  }

  addBranch(name?: string): void {
    const document = this.current;
    this.undoStack.push(clone(this.documents));
    this.syncActiveBranch();
    const id = uid('branch');
    const copy = clone({ steps: document.steps, goal: document.goal });
    const branch: ProofBranch = {
      id,
      name: name?.trim() || `分支 ${document.branches.length + 1}`,
      steps: copy.steps,
      goal: copy.goal,
    };
    document.branches.push(branch);
    document.activeBranchId = id;
    document.steps = branch.steps;
    document.goal = branch.goal;
    this.selectedStepId = branch.steps[0]?.id ?? '';
    this.save();
    this.notify('已切换到新分支');
  }

  removeBranch(id: string): void {
    const document = this.current;
    if (document.branches.length <= 1) {
      this.notify('至少保留一个分支');
      return;
    }
    this.undoStack.push(clone(this.documents));
    const index = document.branches.findIndex((item) => item.id === id);
    document.branches = document.branches.filter((item) => item.id !== id);
    if (document.activeBranchId === id) {
      const next = document.branches[Math.max(0, index - 1)] ?? document.branches[0];
      document.activeBranchId = next.id;
      document.steps = next.steps;
      document.goal = next.goal;
    }
    this.ensureSelection();
    this.save();
  }

  renameBranch(id: string, name: string): void {
    const document = this.current;
    const branch = document.branches.find((item) => item.id === id);
    if (!branch) return;
    this.update(() => {
      branch.name = name.trim() || branch.name;
    });
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

function stripLatexCommands(text: string): string {
  return text.replace(/\\[A-Za-z]+/g, ' ').replace(/[{}_^]/g, ' ');
}

/**
 * 计算每个步骤上「仍成立」的条件：
 * 沿引用链向后代传递（引用者继承被引用者的未收回条件），
 * 本步引入新条件，本步收回的条件从本步起移除。
 * 不同分支各自调用本函数，互不影响。
 */
export function outstandingByStep(steps: ProofStep[]): Map<string, ProofCondition[]> {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const result = new Map<string, ProofCondition[]>();
  const visiting = new Set<string>();

  const visit = (id: string): void => {
    if (result.has(id)) return;
    if (visiting.has(id)) return; // 循环引用另行报错，这里先绕开
    const step = byId.get(id);
    if (!step) {
      result.set(id, []);
      return;
    }
    visiting.add(id);
    const inherited: ProofCondition[] = [];
    for (const reference of step.references) {
      if (!byId.has(reference)) continue;
      visit(reference);
      for (const condition of result.get(reference) ?? []) {
        if (!inherited.some((item) => item.id === condition.id)) inherited.push(condition);
      }
    }
    visiting.delete(id);
    const discharged = new Set(step.discharges ?? []);
    const own = step.conditions ?? [];
    result.set(id, [...inherited, ...own].filter((condition) => !discharged.has(condition.id)));
  };

  steps.forEach((step) => visit(step.id));
  return result;
}

export function validate(document: ProofDocument): ProofCheck[] {
  const checks: ProofCheck[] = [];
  const steps = document.steps;
  const ids = new Set(steps.map((step) => step.id));
  const symbolKeys = new Set(Object.keys(document.symbols));
  const ignored = new Set(['a', 'A', 'b', 'B', 'n', 'k', 'P', 'Q', 'R', 'x', 'y', 'to', 'text', 'frac', 'sqrt']);
  const outstanding = outstandingByStep(steps);
  const allConditionIds = new Set(steps.flatMap((step) => (step.conditions ?? []).map((condition) => condition.id)));

  steps.forEach((step, index) => {
    const tokens = stripLatexCommands(step.statement).match(/\b[A-Za-z][A-Za-z0-9']*\b/g) ?? [];
    const unknown = [...new Set(tokens.filter((token) => !symbolKeys.has(token) && !ignored.has(token)))];
    if (unknown.length) {
      checks.push({ id: `symbol-${step.id}`, severity: 'warning', title: '发现未定义符号', detail: `步骤 ${index + 1} 使用了：${unknown.join('、')}`, stepId: step.id });
    }

    step.references.forEach((reference) => {
      if (!ids.has(reference)) {
        checks.push({ id: `missing-${step.id}-${reference}`, severity: 'error', title: '引用步骤不存在', detail: `步骤 ${index + 1} 引用了已删除的步骤 ${reference}`, stepId: step.id });
      }
    });

    (step.discharges ?? []).forEach((conditionId) => {
      if (!allConditionIds.has(conditionId)) {
        checks.push({ id: `discharge-missing-${step.id}-${conditionId}`, severity: 'warning', title: '收回了不存在的条件', detail: `步骤 ${index + 1} 试图收回条件 ${conditionId}，但该条件未在任何步骤引入。`, stepId: step.id });
      }
    });
  });

  const graph = new Map(steps.map((step) => [step.id, step.references.filter((id) => ids.has(id))]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycleStep = new Set<string>();
  const visit = (id: string, path: string[]): boolean => {
    if (visiting.has(id)) {
      path.slice(path.indexOf(id)).forEach((item) => cycleStep.add(item));
      return true;
    }
    if (visited.has(id)) return false;
    visiting.add(id);
    const hasCycle = (graph.get(id) ?? []).some((next) => visit(next, [...path, id]));
    visiting.delete(id);
    visited.add(id);
    return hasCycle;
  };
  [...graph.keys()].forEach((id) => visit(id, []));
  if (cycleStep.size) {
    checks.push({ id: 'cycle', severity: 'error', title: '检测到循环引用', detail: '引用链形成闭环，请调整步骤关系。', stepId: [...cycleStep][0] });
  }

  const goalStep = steps.find((step) => step.type === 'goal' && step.rule === '结论');
  if (!goalStep) {
    checks.push({ id: 'goal-missing', severity: 'error', title: '目标未被证明', detail: '请添加“结论”类型的最终步骤。' });
  } else {
    const goalOutstanding = outstanding.get(goalStep.id) ?? [];
    if (goalOutstanding.length) {
      checks.push({
        id: `goal-gap-${goalStep.id}`,
        severity: 'error',
        title: '证明缺口：结论仍受未收回条件限制',
        detail: `目标步骤仍有 ${goalOutstanding.length} 个成立条件未收回：${goalOutstanding.map((condition) => condition.text).join('；')}`,
        stepId: goalStep.id,
      });
    }
    if (goalStep.references.length === 0) {
      checks.push({ id: 'goal-unlinked', severity: 'warning', title: '结论尚无推导支撑', detail: '最终步骤没有引用任何前置步骤。', stepId: goalStep.id });
    }
  }

  if (!checks.some((check) => check.severity === 'error')) {
    checks.push({ id: 'proof-ok', severity: 'info', title: '结构检查通过', detail: '未发现缺失引用、循环引用或未证明目标。' });
  }
  return checks;
}

export function compareVersion(document: ProofDocument, version: ProofVersion) {
  const result = [];
  const size = Math.max(document.steps.length, version.steps.length);
  for (let index = 0; index < size; index += 1) {
    const before = version.steps[index]?.statement ?? '';
    const after = document.steps[index]?.statement ?? '';
    const kind = !before ? 'added' : !after ? 'removed' : before === after ? 'same' : 'changed';
    result.push({ kind, label: `步骤 ${index + 1}`, before, after } as const);
  }
  return result;
}

export function createId(prefix: string): string {
  return uid(prefix);
}
