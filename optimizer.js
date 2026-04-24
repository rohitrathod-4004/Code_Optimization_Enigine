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
    case 'func':   return `func ${ins.label}:`;
    case 'param':  return `param ${ins.arg1}`;
    case 'call':   return `call ${ins.label}`;
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
          note: `${a} ${op} ${b} = ${val}` });
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
  const constMap = {};

  // Build initial constant map from assign instructions
  for (const ins of result) {
    if (ins.op === 'assign' && isNum(ins.arg1)) constMap[ins.result] = ins.arg1;
  }

  for (const ins of result) {
    let changed = false;
    const old = instrToStr(ins);

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

    if (changed) { updateRaw(ins); changes.push({ type:'changed', before: old, after: instrToStr(ins), note:'constant substituted' }); }
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
      changes.push({ type:'changed', before: old, after: instrToStr(ins), note });
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
  const exprMap = {}; // "arg1 op arg2" → result variable

  for (const ins of result) {
    if (ins.op !== 'binop') continue;
    const key = `${ins.arg1}${ins.operator}${ins.arg2}`;
    const old = instrToStr(ins);
    if (exprMap[key] !== undefined && exprMap[key] !== ins.result) {
      const prev = exprMap[key];
      ins.op = 'assign'; ins.arg1 = prev; delete ins.arg2; delete ins.operator;
      updateRaw(ins);
      changes.push({ type:'changed', before: old, after: instrToStr(ins), note:`reuses ${prev}` });
    } else {
      exprMap[key] = ins.result;
    }
  }
  return { name:'Common Subexpression Elimination', changes, before, after: result.map(instrToStr),
    instrs: result,
    description:'Detects repeated computations and replaces them with a reference to the first computed result.' };
}

// ── 5. DEAD CODE ELIMINATION ──────────────────────────────────
function deadCodeElimination(instrs) {
  const before = instrs.map(instrToStr);
  const result = deepClone(instrs);
  const changes = [];

  // Collect all used variables
  const used = new Set();
  for (const ins of result) {
    if (ins.arg1 && !isNum(ins.arg1)) used.add(ins.arg1);
    if (ins.arg2 && !isNum(ins.arg2)) used.add(ins.arg2);
    if (ins.op === 'return' && ins.arg1) used.add(ins.arg1);
  }

  // Mark instructions whose result is never used
  const toRemove = new Set();
  for (let i = result.length - 1; i >= 0; i--) {
    const ins = result[i];
    if ((ins.op === 'assign' || ins.op === 'binop') && ins.result && !used.has(ins.result)) {
      changes.push({ type:'removed', before: instrToStr(ins), after:'(removed)', note:`${ins.result} never used` });
      toRemove.add(i);
    }
  }

  const filtered = result.filter((_, i) => !toRemove.has(i));
  return { name:'Dead Code Elimination', changes, before, after: filtered.map(instrToStr),
    instrs: filtered,
    description:'Removes assignments whose results are never referenced, reducing instruction count.' };
}

// ── 6. COPY PROPAGATION ───────────────────────────────────────
function copyPropagation(instrs) {
  const before = instrs.map(instrToStr);
  const result = deepClone(instrs);
  const changes = [];
  const copyMap = {}; // x → y  means x = y (simple copy)

  for (const ins of result) {
    if (ins.op === 'assign') {
      if (!isNum(ins.arg1) && copyMap[ins.arg1]) {
        const old = instrToStr(ins);
        const newVal = copyMap[ins.arg1];
        ins.arg1 = newVal;
        updateRaw(ins);
        changes.push({ type:'changed', before: old, after: instrToStr(ins), note:`propagated ${newVal}` });
      }
      if (!isNum(ins.arg1)) copyMap[ins.result] = ins.arg1;
      else delete copyMap[ins.result];
    } else if (ins.op === 'binop') {
      let changed = false; const old = instrToStr(ins);
      if (copyMap[ins.arg1]) { ins.arg1 = copyMap[ins.arg1]; changed = true; }
      if (copyMap[ins.arg2]) { ins.arg2 = copyMap[ins.arg2]; changed = true; }
      if (changed) { updateRaw(ins); changes.push({ type:'changed', before: old, after: instrToStr(ins), note:'copy propagated' }); }
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
function runAllPasses(instrs) {
  const passes = [];
  let current = deepClone(instrs);
  const run = (fn) => { const res = fn(current); current = res.instrs; passes.push(res); };
  run(constantFolding);
  run(constantPropagation);
  run(algebraicSimplification);
  run(copyPropagation);
  run(commonSubexpressionElimination);
  run(deadCodeElimination);
  return { passes, optimized: current };
}

// ── O-LEVEL RUNNER ────────────────────────────────────────────
// O0 = none, O1 = basic, O2 = full+LICM
function runPassesAtLevel(instrs, level, blocks) {
  if (level === 0) {
    return { passes: [], optimized: deepClone(instrs), licmResult: null };
  }
  if (level === 1) {
    let current = deepClone(instrs);
    const passes = [];
    [constantFolding, algebraicSimplification].forEach(fn => {
      const r = fn(current); current = r.instrs; passes.push(r);
    });
    return { passes, optimized: current, licmResult: null };
  }
  // O2: LICM first, then full pipeline
  const licmResult = applyLICM(instrs, blocks || []);
  // Build LICM as a display pass
  const licmPass = {
    name: licmResult.name,
    description: licmResult.description,
    changes: licmResult.changes.map(c => ({ type:'changed', before: c.before, after: c.after, note: c.note })),
    before: instrs.map(instrToStr),
    after: licmResult.instrs.map(instrToStr),
    instrs: licmResult.instrs
  };
  const { passes, optimized } = runAllPasses(licmResult.instrs);
  return { passes: [licmPass, ...passes], optimized, licmResult };
}

// ── Export ───────────────────────────────────────────────────
window.runAllPasses      = runAllPasses;
window.runPassesAtLevel  = runPassesAtLevel;
window.instrToStr        = instrToStr;

