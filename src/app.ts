import m, { type Component } from 'mithril';
import katex from 'katex';
import { compareVersion, ProofStore, RULES } from './store';
import { analyzeBranch, branchConditions, MAIN_BRANCH, suggestConditions } from './obligations';
import type { BranchAnalysis } from './obligations';
import type { ProofDocument, ProofStep } from './types';

const store = new ProofStore();

const snippets = [
  { label: '∀', value: '\\forall ' },
  { label: '∃', value: '\\exists ' },
  { label: '→', value: '\\to ' },
  { label: '⇔', value: '\\iff ' },
  { label: '≠', value: '\\ne ' },
  { label: '≤', value: '\\le ' },
  { label: '≥', value: '\\ge ' },
  { label: '∈', value: '\\in ' },
  { label: '∑', value: '\\sum_{i=1}^{n} ' },
  { label: '√', value: '\\sqrt{}' },
  { label: '分式', value: '\\frac{}{}' },
  { label: '上标', value: '^{}' },
  { label: '下标', value: '_{}' },
];

const typeLabel: Record<ProofStep['type'], string> = {
  premise: '前提',
  derivation: '推导',
  goal: '目标 / 结论',
};

function renderRichText(text: string): m.Children {
  const parts = text.split(/(\$[^$]+\$)/g);
  return parts.map((part) => {
    if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
      try {
        return m.trust(katex.renderToString(part.slice(1, -1), { throwOnError: false, output: 'html' }));
      } catch {
        return part;
      }
    }
    return part;
  });
}

function shortId(id: string): string {
  return id.replace(/^step-/, '').slice(-4).toUpperCase();
}

function download(name: string, content: string, mime: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type: mime }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function exportMarkdown(document: ProofDocument, analysis: BranchAnalysis): string {
  const branch = document.branches.find((item) => item.id === analysis.branchId);
  const steps = analysis.steps;
  const indexOf = (id: string) => steps.findIndex((item) => item.id === id);
  const conditionText = (id: string) => document.conditions.find((condition) => condition.id === id)?.label ?? id;
  const lines = [
    `# ${document.title}`,
    '',
    `**证明分支：** ${branch?.name ?? '主分支'}`,
    `**证明目标：** $${document.goal}$`,
    '',
  ];
  steps.forEach((step, index) => {
    const refs = step.references.map((id) => `步骤 ${indexOf(id) + 1}`).filter((ref) => !ref.endsWith('0'));
    lines.push(`## ${index + 1}. ${step.statement}`);
    lines.push('');
    lines.push(`- 类型：${typeLabel[step.type]}`);
    lines.push(`- 推理规则：${step.rule}`);
    if (refs.length) lines.push(`- 依据：${refs.join('、')}`);
    const incoming = [...(analysis.incoming.get(step.id) ?? [])];
    if (incoming.length) lines.push(`- 引用时仍需满足：${incoming.map(conditionText).join('、')}`);
    if (step.introducedConditions.length) lines.push(`- 本步附加条件：${step.introducedConditions.map(conditionText).join('、')}`);
    if (step.dischargedConditions.length) lines.push(`- 本步收回条件：${step.dischargedConditions.map(conditionText).join('、')}`);
    if (step.note) lines.push(`- 旁注：${step.note}`);
    if (step.counterexample) lines.push(`- 反例：${step.counterexample}`);
    if (step.alternative) lines.push(`- 替代分支：${step.alternative}`);
    lines.push('');
  });
  lines.push('## 成立条件台账（本分支）');
  if (branchConditions(document, analysis.branchId).length === 0) {
    lines.push('- 无附加成立条件。');
  } else {
    branchConditions(document, analysis.branchId).forEach((condition) => {
      const open = analysis.openConditions.includes(condition.id);
      const introduced = indexOf(condition.introducedAt) + 1;
      lines.push(`- ${condition.label}：引入于步骤 ${introduced > 0 ? introduced : '?'}，状态：${open ? '未收回（证明缺口）' : '已收回'}`);
    });
  }
  lines.push('');
  lines.push('## 符号表');
  Object.entries(document.symbols).forEach(([symbol, meaning]) => lines.push(`- $${symbol}$：${meaning}`));
  return lines.join('\n');
}

function exportLatex(document: ProofDocument, analysis: BranchAnalysis): string {
  const branch = document.branches.find((item) => item.id === analysis.branchId);
  const steps = analysis.steps;
  const indexOf = (id: string) => steps.findIndex((item) => item.id === id);
  const conditionText = (id: string) => document.conditions.find((condition) => condition.id === id)?.label.replace(/\$/g, '') ?? id;
  const lines = [
    '\\documentclass{article}',
    '\\usepackage{amsmath,amssymb}',
    '\\begin{document}',
    `\\section*{${document.title}}`,
    `\\textbf{证明分支：} ${branch?.name ?? '主分支'}\\\\`,
    `\\textbf{证明目标：} $${document.goal}$`,
    '\\begin{enumerate}',
  ];
  steps.forEach((step) => {
    const refs = step.references.map((id) => indexOf(id) + 1).filter(Boolean);
    const support = refs.length ? `（依据 ${refs.join(', ')}；${step.rule}）` : `（${step.rule}）`;
    lines.push(`  \\item ${step.statement} ${support}`);
    const incoming = [...(analysis.incoming.get(step.id) ?? [])].map(conditionText);
    if (incoming.length) lines.push(`  \\par\\small 引用时仍需满足：${incoming.join('；')}`);
    if (step.introducedConditions.length) lines.push(`  \\par\\small 附加条件：${step.introducedConditions.map(conditionText).join('；')}`);
    if (step.dischargedConditions.length) lines.push(`  \\par\\small 收回条件：${step.dischargedConditions.map(conditionText).join('；')}`);
    if (step.note) lines.push(`  \\par\\small 旁注：${step.note}`);
  });
  lines.push('\\end{enumerate}');
  lines.push(`\\paragraph*{成立条件台账（${branch?.name ?? '主分支'}）}`);
  if (branchConditions(document, analysis.branchId).length === 0) {
    lines.push('无附加成立条件。');
  } else {
    lines.push('\\begin{itemize}');
    branchConditions(document, analysis.branchId).forEach((condition) => {
      const open = analysis.openConditions.includes(condition.id);
      const introduced = indexOf(condition.introducedAt) + 1;
      lines.push(`  \\item $${condition.label.replace(/\$/g, '')}$：引入于步骤 ${introduced > 0 ? introduced : '?'}，${open ? '\\textbf{未收回}' : '已收回'}`);
    });
    lines.push('\\end{itemize}');
  }
  lines.push('\\end{document}');
  return lines.join('\n');
}

export class ProofApp implements Component {
  private readonly onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    const inEditor = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? store.redo() : store.undo();
      m.redraw();
      return;
    }
    if (command && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      store.redo();
      m.redraw();
      return;
    }
    if (command && event.key === 'Enter') {
      event.preventDefault();
      store.addStep(event.shiftKey ? 'goal' : 'derivation');
      m.redraw();
      return;
    }
    if (command && event.key.toLowerCase() === 's') {
      event.preventDefault();
      store.save();
      store.notify('已保存到浏览器');
      m.redraw();
      return;
    }
    if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp') && !inEditor) {
      event.preventDefault();
      const steps = store.current.steps;
      const index = steps.findIndex((step) => step.id === store.selectedStepId);
      const next = event.key === 'ArrowDown' ? Math.min(index + 1, steps.length - 1) : Math.max(index - 1, 0);
      store.selectStep(steps[next]?.id ?? '');
      document.querySelector(`[data-step="${store.selectedStepId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      m.redraw();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !inEditor && store.selectedStepId) {
      event.preventDefault();
      store.removeStep(store.selectedStepId);
      m.redraw();
    }
  };

  oncreate(): void {
    window.addEventListener('keydown', this.onKeyDown);
  }

  onremove(): void {
    window.removeEventListener('keydown', this.onKeyDown);
  }

  view(): m.Children {
    const document = store.current;
    const selected = store.selectedStep;
    const checks = store.checks;
    const errors = checks.filter((check) => check.severity === 'error').length;
    const warnings = checks.filter((check) => check.severity === 'warning').length;
    const analysis = analyzeBranch(document, store.branchId);
    const branchSteps = analysis.steps;
    const indexInBranch = (id: string) => branchSteps.findIndex((step) => step.id === id);
    const conditionById = (id: string) => document.conditions.find((condition) => condition.id === id);
    const selectedVersion = document.versions.find((version) => version.id === store.compareVersionId);
    const diff = selectedVersion ? compareVersion(document, selectedVersion) : [];

    return m('div.app-shell', [
      m('header.topbar', [
        m('div.brand', [
          m('div.brand-mark', '∑'),
          m('div', [m('p.eyebrow', 'FORMAL NOTEBOOK'), m('h1', '格致 · 证明编辑器')]),
        ]),
        m('div.topbar-center', [
          m('span.status-dot', { class: errors ? 'has-error' : 'is-ok' }),
          errors ? `${errors} 个结构错误` : '证明结构可检查',
          m('span.topbar-separator'),
          `自动保存于 ${new Date(document.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
        ]),
        m('div.actions', [
          m('button.button.is-light', { onclick: () => { store.undo(); m.redraw(); }, disabled: !store.undoStack.length, title: '撤销 Ctrl+Z' }, '↶ 撤销'),
          m('button.button.is-light', { onclick: () => { store.redo(); m.redraw(); }, disabled: !store.redoStack.length, title: '重做 Ctrl+Y' }, '↷ 重做'),
          m('button.button.is-link', { onclick: () => { store.addStep('derivation'); m.redraw(); }, title: '添加步骤 Ctrl+Enter' }, '+ 添加步骤'),
        ]),
      ]),
      m('main.workspace', [
        m('aside.left-rail', [
          m('section.panel.document-panel', [
            m('div.panel-heading', [m('span', '证明文档'), m('button.icon-button', { onclick: () => { store.addDocument(); m.redraw(); }, title: '新建证明' }, '+')]),
            m('div.document-list', store.documents.map((item) => m('button.document-item', {
              class: item.id === document.id ? 'is-active' : '',
              onclick: () => { store.selectDocument(item.id); m.redraw(); },
            }, [
              m('span.document-glyph', item.steps.length),
              m('span.document-copy', [m('strong', item.title), m('small', `${item.steps.length} 步 · ${item.branches.length} 分支 · ${item.author}`)]),
              m('span.chevron', '›'),
            ]))),
          ]),
          m('section.panel.version-panel', [
            m('div.panel-heading', [m('span', '版本快照'), m('span.count-badge', document.versions.length)]),
            document.versions.length === 0 && m('p.empty-copy', '保存快照后，可以并排查看改动。快照只包含保存时所在分支。'),
            m('div.version-list', document.versions.map((version) => {
              const inCurrentBranch = !version.branchId || version.branchId === store.branchId;
              return m('button.version-item', {
                class: version.id === store.compareVersionId ? 'is-active' : '',
                disabled: !inCurrentBranch,
                title: inCurrentBranch ? '对比该快照' : `该快照属于「${version.branchName ?? '其他分支'}」，切换分支后查看`,
                onclick: () => {
                  if (!inCurrentBranch) return;
                  store.compareVersionId = store.compareVersionId === version.id ? '' : version.id;
                  m.redraw();
                },
              }, [
                m('span', [
                  version.name,
                  !inCurrentBranch && m('em.version-branch', `（${version.branchName ?? '其他分支'}）`),
                ]),
                m('small', new Date(version.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })),
              ]);
            })),
            m('button.button.is-fullwidth.is-small', { onclick: () => { store.createVersion(); m.redraw(); } }, `＋ 保存「${store.branch.name}」快照`),
          ]),
          m('section.check-summary', [
            m('div.check-summary-head', [
              m('div', [m('span.eyebrow', 'LIVE CHECK'), m('h2', '证明检查')]),
              m('span.check-total', { class: errors ? 'has-error' : '' }, errors + warnings),
            ]),
            m('div.check-summary-bars', [
              m('span', { style: { width: `${Math.max(8, 100 - errors * 24 - warnings * 12)}%` } }),
            ]),
            m('p', errors
              ? `当前分支有 ${errors} 个错误（含未收回条件造成的证明缺口）。`
              : warnings
                ? '结构有效，仍有待核对项。'
                : analysis.openConditions.length
                  ? '当前分支仍有条件在传递中。'
                  : '当前分支条件已全部收回，结构完整。'),
          ]),
        ]),
        m('section.editor-column', [
          m('div.editor-titlebar', [
            m('div', [
              m('input.title-input', { value: document.title, oninput: (event: Event) => { store.update((item) => { item.title = (event.target as HTMLInputElement).value; }); } }),
              m('div.editor-meta', [`${document.author} · ${store.branch.name} · ${branchSteps.length} 个步骤`, m('span.keyboard-hint', '拖动 ⠿ 排序')]),
            ]),
            m('div.export-actions', [
              m('button.button.is-small', { onclick: () => download(`${document.title}-${store.branch.name}.md`, exportMarkdown(document, analysis), 'text/markdown;charset=utf-8') }, '导出 Markdown'),
              m('button.button.is-small', { onclick: () => download(`${document.title}-${store.branch.name}.tex`, exportLatex(document, analysis), 'application/x-tex;charset=utf-8') }, '导出 LaTeX'),
            ]),
          ]),
          m('section.goal-card', { class: analysis.goalOpenConditions.length ? 'has-gap' : '' }, [
            m('div.goal-label', '证明目标'),
            m('div.goal-formula', renderRichText(`$${document.goal}$`)),
            m('input.formula-input', {
              value: document.goal,
              onfocus: (event: Event) => { store.lastInput = event.target as HTMLInputElement; },
              oninput: (event: Event) => store.update((item) => { item.goal = (event.target as HTMLInputElement).value; }),
              'aria-label': '证明目标',
            }),
            m('div.goal-obligations', { class: analysis.goalOpenConditions.length ? 'is-open' : 'is-clear' }, analysis.goalOpenConditions.length
              ? [
                  m('strong', `证明缺口：目标仍带 ${analysis.goalOpenConditions.length} 项未收回条件`),
                  m('span.goal-condition-list', analysis.goalOpenConditions.map((conditionId) =>
                    m('span.condition-chip.is-open', renderRichText(conditionById(conditionId)?.label ?? conditionId)))),
                ]
              : [m('strong', analysis.goalStep ? '目标上的成立条件已全部收回' : '尚无结论步骤'), m('span', analysis.goalStep ? '当前结论不附带任何未收回的参数限制。' : '在当前分支添加“结论”步骤后再核对条件。')]),
          ]),
          m('div.branch-bar', [
            m('div.branch-tabs', document.branches.map((branch) => {
              const branchAnalysis = analyzeBranch(document, branch.id);
              const openCount = branchAnalysis.openConditions.length;
              const gapCount = branchAnalysis.goalOpenConditions.length;
              return m('button.branch-tab', {
                class: branch.id === store.branchId ? 'is-active' : '',
                onclick: () => { store.selectBranch(branch.id); m.redraw(); },
                title: `${branch.name}：${openCount} 项条件未收回，${gapCount} 项压在目标上`,
              }, [
                m('span.branch-name', branch.name),
                m('span.branch-badge', { class: gapCount ? 'has-gap' : openCount ? 'has-open' : 'is-clear' }, gapCount ? `缺口 ${gapCount}` : openCount ? `待收回 ${openCount}` : '已闭环'),
                branch.id === store.branchId && branch.id !== MAIN_BRANCH && m('span.branch-delete', {
                  title: '删除该分支',
                  onclick: (event: Event) => { event.stopPropagation(); store.removeBranch(branch.id); m.redraw(); },
                }, '×'),
              ]);
            })),
            m('div.branch-actions', [
              m('button.button.is-small.is-white', {
                title: '从当前选中步骤处分出替代分支，条件与收回记录各自独立保存',
                onclick: () => {
                  const name = window.prompt('新分支名称（复制当前分支到选中步骤为止的内容）', `分支 ${document.branches.length + 1}`);
                  if (name === null) return;
                  store.forkBranch(name, store.selectedStepId);
                  m.redraw();
                },
              }, '⎇ 从此处分出分支'),
              m('button.button.is-small.is-white', {
                title: '新建一个空白分支',
                onclick: () => { store.addBlankBranch(); m.redraw(); },
              }, '＋ 空白分支'),
            ]),
          ]),
          m('div.steps-toolbar', [
            m('div', [m('strong', '证明步骤'), m('span.steps-count', `${store.branch.name} · ${branchSteps.length} 步`)]),
            m('div.steps-toolbar-actions', [
              m('button.button.is-small.is-white', { onclick: () => { store.addStep('premise'); m.redraw(); } }, '＋ 前提'),
              m('button.button.is-small.is-white', { onclick: () => { store.addStep('derivation'); m.redraw(); } }, '＋ 推导'),
              m('button.button.is-small.is-white', { onclick: () => { store.addStep('goal'); m.redraw(); } }, '＋ 结论'),
            ]),
          ]),
          m('div.steps-list', branchSteps.length === 0 && m('div.empty-state', '当前分支尚无步骤。按 Ctrl+Enter 开始添加。'), branchSteps.map((step, index) => {
            const stepChecks = checks.filter((check) => check.stepId === step.id);
            const incoming = [...(analysis.incoming.get(step.id) ?? new Set<string>())];
            const outgoing = [...(analysis.outgoing.get(step.id) ?? new Set<string>())];
            const introduced = step.introducedConditions.map((id) => conditionById(id)).filter(Boolean);
            const discharged = step.dischargedConditions.map((id) => conditionById(id)).filter(Boolean);
            return m('article.step-card', {
              'data-step': step.id,
              class: step.id === store.selectedStepId ? 'is-selected' : '',
              draggable: true,
              onclick: () => { store.selectStep(step.id); m.redraw(); },
              ondragstart: () => { store.dragStepId = step.id; },
              ondragover: (event: DragEvent) => event.preventDefault(),
              ondrop: (event: DragEvent) => { event.preventDefault(); store.moveStep(store.dragStepId, step.id); store.dragStepId = ''; m.redraw(); },
            }, [
              m('div.step-rail', [
                m('span.drag-handle', { title: '拖动排序' }, '⠿'),
                m('span.step-number', String(index + 1).padStart(2, '0')),
              ]),
              m('div.step-body', [
                m('div.step-head', [
                  m('span.tag', { class: step.type === 'goal' ? 'is-success' : step.type === 'premise' ? 'is-info' : 'is-light' }, typeLabel[step.type]),
                  m('span.rule-chip', step.rule),
                  m('span.step-id', `#${shortId(step.id)}`),
                  outgoing.length > 0 && m('span.obligation-badge', { class: step.type === 'goal' ? 'has-gap' : '', title: '本步之后仍需满足的成立条件' }, `剩余条件 ${outgoing.length}`),
                  stepChecks.length > 0 && m('span.issue-badge', `${stepChecks.length} 项检查`),
                  m('button.step-menu', { onclick: (event: Event) => { event.stopPropagation(); store.removeStep(step.id); m.redraw(); }, title: '删除步骤' }, '×'),
                ]),
                m('div.step-statement', renderRichText(step.statement)),
                (introduced.length > 0 || discharged.length > 0) && m('div.condition-flow', [
                  introduced.map((condition) => m('span.condition-chip.is-introduced', [m('i', '附加 '), renderRichText(condition!.label)])),
                  discharged.map((condition) => m('span.condition-chip.is-discharged', [m('i', '收回 '), renderRichText(condition!.label)])),
                ]),
                m('div.step-footer', [
                  m('span', step.references.length ? `依据：${step.references.map((reference) => {
                    const referenceIndex = indexInBranch(reference);
                    if (referenceIndex >= 0) {
                      const refOpen = [...(analysis.outgoing.get(reference) ?? new Set<string>())];
                      return refOpen.length ? `步骤 ${referenceIndex + 1}（尚带 ${refOpen.length} 条件）` : `步骤 ${referenceIndex + 1}`;
                    }
                    const foreign = document.steps.find((item) => item.id === reference);
                    return foreign ? `跨分支引用 ${shortId(reference)}` : `缺失 ${shortId(reference)}`;
                  }).join('、')}` : '独立前提'),
                  incoming.length > 0 && m('span.incoming-note', `引用时继承 ${incoming.length} 项条件`),
                  step.note && m('span.has-note', '含旁注'),
                  step.counterexample && m('span.has-counterexample', '含反例'),
                  step.alternative && m('span.has-branch', '含替代思路'),
                ]),
              ]),
            ]);
          })),
        ]),
        m('aside.right-rail', [
          selected ? m('section.panel.inspector', [
            m('div.panel-heading', [m('span', '步骤检查器'), m('span.inspector-step', `#${shortId(selected.id)}`)]),
            m('label.field-label', '步骤类型'),
            m('div.select.is-fullwidth', m('select', { value: selected.type, onchange: (event: Event) => store.updateStep({ type: (event.target as HTMLSelectElement).value as ProofStep['type'] }) }, Object.entries(typeLabel).map(([value, label]) => m('option', { value }, label)))),
            m('label.field-label', '推理规则'),
            m('div.select.is-fullwidth', m('select', { value: selected.rule, onchange: (event: Event) => store.updateStep({ rule: (event.target as HTMLSelectElement).value }) }, RULES.map((rule) => m('option', { value: rule }, rule)))),
            m('label.field-label', '命题或推导式'),
            m('textarea.textarea.formula-textarea', {
              value: selected.statement,
              rows: 4,
              onfocus: (event: Event) => { store.lastInput = event.target as HTMLTextAreaElement; },
              oninput: (event: Event) => store.updateStep({ statement: (event.target as HTMLTextAreaElement).value }),
            }),
            m('div.formula-toolbar', snippets.map((snippet) => m('button.formula-key', {
              title: `插入 ${snippet.label}`,
              onclick: (event: Event) => {
                event.preventDefault();
                const input = store.lastInput;
                if (!input) return;
                const start = input.selectionStart ?? input.value.length;
                const end = input.selectionEnd ?? start;
                const next = input.value.slice(0, start) + snippet.value + input.value.slice(end);
                input.value = next;
                if (input instanceof HTMLTextAreaElement) store.updateStep({ statement: next });
                else store.update((document) => { document.goal = next; });
                input.focus();
                const cursor = start + snippet.value.length;
                input.setSelectionRange(cursor, cursor);
                m.redraw();
              },
            }, snippet.label))),
            m('label.field-label', '引用步骤（仅限当前分支，引用时继承其未收回条件）'),
            m('div.reference-list', branchSteps.filter((step) => step.id !== selected.id).map((step) => {
              const refOpen = [...(analysis.outgoing.get(step.id) ?? new Set<string>())];
              return m('label.reference-item', [
                m('input', {
                  type: 'checkbox',
                  checked: selected.references.includes(step.id),
                  onchange: (event: Event) => {
                    const checked = (event.target as HTMLInputElement).checked;
                    const references = checked ? [...selected.references, step.id] : selected.references.filter((id) => id !== step.id);
                    store.updateStep({ references });
                  },
                }),
                m('span', [
                  `步骤 ${indexInBranch(step.id) + 1}`,
                  refOpen.length > 0 && m('em.ref-open', `剩 ${refOpen.length}`),
                ]),
                m('small', step.statement.replace(/\$/g, '')),
              ]);
            })),
            m('div.obligation-panel', [
              m('label.field-label', '成立条件（随引用传递、可被本步收回）'),
              (() => {
                const incoming = [...(analysis.incoming.get(selected.id) ?? new Set<string>())];
                // 本步可收回 = 引用继承的义务 ∪ 本步自己引入的条件（去重，同一步引入即可收回）。
                const dischargeableIds = [...new Set([...incoming, ...selected.introducedConditions])];
                const conditionLabelAt = (id: string) => conditionById(id)?.label ?? id;
                return m('div.obligation-body', [
                  m('div.obligation-group', [
                    m('span.obligation-group-title', incoming.length
                      ? `引用时仍剩 ${incoming.length} 项，勾选即在本步收回：`
                      : '引用步骤没有未收回条件；本步引入的条件也可立即收回：'),
                    ...dischargeableIds.map((id) => m('label.discharge-item', [
                      m('input', {
                        type: 'checkbox',
                        checked: selected.dischargedConditions.includes(id),
                        onchange: () => { store.toggleDischarge(selected.id, id); m.redraw(); },
                      }),
                      m('span', [
                        renderRichText(conditionLabelAt(id)),
                        selected.introducedConditions.includes(id) && !incoming.includes(id) && m('em.self-tag', '本步引入'),
                      ]),
                    ])),
                  ]),
                  m('div.obligation-actions', [
                    m('button.button.is-small.is-white', {
                      onclick: () => {
                        const label = window.prompt('输入本步附加的成立条件（如 $a \\ne 0$、$x \\ge 0$）');
                        if (label === null || !label.trim()) return;
                        store.addCondition(selected.id, label);
                        m.redraw();
                      },
                    }, '＋ 附加条件'),
                    m('button.button.is-small.is-white', {
                      title: '根据公式中的分式、根号等猜测常见条件',
                      onclick: () => {
                        const suggestions = suggestConditions(selected.statement)
                          .filter((label) => !document.conditions.some((condition) => condition.branchId === store.branchId && condition.label === label));
                        if (!suggestions.length) {
                          store.notify('没有从公式中识别到新的常见条件');
                          return;
                        }
                        const picked = window.prompt('识别到的条件（可删改，多个用 || 分隔）', suggestions.join(' || '));
                        if (!picked) return;
                        picked.split('||').map((item) => item.trim()).filter(Boolean).forEach((label) => store.addCondition(selected.id, label));
                        m.redraw();
                      },
                    }, '⚡ 识别分母/根号'),
                  ]),
                  selected.introducedConditions.length > 0 && m('div.obligation-group', [
                    m('span.obligation-group-title', '本步引入：'),
                    ...selected.introducedConditions.map((id) => m('span.introduced-row', [
                      m('span.condition-chip.is-introduced', renderRichText(conditionLabelAt(id))),
                      m('button.link-button', { onclick: () => { store.removeCondition(id); m.redraw(); }, title: '删除该条件' }, '移除'),
                    ])),
                  ]),
                  selected.dischargedConditions.length > 0 && m('div.obligation-group', [
                    m('span.obligation-group-title', '本步收回：'),
                    ...selected.dischargedConditions.map((id) => m('span.condition-chip.is-discharged', renderRichText(conditionLabelAt(id)))),
                  ]),
                ]);
              })(),
            ]),
            m('div.field-grid', [
              m('div', [m('label.field-label', '旁注'), m('textarea.textarea.is-small', { rows: 2, value: selected.note, placeholder: '记录思路或条件', oninput: (event: Event) => store.updateStep({ note: (event.target as HTMLTextAreaElement).value }) })]),
              m('div', [m('label.field-label', '反例 / 边界情况'), m('textarea.textarea.is-small', { rows: 2, value: selected.counterexample, placeholder: '尝试寻找反例', oninput: (event: Event) => store.updateStep({ counterexample: (event.target as HTMLTextAreaElement).value }) })]),
              m('div', [m('label.field-label', '替代分支'), m('textarea.textarea.is-small', { rows: 2, value: selected.alternative, placeholder: '另一种可行推导', oninput: (event: Event) => store.updateStep({ alternative: (event.target as HTMLTextAreaElement).value }) })]),
            ]),
            m('button.button.is-small.is-white.is-fullwidth.add-symbol', {
              onclick: () => {
                const symbol = window.prompt('输入符号名称');
                if (!symbol) return;
                const meaning = window.prompt('输入符号含义') ?? '待补充';
                store.update((document) => { document.symbols[symbol] = meaning; });
                m.redraw();
              },
            }, '＋ 登记新符号'),
          ]) : m('section.panel.inspector', m('p.empty-copy', '选择一个步骤进行检查。')),
          m('section.panel.symbol-panel', [
            m('div.panel-heading', [m('span', '符号表'), m('span.count-badge', Object.keys(document.symbols).length)]),
            m('div.symbol-list', Object.entries(document.symbols).map(([symbol, meaning]) => m('div.symbol-row', [
              m('code', symbol),
              m('input.symbol-meaning', { value: meaning, oninput: (event: Event) => store.update((item) => { item.symbols[symbol] = (event.target as HTMLInputElement).value; }) }),
            ]))),
          ]),
          m('section.panel.ledger-panel', [
            m('div.panel-heading', [
              m('span', `条件台账 · ${store.branch.name}`),
              m('span.count-badge', { class: analysis.openConditions.length ? 'has-gap' : '' }, `${analysis.openConditions.length} 未收回`),
            ]),
            branchConditions(document, store.branchId).length === 0
              ? m('p.empty-copy', '本分支还没有附加成立条件。在步骤检查器中为某一步“附加条件”（如分母非零、根号内非负）。')
              : m('div.ledger-list', branchConditions(document, store.branchId).map((condition) => {
                const open = analysis.openConditions.includes(condition.id);
                const onGoal = analysis.goalOpenConditions.includes(condition.id);
                const introducedIndex = indexInBranch(condition.introducedAt) + 1;
                const dischargeSteps = branchSteps.filter((step) => step.dischargedConditions.includes(condition.id));
                return m('div.ledger-row', { class: open ? 'is-open' : 'is-closed' }, [
                  m('span.ledger-status', { class: onGoal ? 'on-goal' : open ? 'open' : 'closed', title: open ? '未收回' : '已收回' }, onGoal ? '缺口' : open ? '传递中' : '已收回'),
                  m('div.ledger-copy', [
                    m('strong', renderRichText(condition.label)),
                    m('small', [
                      `引入于步骤 ${introducedIndex > 0 ? introducedIndex : '?'}`,
                      dischargeSteps.length
                        ? `；收回于 ${dischargeSteps.map((step) => `步骤 ${indexInBranch(step.id) + 1}`).join('、')}`
                        : open ? '；尚无步骤收回' : '',
                    ]),
                  ]),
                  m('button.link-button', {
                    title: '删除该条件及其全部收回记录',
                    onclick: () => { store.removeCondition(condition.id); m.redraw(); },
                  }, '×'),
                ]);
              })),
          ]),
          m('section.panel.checks-panel', [
            m('div.panel-heading', [m('span', '检查结果'), m('span.count-badge', checks.length)]),
            m('div.check-list', checks.map((check) => m('button.check-item', {
              class: check.severity,
              onclick: () => { if (check.stepId) { store.selectStep(check.stepId); globalThis.document.querySelector(`[data-step="${check.stepId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); } m.redraw(); },
            }, [
              m('span.check-icon', check.severity === 'error' ? '×' : check.severity === 'warning' ? '!' : '✓'),
              m('span', [m('strong', check.title), m('small', check.detail)]),
            ]))),
          ]),
          m('section.shortcut-card', [
            m('span.eyebrow', 'KEYBOARD'),
            m('p', [m('kbd', 'Ctrl'), ' + ', m('kbd', 'Enter'), ' 新步骤']),
            m('p', [m('kbd', 'Alt'), ' + ', m('kbd', '↑↓'), ' 切换步骤']),
            m('p', [m('kbd', 'Ctrl'), ' + ', m('kbd', 'Z'), ' 撤销']),
          ]),
        ]),
      ]),
      selectedVersion && m('div.diff-overlay', { onclick: () => { store.compareVersionId = ''; m.redraw(); } }, [
        m('section.diff-dialog', { onclick: (event: Event) => event.stopPropagation() }, [
          m('header.diff-head', [
            m('div', [m('span.eyebrow', 'VERSION DIFF'), m('h2', `${selectedVersion.name} ↔ 当前（${store.branch.name}）`)]),
            m('button.delete', { onclick: () => { store.compareVersionId = ''; m.redraw(); } }),
          ]),
          m('div.diff-summary', [
            m('span.tag.is-danger', `删除 ${diff.filter((item) => item.kind === 'removed').length}`),
            m('span.tag.is-success', `新增 ${diff.filter((item) => item.kind === 'added').length}`),
            m('span.tag.is-warning', `修改 ${diff.filter((item) => item.kind === 'changed').length}`),
            m('span.tag.is-light', `未变 ${diff.filter((item) => item.kind === 'same').length}`),
          ]),
          m('div.diff-table', [
            m('div.diff-row.diff-header', [m('span', '位置'), m('span', '旧版本'), m('span', '当前版本')]),
            ...diff.map((item) => m('div.diff-row', { class: `is-${item.kind}` }, [
              m('span.diff-label', item.label),
              m('span', item.before || '—'),
              m('span', item.after || '—'),
            ])),
          ]),
        ]),
      ]),
      store.toast && m('div.toast-notification', store.toast),
    ]);
  }
}
