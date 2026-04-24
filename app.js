// ============================================================
//  APP.JS — Main controller / wiring
// ============================================================

let currentMode    = 'c';    // 'c' | 'tac'
let stepModeOn     = false;
let stepIndex      = 0;
let allPasses      = [];
let currentOLevel  = 2;      // 0 | 1 | 2
let lastInstrs     = [];     // for data-flow re-use

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadSample('simple');
  updateGutter();
});

// ── Mode switching ────────────────────────────────────────────
function switchMode(mode) {
  currentMode = mode;
  document.getElementById('modeCBtn').classList.toggle('active', mode === 'c');
  document.getElementById('modeTACBtn').classList.toggle('active', mode === 'tac');
  const hint = document.getElementById('modeHint');
  if (mode === 'tac') {
    hint.innerHTML = '<strong>TAC syntax:</strong> result = arg1 op arg2 · label: · goto L · if a &gt; b goto L · return v';
  } else {
    hint.innerHTML = '<strong>Supported syntax:</strong> assignments, arithmetic (+−×÷%), if-goto, labels, function-like structure.';
  }
  loadSample('simple');
}

// ── Sample loading ────────────────────────────────────────────
function loadSample(key) {
  const src = (SAMPLES[currentMode] || SAMPLES.c)[key];
  if (!src) return;
  document.getElementById('codeEditor').value = src.trim();
  updateGutter();
}

// ── Clear editor ──────────────────────────────────────────────
function clearEditor() {
  document.getElementById('codeEditor').value = '';
  updateGutter();
}

// ── O-Level selector ──────────────────────────────────────────
const oLevelDescs = {
  0: 'No optimization (raw IR)',
  1: 'Basic: Const Folding + Algebraic',
  2: 'Full pipeline + LICM'
};
function setOLevel(n) {
  currentOLevel = n;
  [0,1,2].forEach(i => {
    document.getElementById(`ol-${i}`)?.classList.toggle('active', i === n);
  });
  const desc = document.getElementById('oLevelDesc');
  if (desc) desc.textContent = oLevelDescs[n];
}

// ── Step mode toggle ──────────────────────────────────────────
function toggleStepMode() {
  stepModeOn = !stepModeOn;
  document.getElementById('stepToggle').classList.toggle('on', stepModeOn);
}

// ── Gutter update ─────────────────────────────────────────────
function updateGutter() {
  const ta     = document.getElementById('codeEditor');
  const gutter = document.getElementById('editorGutter');
  const lines  = ta.value.split('\n').length;
  let html = '';
  for (let i = 1; i <= lines; i++) html += `<span>${i}</span>`;
  gutter.innerHTML = html;
}

function syncGutterScroll() {
  const ta     = document.getElementById('codeEditor');
  const gutter = document.getElementById('editorGutter');
  gutter.scrollTop = ta.scrollTop;
}

// ── MAIN OPTIMIZER RUNNER ─────────────────────────────────────
function runOptimizer() {
  const src = document.getElementById('codeEditor').value.trim();
  if (!src) { alert('Please enter some code first.'); return; }
  showLoading();
  setTimeout(() => {
    try {
      const instrs = parseInput(src, currentMode);
      lastInstrs = instrs;

      // CFG before
      const blocksBefore = buildCFG(instrs);

      // O-level passes
      const { passes, optimized, licmResult } = runPassesAtLevel(instrs, currentOLevel, blocksBefore);
      allPasses = passes;

      // CFG after
      const blocksAfter = buildCFG(optimized);

      // Liveness + variable stats
      const { instrLiveIn, instrLiveOut } = computeLiveness(instrs, blocksBefore);
      const varStats = computeVariableStats(instrs);

      // Function table + execution simulation
      const funcTable  = parseFunctionTable(instrs);
      const hasFuncs   = Object.keys(funcTable).length > 0;
      const { trace: execTrace, finalValue } = hasFuncs
        ? simulateExecution(funcTable)
        : { trace: [], finalValue: null };

      // Render all tabs
      renderTAC(instrs);
      renderCFG(blocksBefore);
      renderPipeline(passes, stepModeOn);
      renderOutput(optimized);
      renderMetrics(instrs, passes, optimized);
      renderDataFlow(instrs, instrLiveIn, instrLiveOut);
      renderInsights(varStats, instrLiveOut);
      renderReport(instrs, passes, optimized, blocksBefore.length, blocksAfter.length, currentOLevel);

      // Execution panels (only if multi-function TAC)
      renderFunctionsView(funcTable);
      if (execTrace.length) {
        initExecTrace(execTrace);
        renderReturnValues(execTrace);
      } else {
        const ep = document.getElementById('execTracePanel');
        if (ep) ep.innerHTML = '<div class="pass-no-change">Use <strong>Multi-Function</strong> TAC sample to see execution simulation.</div>';
        renderCallStack([]);
        const rp = document.getElementById('retvalPanel');
        if (rp) rp.innerHTML = '<div class="pass-no-change">No function calls detected.</div>';
      }

      switchTab('ir');
      if (stepModeOn) openStepMode();
    } catch (e) {
      console.error(e);
      alert('Parse error: ' + e.message);
    }
  }, 80);
}

function showLoading() {
  document.getElementById('welcomeState').style.display = 'none';
  const ri = document.getElementById('resultsInner');
  ri.style.display = 'flex'; ri.style.flexDirection = 'column';
  ri.innerHTML = `
    <div class="tabs-bar" id="tabsBar">
      <button class="tab active" data-tab="ir"       onclick="switchTab('ir')">📋 IR / TAC</button>
      <button class="tab"        data-tab="cfg"      onclick="switchTab('cfg')">🔀 CFG</button>
      <button class="tab"        data-tab="pipeline" onclick="switchTab('pipeline')">⚙️ Pipeline</button>
      <button class="tab"        data-tab="output"   onclick="switchTab('output')">✅ Output</button>
      <button class="tab"        data-tab="metrics"  onclick="switchTab('metrics')">📊 Metrics</button>
      <button class="tab"        data-tab="dataflow" onclick="switchTab('dataflow')">🔬 Data Flow</button>
      <button class="tab"        data-tab="report"   onclick="switchTab('report')">📈 Report</button>
      <button class="tab"        data-tab="functions" onclick="switchTab('functions')">🔧 Functions</button>
      <button class="tab"        data-tab="execution" onclick="switchTab('execution')">▶ Execution</button>
    </div>

    <div class="tab-content active" id="tab-ir">
      <div class="section-label">Generated Three-Address Code (TAC)</div>
      <div class="tac-grid" id="tacGrid"></div>
    </div>
    <div class="tab-content" id="tab-cfg">
      <div class="section-label">Control Flow Graph</div>
      <div class="cfg-container" id="cfgContainer"></div>
    </div>
    <div class="tab-content" id="tab-pipeline">
      <div class="section-label">Optimization Pipeline — Step by Step</div>
      <div class="pipeline-controls" id="pipelineControls" style="display:none">
        <button class="btn btn-secondary btn-sm" onclick="stepBack()">◀ Prev</button>
        <span class="step-indicator" id="stepIndicator">Step 1 / 6</span>
        <button class="btn btn-primary btn-sm" onclick="stepForward()">Next ▶</button>
      </div>
      <div class="pipeline-passes" id="pipelinePasses"></div>
    </div>
    <div class="tab-content" id="tab-output">
      <div class="output-split">
        <div><div class="section-label">Optimized TAC</div><div class="code-block" id="optimizedTAC"></div></div>
        <div><div class="section-label">Reconstructed C-like Code</div><div class="code-block" id="reconstructedC"></div></div>
      </div>
    </div>
    <div class="tab-content" id="tab-metrics">
      <div class="section-label">Performance Comparison Dashboard</div>
      <div class="metrics-grid" id="metricsGrid"></div>
      <div class="section-label" style="margin-top:2rem">Optimization Details</div>
      <div class="opt-details" id="optDetails"></div>
    </div>
    <div class="tab-content" id="tab-dataflow">
      <div class="section-label">Live Variable Analysis — Backward Dataflow</div>
      <div id="dfTable"></div>
      <div class="section-label" style="margin-top:2rem">Variable Insight Panel</div>
      <div id="insightTable"></div>
    </div>
    <div class="tab-content" id="tab-report">
      <div id="reportContent"></div>
    </div>
    <div class="tab-content" id="tab-functions">
      <div class="section-label">Function Definitions (TAC per function)</div>
      <div id="funcViewContainer"></div>
    </div>
    <div class="tab-content" id="tab-execution">
      <div class="exec-layout">
        <div class="exec-left">
          <div class="section-label">Execution Trace</div>
          <div class="exec-controls">
            <button class="btn btn-secondary btn-sm" id="execPrevBtn" onclick="execStepBack()">◀ Prev</button>
            <span class="step-indicator" id="execStepCounter">Step 1 / 1</span>
            <button class="btn btn-primary btn-sm" id="execNextBtn" onclick="execStepForward()">Next ▶</button>
            <button class="btn btn-ghost btn-sm" onclick="execStepFirst()">⇤ First</button>
            <button class="btn btn-ghost btn-sm" onclick="execStepLast()">Last ⇥</button>
          </div>
          <div class="exec-trace-wrap" id="execTracePanel"></div>
          <div class="section-label" style="margin-top:1.25rem">Return Values</div>
          <div id="retvalPanel"></div>
        </div>
        <div class="exec-right">
          <div class="section-label">Call Stack</div>
          <div id="callStackPanel"></div>
        </div>
      </div>
    </div>`;
}


// ── STEP MODE (inline) ────────────────────────────────────────
let _stepIdx = 0;

function stepForward() {
  _stepIdx = Math.min(_stepIdx + 1, allPasses.length - 1);
  highlightStep(_stepIdx);
}

function stepBack() {
  _stepIdx = Math.max(_stepIdx - 1, 0);
  highlightStep(_stepIdx);
}

function highlightStep(idx) {
  document.getElementById('stepIndicator').textContent = `Step ${idx + 1} / ${allPasses.length}`;
  // Expand only current pass, collapse others
  allPasses.forEach((_, pi) => {
    const body = document.getElementById(`pass-body-${pi}`);
    const tog  = document.getElementById(`pass-toggle-${pi}`);
    if (!body) return;
    const open = pi === idx;
    body.classList.toggle('open', open);
    if (tog) tog.classList.toggle('open', open);
    const card = document.getElementById(`pass-card-${pi}`);
    if (card) card.style.opacity = open ? '1' : pi < idx ? '.6' : '.35';
  });
  switchTab('pipeline');
}

// ── STEP OVERLAY MODE ─────────────────────────────────────────
let _overlayStep = 0;

function openStepMode() {
  _overlayStep = 0;
  renderOverlayStep(_overlayStep);
  document.getElementById('stepOverlay').style.display = 'flex';
}

function closeStepMode() {
  document.getElementById('stepOverlay').style.display = 'none';
}

function stepModalNext() {
  if (_overlayStep < allPasses.length - 1) { _overlayStep++; renderOverlayStep(_overlayStep); }
  else closeStepMode();
}

function stepModalBack() {
  if (_overlayStep > 0) { _overlayStep--; renderOverlayStep(_overlayStep); }
}

function renderOverlayStep(idx) {
  const pass = allPasses[idx];
  if (!pass) return;
  document.getElementById('stepModalTitle').textContent = `${passIcon(pass.name)} ${pass.name}`;
  document.getElementById('stepModalCounter').textContent = `${idx + 1} / ${allPasses.length}`;
  document.getElementById('stepModalBackBtn').disabled = idx === 0;
  document.getElementById('stepModalNextBtn').textContent = idx === allPasses.length - 1 ? '✓ Done' : 'Next ▶';

  let html = `<p class="pass-description" style="margin-bottom:1rem">${pass.description}</p>`;
  if (pass.changes.length) {
    html += `<table class="diff-table"><thead><tr><th>Before</th><th>After</th><th>Note</th></tr></thead><tbody>`;
    pass.changes.forEach(c => {
      const rowCls = c.type === 'removed' ? 'diff-row-removed' : 'diff-row-changed';
      const beforeTxt = c.type === 'removed' ? `<span class="diff-strike">${escHtml(c.before)}</span>` : escHtml(c.before);
      html += `<tr class="${rowCls}"><td>${beforeTxt}</td><td>${escHtml(c.after)}</td><td>${escHtml(c.note || '')}</td></tr>`;
    });
    html += `</tbody></table>`;
  } else {
    html += `<div class="pass-no-change">✓ No optimizations applicable in this pass.</div>`;
  }
  document.getElementById('stepModalBody').innerHTML = html;
}

function passIcon(name) {
  const icons = { 'Constant Folding':'🔢','Constant Propagation':'🔄','Algebraic Simplification':'✏️','Copy Propagation':'📋','Common Subexpression Elimination':'♻️','Dead Code Elimination':'🗑️' };
  return icons[name] || '⚙️';
}

// Expose globals
window.switchMode       = switchMode;
window.loadSample       = loadSample;
window.clearEditor      = clearEditor;
window.toggleStepMode   = toggleStepMode;
window.updateGutter     = updateGutter;
window.syncGutterScroll = syncGutterScroll;
window.runOptimizer     = runOptimizer;
window.stepForward      = stepForward;
window.stepBack         = stepBack;
window.openStepMode     = openStepMode;
window.closeStepMode    = closeStepMode;
window.stepModalNext    = stepModalNext;
window.stepModalBack    = stepModalBack;
window.setOLevel        = setOLevel;
window.execStepForward  = execStepForward;
window.execStepBack     = execStepBack;
window.execStepFirst    = execStepFirst;
window.execStepLast     = execStepLast;
