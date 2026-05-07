// ============================================================
//  APP.JS — Unified Controller
// ============================================================

let currentMode = 'c';
let currentOLevel = 3;
let allPasses = [];
let stepModeOn = false;

document.addEventListener('DOMContentLoaded', () => {
  loadSample('simple');
  updateGutter();
});

function switchMode(mode) {
  currentMode = mode;
  document.getElementById('modeCBtn').classList.toggle('active', mode === 'c');
  document.getElementById('modeTACBtn').classList.toggle('active', mode === 'tac');
  loadSample('simple');
}

function loadSample(key) {
  const samplesObj = window.SAMPLES || SAMPLES;
  if (!samplesObj) {
    console.error('SAMPLES object not found');
    return;
  }
  const modeSamples = samplesObj[currentMode] || samplesObj.c;
  const src = modeSamples[key];
  if (!src) {
    console.warn(`Sample "${key}" not found for mode "${currentMode}"`);
    return;
  }
  const editor = document.getElementById('codeEditor');
  if (editor) {
    editor.value = src.trim();
    updateGutter();
  }
}

function clearEditor() {
  document.getElementById('codeEditor').value = '';
  updateGutter();
}

function setOLevel(n) {
  currentOLevel = n;
  [0,1,2,3].forEach(i => {
    const btn = document.getElementById(`ol-${i}`);
    if (btn) btn.classList.toggle('active', i === n);
  });
  const desc = document.getElementById('oLevelDesc');
  const txt = {0:'O0: No optimization', 1:'O1: Basic folding', 2:'O2: Full + LICM', 3:'O3: Aggressive + LVA'};
  if (desc) desc.textContent = txt[n] || 'O3';
}

function toggleStepMode() {
  stepModeOn = !stepModeOn;
  document.getElementById('stepToggle').classList.toggle('on', stepModeOn);
}

function runOptimizer() {
  const src = document.getElementById('codeEditor').value.trim();
  if (!src) return;

  try {
    const instrs = window.parseInput(src, currentMode);
    const blocksBefore = window.buildCFG(instrs);
    window.computeDominators(blocksBefore);
    
    // Optimization
    const { passes, optimized } = window.runPassesAtLevel(instrs, currentOLevel, blocksBefore);
    allPasses = passes;
    const blocksAfter = window.buildCFG(optimized);

    // Data Flow
    const { instrLiveIn, instrLiveOut } = window.computeLiveness(optimized, blocksAfter); // Run on optimized
    const varStats = window.computeVariableStats(optimized);

    // Execution Simulation (RUN ON OPTIMIZED)
    const funcTable = window.parseFunctionTable(optimized);
    const { trace: execTrace } = window.executeTAC(funcTable);

    // Show Results UI
    document.getElementById('welcomeState').style.display = 'none';
    document.getElementById('resultsInner').style.display = 'flex';

    // Rendering
    window.renderTAC(optimized); // Show optimized by default in IR tab? No, usually keep original.
    // Actually, let's show original in IR tab, but show optimized in OUTPUT and COMPARE.
    window.renderTAC(instrs); 
    
    window.renderCFG(blocksAfter);
    window.renderPipeline(passes);
    window.renderDataFlow(optimized, instrLiveIn, instrLiveOut);
    window.renderInsights(varStats);
    window.renderCompare(instrs, optimized);
    window.renderOutput(optimized);
    window.renderMetrics(instrs, passes, optimized);
    window.renderReport(instrs, passes, optimized, currentOLevel);
    
    if (execTrace.length) {
      window.initExecution(execTrace);
    } else {
      document.getElementById('executionView').innerHTML = '<div class="pass-no-change">No execution trace generated.</div>';
    }

    window.switchTab('ir');
    if (stepModeOn) window.openStepMode();

  } catch (e) {
    console.error(e);
    alert('Error: ' + e.message);
  }
}

// Gutter and Scroll Logic
function updateGutter() {
  const ta = document.getElementById('codeEditor');
  const lines = ta.value.split('\n').length;
  let h = ''; for(let i=1; i<=lines; i++) h += `<span>${i}</span>`;
  document.getElementById('editorGutter').innerHTML = h;
}
function syncGutterScroll() {
  document.getElementById('editorGutter').scrollTop = document.getElementById('codeEditor').scrollTop;
}

// Overlay Step mode
let _overlayStep = 0;
function openStepMode() { _overlayStep = 0; renderOverlayStep(0); document.getElementById('stepOverlay').style.display = 'flex'; }
function closeStepMode() { document.getElementById('stepOverlay').style.display = 'none'; }
function stepModalNext() { if (_overlayStep < allPasses.length - 1) { _overlayStep++; renderOverlayStep(_overlayStep); } else closeStepMode(); }
function stepModalBack() { if (_overlayStep > 0) { _overlayStep--; renderOverlayStep(_overlayStep); } }
function renderOverlayStep(idx) {
  const pass = allPasses[idx];
  document.getElementById('stepModalTitle').textContent = pass.name;
  document.getElementById('stepModalCounter').textContent = `${idx + 1} / ${allPasses.length}`;
  document.getElementById('stepModalBody').innerHTML = `<p>${pass.description}</p>`;
}

window.switchMode = switchMode;
window.loadSample = loadSample;
window.clearEditor = clearEditor;
window.setOLevel = setOLevel;
window.toggleStepMode = toggleStepMode;
window.runOptimizer = runOptimizer;
window.updateGutter = updateGutter;
window.syncGutterScroll = syncGutterScroll;
window.openStepMode = openStepMode;
window.closeStepMode = closeStepMode;
window.stepModalNext = stepModalNext;
window.stepModalBack = stepModalBack;
