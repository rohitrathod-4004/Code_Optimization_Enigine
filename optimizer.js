// ============================================================
//  OPTIMIZER — Six Optimization Passes
//  Each pass returns: { name, description, changes[], before[], after[] }
// ============================================================

function isNum(v) { return v !== undefined && v !== null && !isNaN(Number(v)) && v !== ''; }
function num(v)   { return Number(v); }

function deepClone(instrs) {
  return instrs.map(i => Object.assign({}, i));
}

function instrToStr(ins) {
  if (!ins) return '';
  switch(ins.op) {
    case 'binop':  return `${ins.result} = ${ins.arg1} ${ins.operator} ${ins.arg2}`;
    case 'assign': return `${ins.result} = ${ins.arg1}`;
    case 'label':  return `${ins.label}:`;
    case 'goto':   return `goto ${ins.label}`;
    case 'if':     return `if ${ins.arg1} ${ins.cond} ${ins.arg2} goto ${ins.label}`;
    case 'return': return ins.arg1 ? `return ${ins.arg1}` : `return`;
    default:       return ins.raw || JSON.stringify(ins);
  }
}

function updateRaw(ins) { ins.raw = instrToStr(ins); return ins; }

// ── 1. CONSTANT FOLDING ──────────────────────────────────────
function constantFolding(instrs) {
  const before = instrs.map(instrToStr);
  const result = deepClone(instrs);
  const changes = [];

  for (const ins of result) {
    if (ins.op === 'binop' && isNum(ins.arg1) && isNum(ins.arg2)) {
      const a = num(ins.arg1), b = num(ins.arg2), op = ins.operator;
      let val;
      if (op === '+') val = a + b;
      else if (op === '-') val = a - b;
      else if (op === '*') val = a * b;
      else if (op === '/' && b !== 0) val = Math.trunc(a / b);
      else if (op === '%' && b !== 0) val = a % b;
      if (val !== undefined) {
        const old = instrToStr(ins);
        ins.op = 'assign'; ins.arg1 = String(val); delete ins.arg2; delete ins.operator;
        updateRaw(ins);
        changes.push({ type:'changed', before: old, after: instrToStr(ins),
          note: `${a} ${op} ${b} = ${val}`, reason: 'Computed constant expression' });
      }
    }
  }
  return { name:'Constant Folding', changes, before, after: result.map(instrToStr),
    instrs: result,
    description:'Evaluates constant arithmetic expressions at compile time. E.g. <code>t1 = 2 + 3</code> → <code>t1 = 5</code>' };
}

// ── 2. CONSTANT PROPAGATION ──────────────────────────────────
function constantPropagation(instrs) {
  const before = instrs.map(instrToStr);
  const result = deepClone(instrs);
  const changes = [];
  let constMap = {};

  for (const ins of result) {
    let changed = false;
    const old = instrToStr(ins);

    // Block boundary: clear map to prevent unsafe cross-iteration propagation
    if (ins.op === 'label') {
      constMap = {};
    }

    const sub = (val) => {
      if (!isNum(val) && constMap[val] !== undefined) { changed = true; return constMap[val]; }
      return val;
    };

    if (ins.op === 'binop') { ins.arg1 = sub(ins.arg1); ins.arg2 = sub(ins.arg2); }
    else if (ins.op === 'assign') { ins.arg1 = sub(ins.arg1); }
    else if (ins.op === 'if') { ins.arg1 = sub(ins.arg1); ins.arg2 = sub(ins.arg2); }
    else if (ins.op === 'return') { if (ins.arg1) ins.arg1 = sub(ins.arg1); }

    // Update constMap after substitution
    if (ins.op === 'assign' && isNum(ins.arg1)) constMap[ins.result] = ins.arg1;
    else if (ins.op === 'assign') delete constMap[ins.result];
    else if (ins.op === 'binop') delete constMap[ins.result];

    if (changed) { updateRaw(ins); changes.push({ type:'changed', before: old, after: instrToStr(ins), note:'constant substituted', reason: 'Replaced variable with constant value' }); }
  }
  return { name:'Constant Propagation', changes, before, after: result.map(instrToStr),
    instrs: result,
    description:'Replaces variable uses with their known constant values, enabling further optimizations.' };
}

// ── 3. ALGEBRAIC SIMPLIFICATION ──────────────────────────────
function algebraicSimplification(instrs) {
  const before = instrs.map(instrToStr);
  const result = deepClone(instrs);
  const changes = [];

  for (const ins of result) {
    if (ins.op !== 'binop') continue;
    const old = instrToStr(ins);
    const { arg1, arg2, operator: op } = ins;
    const a1Num = isNum(arg1), a2Num = isNum(arg2);
    let simplified = null, note = '';

    if (op === '+' && a2Num && num(arg2) === 0) { simplified = arg1; note = `${arg1} + 0 = ${arg1}`; }
    else if (op === '+' && a1Num && num(arg1) === 0) { simplified = arg2; note = `0 + ${arg2} = ${arg2}`; }
    else if (op === '-' && a2Num && num(arg2) === 0) { simplified = arg1; note = `${arg1} - 0 = ${arg1}`; }
    else if (op === '*' && a2Num && num(arg2) === 1) { simplified = arg1; note = `${arg1} * 1 = ${arg1}`; }
    else if (op === '*' && a1Num && num(arg1) === 1) { simplified = arg2; note = `1 * ${arg2} = ${arg2}`; }
    else if (op === '*' && ((a2Num && num(arg2) === 0) || (a1Num && num(arg1) === 0))) {
      simplified = '0'; note = `${arg1} * ${arg2} = 0`;
    }
    else if (op === '/' && a2Num && num(arg2) === 1) { simplified = arg1; note = `${arg1} / 1 = ${arg1}`; }
    else if (op === '-' && arg1 === arg2) { simplified = '0'; note = `${arg1} - ${arg1} = 0`; }

    if (simplified !== null) {
      ins.op = 'assign'; ins.arg1 = simplified; delete ins.arg2; delete ins.operator;
      updateRaw(ins);
      changes.push({ type:'changed', before: old, after: instrToStr(ins), note, reason: 'Simplified algebraic expression' });
    }
  }
  return { name:'Algebraic Simplification', changes, before, after: result.map(instrToStr),
    instrs: result,
    description:'Applies algebraic identities: x+0=x, x*1=x, x*0=0, x-x=0, x/1=x.' };
}

// ── 4. COMMON SUBEXPRESSION ELIMINATION (CSE) ────────────────
function commonSubexpressionElimination(instrs) {
  const before = instrs.map(instrToStr);
  const result = deepClone(instrs);
  const changes = [];
  let exprMap = {}; // "arg1 op arg2" → result variable

  for (const ins of result) {
    if (ins.op === 'label') {
      exprMap = {}; // Block boundary: clear map to be safe
    }
    if (ins.op !== 'binop') continue;
    const key = `${ins.arg1}${ins.operator}${ins.arg2}`;
    const old = instrToStr(ins);
    if (exprMap[key] !== undefined && exprMap[key] !== ins.result) {
      const prev = exprMap[key];
      ins.op = 'assign'; ins.arg1 = prev; delete ins.arg2; delete ins.operator;
      updateRaw(ins);
      changes.push({ type:'changed', before: old, after: instrToStr(ins), note:`reuses ${prev}`, reason: 'Reused previously computed expression' });
    } else {
      exprMap[key] = ins.result;
    }
  }
  return { name:'Common Subexpression Elimination', changes, before, after: result.map(instrToStr),
    instrs: result,
    description:'Detects repeated computations and replaces them with a reference to the first computed result.' };
}

// ── 5. DEAD CODE ELIMINATION (LVA-based) ──────────────────────
function deadCodeElimination(instrs) {
  const before = instrs.map(instrToStr);
  const snapshot = deepClone(instrs);
  const changes  = [];

  // ── Build CFG + LVA on the current instruction set ──────────
  const blocks = window.buildCFG(snapshot);
  window.runLiveVariableAnalysis(blocks);

  // ── Mark dead instructions block-by-block ────────────────────
  // An instruction is removable if:
  //   • it has a result (assign or binop)
  //   • that result is NOT live at the point just before the instruction
  //   • it is not a control-flow or effectful instruction
  const deadSet = new Set(); // indices into snapshot[]

  for (const block of blocks) {
    // Start with liveness = OUT[B] from dataflow
    // We use a plain Set (copy) so we can mutate it per-instruction
    let live = new Set(block.OUT);

    // Traverse instructions in reverse order
    for (let k = block.instrs.length - 1; k >= 0; k--) {
      const ins  = block.instrs[k];
      // Compute original flat index: block.startIdx + k
      const flatIdx = block.startIdx + k;

      const isEliminable = (ins.op === 'assign' || ins.op === 'binop')
                        && ins.result
                        && !live.has(ins.result);

      if (isEliminable) {
        changes.push({
          type:   'removed',
          before: instrToStr(ins),
          after:  '(removed)',
          note:   `${ins.result} not live`,
          reason: 'Variable not live after this point'
        });
        deadSet.add(flatIdx);
      }

      // Update liveness BACKWARDS:
      //   live = (live − def(ins)) ∪ use(ins)
      const { use, def } = window.instrUseDef(ins);
      def.forEach(v => live.delete(v));
      use.forEach(v => live.add(v));
    }
  }

  // ── Filter snapshot, preserving order ───────────────────────
  const filtered = snapshot.filter((_, i) => !deadSet.has(i));

  return {
    name: 'Dead Code Elimination',
    changes,
    before,
    after: filtered.map(instrToStr),
    instrs: filtered,
    description: 'Removes assignments whose results are not live (LVA-based), ' +
                 'eliminating truly dead definitions even in branching code.'
  };
}

// ── 6. COPY PROPAGATION ───────────────────────────────────────
function copyPropagation(instrs) {
  const before = instrs.map(instrToStr);
  const result = deepClone(instrs);
  const changes = [];
  let copyMap = {}; // x → y  means x = y (simple copy)

  for (const ins of result) {
    if (ins.op === 'label') {
      copyMap = {}; // Block boundary: clear map
    }
    if (ins.op === 'assign') {
      if (!isNum(ins.arg1) && copyMap[ins.arg1]) {
        const old = instrToStr(ins);
        const newVal = copyMap[ins.arg1];
        ins.arg1 = newVal;
        updateRaw(ins);
        changes.push({ type:'changed', before: old, after: instrToStr(ins), note:`propagated ${newVal}`, reason: 'Replaced variable with its source' });
      }
      if (!isNum(ins.arg1)) copyMap[ins.result] = ins.arg1;
      else delete copyMap[ins.result];
    } else if (ins.op === 'binop') {
      let changed = false; const old = instrToStr(ins);
      if (copyMap[ins.arg1]) { ins.arg1 = copyMap[ins.arg1]; changed = true; }
      if (copyMap[ins.arg2]) { ins.arg2 = copyMap[ins.arg2]; changed = true; }
      if (changed) { updateRaw(ins); changes.push({ type:'changed', before: old, after: instrToStr(ins), note:'copy propagated', reason: 'Replaced variable with its source' }); }
      delete copyMap[ins.result];
    } else if (ins.op !== 'label' && ins.op !== 'goto') {
      if (ins.result) delete copyMap[ins.result];
    }
  }
  return { name:'Copy Propagation', changes, before, after: result.map(instrToStr),
    instrs: result,
    description:'Replaces copies (x = y) with the original variable y wherever x is used, allowing further DCE.' };
}

// ── PIPELINE RUNNER ───────────────────────────────────────────
// Pass composition per level:
//   O0 — no passes (return original unchanged)
//   O1 — Constant Folding + Constant Propagation
//   O2 — O1 + Algebraic Simplification + Copy Propagation
//   O3 — O2 + Common Subexpression Elimination + Dead Code Elimination
function runAllPasses(instrs, level) {
  const passes  = [];
  let   current = deepClone(instrs);
  const lv      = level || 'O2';

  // O0: return immediately with no passes applied
  if (lv === 'O0') {
    return { passes, optimized: current };
  }

  const run = (fn) => {
    const res = fn(current);
    current   = res.instrs;
    passes.push(res);
  };

  // O1 — always included when level ≥ O1
  run(constantFolding);
  run(constantPropagation);

  // O2 — adds algebraic simplification + copy propagation
  if (lv === 'O2' || lv === 'O3') {
    run(algebraicSimplification);
    run(copyPropagation);
  }

  // O3 — adds CSE + LVA-based dead code elimination
  if (lv === 'O3') {
    run(commonSubexpressionElimination);
    run(deadCodeElimination);
  }

  return { passes, optimized: current };
}

// ── Export ───────────────────────────────────────────────────
window.runAllPasses = runAllPasses;
window.instrToStr   = instrToStr;

