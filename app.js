// ============================================================
//  APP.JS — Main controller / wiring
// ============================================================

let currentMode       = 'c';    // 'c' | 'tac'
let guidedMode        = false;
let stepIndex         = 0;
let allPasses         = [];
let execResults       = { original: null, optimized: null };
let metricsComparison = null;
let lvaBlocks         = null;
let currentLevel      = 'O2';   // 'O0' | 'O1' | 'O2' | 'O3'
let showDominators    = false;

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

// ── Guided mode toggle ──────────────────────────────────────────
function toggleGuidedMode() {
  guidedMode = !guidedMode;
  document.getElementById('stepToggle').classList.toggle('on', guidedMode);
}

// ── Optimization level selector ───────────────────────────────
function setOptLevel(level) {
  currentLevel = level;
  // Update pill active state
  ['O0', 'O1', 'O2', 'O3'].forEach(lv => {
    const btn = document.getElementById(`lvl-${lv}`);
    if (btn) btn.classList.toggle('active', lv === level);
  });
  // Re-run optimizer immediately if results are already showing
  const resultsInner = document.getElementById('resultsInner');
  if (resultsInner && resultsInner.style.display !== 'none') {
    runOptimizer();
  }
}

// ── Dominator UI toggle ───────────────────────────────────────
function toggleDominators() {
  showDominators = !showDominators;
  const toggleBtn = document.getElementById('domToggle');
  if (toggleBtn) {
    toggleBtn.classList.toggle('on', showDominators);
  }
  if (lvaBlocks) {
    // Re-render CFG if already built
    window.renderCFG(lvaBlocks);
  }
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

      // 2. Build CFG + Live Variable Analysis + Dominators
      const blocks = buildCFG(instrs);
      runLiveVariableAnalysis(blocks);
      computeDominators(blocks);
      lvaBlocks = blocks;

      // 3. Run optimization passes
      const { passes, optimized } = runAllPasses(instrs, currentLevel);
      allPasses = passes;

      // 4. Execute both original and optimized TAC
      execResults.original  = executeTAC(instrs);
      execResults.optimized = executeTAC(optimized);

      // 5. Compute metrics comparison
      metricsComparison = compareMetrics(instrs, optimized);

      // 6. Render all tabs
      renderTAC(instrs);
      renderCFG(blocks);
      renderPipeline(passes, guidedMode);
      renderOutput(optimized);
      renderMetrics(metricsComparison, passes);
      renderExecution(execResults.original, execResults.optimized);
      updateCompareView();

      // 6. Show results
      document.getElementById('welcomeState').style.display  = 'none';
      document.getElementById('resultsInner').style.display  = 'flex';
      document.getElementById('resultsInner').style.flexDirection = 'column';

      // Switch to IR tab by default
      switchTab('ir');

      // If guided mode, show overlay
      if (guidedMode) openGuidedMode();

    } catch (e) {
      console.error(e);
      alert('Parse error: ' + e.message);
    }
  }, 80);
}

function updateCompareView() {
  const leftSel = document.getElementById('compareLeftSel');
  const rightSel = document.getElementById('compareRightSel');
  if (!leftSel || !rightSel) return;
  
  const leftLvl = leftSel.value;
  const rightLvl = rightSel.value;
  
  document.getElementById('compareLeftLabel').textContent = leftLvl;
  document.getElementById('compareRightLabel').textContent = rightLvl;
  
  const src = document.getElementById('codeEditor').value.trim();
  if (!src) return;
  
  try {
    const instrs = window.parseInput(src, currentMode);
    const leftOpt = window.runAllPasses(instrs, leftLvl);
    const rightOpt = window.runAllPasses(instrs, rightLvl);
    window.renderCompareTab(leftOpt.optimized, rightOpt.optimized);
  } catch(e) {
    // Ignore parse errors as they'll be caught by main loop
  }
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
      <button class="tab" data-tab="compare" onclick="switchTab('compare')">⚖️ Compare</button>
      <button class="tab" data-tab="output" onclick="switchTab('output')">✅ Output</button>
      <button class="tab" data-tab="metrics" onclick="switchTab('metrics')">📊 Metrics</button>
      <button class="tab" data-tab="execute" onclick="switchTab('execute')">▶ Execute</button>
      <button class="tab" data-tab="about" onclick="switchTab('about')">ℹ️ About</button>
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
    </div>
    <div class="tab-content" id="tab-execute"></div>
    
    <div class="tab-content" id="tab-about" style="padding:3rem 2.5rem; text-align:center;">
      <div style="max-width:800px; margin:0 auto; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:16px; padding:3rem; backdrop-filter:blur(10px); box-shadow:0 10px 30px rgba(0,0,0,0.2);">
        <h2 style="font-size:2rem; font-weight:800; background:linear-gradient(90deg, #bb86fc, #03dac6); -webkit-background-clip:text; -webkit-text-fill-color:transparent; margin-bottom:1rem; letter-spacing:-0.03em;">Code Optimization Engine</h2>
        <p style="color:var(--text-secondary); font-size:1.1rem; line-height:1.7; margin-bottom:2.5rem; max-width:600px; margin-left:auto; margin-right:auto;">
          A high-performance compiler optimization testbed featuring tiered analytics, data flow graph generation, and dynamic live variable tracking.
        </p>

        <div style="display:flex; justify-content:center; gap:4rem; text-align:left;">
          <div>
            <div style="font-weight:700; color:var(--cyan); margin-bottom:1.5rem; letter-spacing:0.06em; text-transform:uppercase; font-size:0.8rem; border-bottom:1px solid rgba(3,218,198,0.2); padding-bottom:.5rem;">Key Capabilities</div>
            <ul style="list-style:none; padding:0; display:flex; flex-direction:column; gap:1rem; color:var(--text-primary); font-size:.95rem;">
              <li style="display:flex; align-items:center; gap:.75rem; transition:transform 0.2s;"><span style="color:var(--green); font-size:1.2rem;">⚡</span> Advanced TAC Generation</li>
              <li style="display:flex; align-items:center; gap:.75rem; transition:transform 0.2s;"><span style="color:var(--green); font-size:1.2rem;">🔀</span> Control Flow Graph Matrix</li>
              <li style="display:flex; align-items:center; gap:.75rem; transition:transform 0.2s;"><span style="color:var(--green); font-size:1.2rem;">⏱️</span> Live Variable Analysis (LVA)</li>
              <li style="display:flex; align-items:center; gap:.75rem; transition:transform 0.2s;"><span style="color:var(--green); font-size:1.2rem;">⚙️</span> Multi-Tier Pipeline (O0–O3)</li>
              <li style="display:flex; align-items:center; gap:.75rem; transition:transform 0.2s;"><span style="color:var(--green); font-size:1.2rem;">▶️</span> Robust Execution Engine</li>
              <li style="display:flex; align-items:center; gap:.75rem; transition:transform 0.2s;"><span style="color:var(--green); font-size:1.2rem;">📊</span> Side-by-Side Diagnostics</li>
              <li style="display:flex; align-items:center; gap:.75rem; transition:transform 0.2s;"><span style="color:var(--green); font-size:1.2rem;">🎓</span> Interactive Guided Walkthrough</li>
            </ul>
          </div>
          <div>
            <div style="font-weight:700; color:var(--purple); margin-bottom:1.5rem; letter-spacing:0.06em; text-transform:uppercase; font-size:0.8rem; border-bottom:1px solid rgba(187,134,252,0.2); padding-bottom:.5rem;">Tech Stack</div>
            <div style="display:flex; flex-direction:column; gap:1rem;">
              <div style="display:flex; align-items:center; gap:.8rem; background:rgba(255,255,255,0.03); padding:.5rem 1rem; border-radius:8px; border:1px solid rgba(255,255,255,0.08);">
                <span style="font-size:1.2rem;">🌐</span> <span style="font-weight:600; color:#e34f26;">HTML5</span>
              </div>
              <div style="display:flex; align-items:center; gap:.8rem; background:rgba(255,255,255,0.03); padding:.5rem 1rem; border-radius:8px; border:1px solid rgba(255,255,255,0.08);">
                <span style="font-size:1.2rem;">🎨</span> <span style="font-weight:600; color:#1572B6;">CSS3</span> (Glassmorphism)
              </div>
              <div style="display:flex; align-items:center; gap:.8rem; background:rgba(255,255,255,0.03); padding:.5rem 1rem; border-radius:8px; border:1px solid rgba(255,255,255,0.08);">
                <span style="font-size:1.2rem;">⚡</span> <span style="font-weight:600; color:#F7DF1E;">Vanilla JavaScript</span> (ES6)
              </div>
            </div>
          </div>
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

// ── GUIDED OVERLAY MODE ─────────────────────────────────────────
let _overlayStep = 0;

function openGuidedMode() {
  _overlayStep = 0;
  renderGuidedStep(_overlayStep);
  document.getElementById('guided-panel').style.display = 'flex';
}

function closeGuidedMode() {
  document.getElementById('guided-panel').style.display = 'none';
}

function guidedModalNext() {
  if (_overlayStep < allPasses.length - 1) { _overlayStep++; renderGuidedStep(_overlayStep); }
  else closeGuidedMode();
}

function guidedModalBack() {
  if (_overlayStep > 0) { _overlayStep--; renderGuidedStep(_overlayStep); }
}

function renderGuidedStep(idx) {
  const pass = allPasses[idx];
  if (!pass) return;
  document.getElementById('stepModalTitle').textContent = `${passIcon(pass.name)} ${pass.name}`;
  document.getElementById('stepModalCounter').textContent = `Step ${idx + 1} of ${allPasses.length}`;
  document.getElementById('stepModalBackBtn').disabled = idx === 0;
  document.getElementById('stepModalNextBtn').textContent = idx === allPasses.length - 1 ? '✓ Done' : '[ Next ]';

  let html = `<p class="pass-description" style="margin-bottom:1rem;font-size:0.9rem;color:var(--text-secondary)">${pass.description}</p>`;
  if (pass.changes.length) {
    html += `<div style="display:flex; flex-direction:column; gap:1rem; background:rgba(0,0,0,0.15); padding:1rem; border-radius:6px;">`;
    pass.changes.forEach(c => {
      html += `
        <div class="opt-change" style="margin-top:0">
          <div><span class="mono" style="font-size:0.85rem;color:var(--cyan)">${escHtml(c.before)}</span> <span style="opacity:.6">→</span> <span class="mono" style="font-size:0.85rem;color:var(--green)">${escHtml(c.after)}</span></div>
          ${c.reason ? `<div class="opt-reason">↳ ${escHtml(c.reason)}</div>` : ''}
        </div>`;
    });
    html += `</div>`;
  } else {
    html += `<div class="pass-no-change" style="padding:1.5rem; text-align:center; background:rgba(255,255,255,0.05); border-radius:6px;">✓ No optimizations applicable in this pass.</div>`;
  }
  document.getElementById('stepModalBody').innerHTML = html;
}

function passIcon(name) {
  const icons = { 'Constant Folding':'🔢','Constant Propagation':'🔄','Algebraic Simplification':'✏️','Copy Propagation':'📋','Common Subexpression Elimination':'♻️','Dead Code Elimination':'🗑️' };
  return icons[name] || '⚙️';
}

// Expose globals
window.switchMode        = switchMode;
window.loadSample        = loadSample;
window.clearEditor       = clearEditor;
window.toggleGuidedMode  = toggleGuidedMode;
window.setOptLevel       = setOptLevel;
window.toggleDominators  = toggleDominators;
window.updateGutter      = updateGutter;
window.syncGutterScroll  = syncGutterScroll;
window.runOptimizer      = runOptimizer;
window.stepForward       = stepForward;
window.stepBack          = stepBack;
window.openGuidedMode    = openGuidedMode;
window.closeGuidedMode   = closeGuidedMode;
window.guidedModalNext   = guidedModalNext;
window.guidedModalBack   = guidedModalBack;
window.updateCompareView = updateCompareView;
window.execResults       = execResults;
window.metricsComparison = metricsComparison;
window.lvaBlocks         = lvaBlocks;
window.showDominators    = showDominators;
