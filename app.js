// ============================================================
//  APP.JS — Main controller / wiring
// ============================================================

let currentMode    = 'c';    // 'c' | 'tac'
let stepModeOn     = false;
let stepIndex      = 0;
let allPasses      = [];

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

  // Show loading
  showLoading();

  // Simulate async for smooth UX
  setTimeout(() => {
    try {
      // 1. Parse
      const instrs = parseInput(src, currentMode);

      // 2. Build CFG
      const blocks = buildCFG(instrs);

      // 3. Run optimization passes
      const { passes, optimized } = runAllPasses(instrs);
      allPasses = passes;

      // 4. Render all tabs
      renderTAC(instrs);
      renderCFG(blocks);
      renderPipeline(passes, stepModeOn);
      renderOutput(optimized);
      renderMetrics(instrs, passes, optimized);

      // 5. Show results
      document.getElementById('welcomeState').style.display  = 'none';
      document.getElementById('resultsInner').style.display  = 'flex';
      document.getElementById('resultsInner').style.flexDirection = 'column';

      // Switch to IR tab by default
      switchTab('ir');

      // If step mode, show overlay
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
  ri.style.display = 'flex';
  ri.style.flexDirection = 'column';
  ri.innerHTML = `
    <div class="tabs-bar" id="tabsBar">
      <button class="tab active" data-tab="ir" onclick="switchTab('ir')">📋 IR / TAC</button>
      <button class="tab" data-tab="cfg" onclick="switchTab('cfg')">🔀 CFG</button>
      <button class="tab" data-tab="pipeline" onclick="switchTab('pipeline')">⚙️ Pipeline</button>
      <button class="tab" data-tab="output" onclick="switchTab('output')">✅ Output</button>
      <button class="tab" data-tab="metrics" onclick="switchTab('metrics')">📊 Metrics</button>
    </div>
    <div class="tab-content active" id="tab-ir">
      <div class="section-label">Generated Three-Address Code (TAC)</div>
      <div class="tac-grid" id="tacGrid">
        <div style="display:flex;gap:.35rem;padding:1.5rem;justify-content:center">
          <span style="width:8px;height:8px;border-radius:50%;background:var(--purple);animation:pulse 1.2s ease-in-out infinite;display:block"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:var(--cyan);animation:pulse 1.2s ease-in-out infinite .2s;display:block"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:var(--green);animation:pulse 1.2s ease-in-out infinite .4s;display:block"></span>
        </div>
      </div>
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
        <div>
          <div class="section-label">Optimized TAC</div>
          <div class="code-block" id="optimizedTAC"></div>
        </div>
        <div>
          <div class="section-label">Reconstructed C-like Code</div>
          <div class="code-block" id="reconstructedC"></div>
        </div>
      </div>
    </div>
    <div class="tab-content" id="tab-metrics">
      <div class="section-label">Performance Comparison Dashboard</div>
      <div class="metrics-grid" id="metricsGrid"></div>
      <div class="section-label" style="margin-top:2rem">Optimization Details</div>
      <div class="opt-details" id="optDetails"></div>
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
window.switchMode    = switchMode;
window.loadSample    = loadSample;
window.clearEditor   = clearEditor;
window.toggleStepMode = toggleStepMode;
window.updateGutter  = updateGutter;
window.syncGutterScroll = syncGutterScroll;
window.runOptimizer  = runOptimizer;
window.stepForward   = stepForward;
window.stepBack      = stepBack;
window.openStepMode  = openStepMode;
window.closeStepMode = closeStepMode;
window.stepModalNext = stepModalNext;
window.stepModalBack = stepModalBack;
