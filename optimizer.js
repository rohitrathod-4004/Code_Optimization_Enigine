// ============================================================
//  OPTIMIZER — Unified Pipeline with O-Levels
// ============================================================

function isNum(v) { return v !== undefined && v !== null && !isNaN(Number(v)) && v !== ''; }
function num(v)   { return Number(v); }
function deepClone(instrs) { return instrs.map(i => Object.assign({}, i)); }

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

// ── Pass Helpers ─────────────────────────────────────────────
function syncBlocks(instrs) {
  const blocks = window.buildCFG(instrs);
  blocks.forEach(b => {
    b.instrs.forEach(ins => { ins._block = b.id; });
  });
  return blocks;
}

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
        changes.push({ type:'changed', before: old, after: instrToStr(ins), note: `${a} ${op} ${b} = ${val}` });
      }
    }
  }
  return { name:'Constant Folding', changes, before, after: result.map(instrToStr), instrs: result, description:'Evaluates constant arithmetic expressions.' };
}

// ── 2. CONSTANT PROPAGATION ──────────────────────────────────
function constantPropagation(instrs) {
  const before = instrs.map(instrToStr);
  const result = deepClone(instrs);
  const blocks = syncBlocks(result);
  
  // Identify loop headers (blocks with back-edges or multiple entries)
  const isHeader = new Set();
  blocks.forEach(b => {
    if (b.predecessors.length > 1) isHeader.add(b.id);
    if (b.predecessors.some(p => p.id >= b.id)) isHeader.add(b.id);
  });

  const changes = [];
  let blockConstants = {};
  let curBlock = -1;

  for (let i = 0; i < result.length; i++) {
    const ins = result[i];
    if (ins._block !== undefined && ins._block !== curBlock) {
      curBlock = ins._block;
      // CRITICAL: Reset if it's a loop header or new block
      if (isHeader.has(curBlock)) blockConstants = {};
      else {
        // Carry over constants from PREVIOUS block only if it's a simple fall-through
        // For simplicity in this visualizer, let's reset on EVERY block change
        blockConstants = {}; 
      }
    }
    // ... rest of propagation ...

    const old = instrToStr(ins);
    let modified = false;
    const sub = (v) => { if (!isNum(v) && blockConstants[v] !== undefined) { modified = true; return blockConstants[v]; } return v; };

    if (ins.op === 'binop') { ins.arg1 = sub(ins.arg1); ins.arg2 = sub(ins.arg2); }
    else if (ins.op === 'assign') { ins.arg1 = sub(ins.arg1); }
    else if (ins.op === 'if') { ins.arg1 = sub(ins.arg1); ins.arg2 = sub(ins.arg2); }
    else if (ins.op === 'return' && ins.arg1) { ins.arg1 = sub(ins.arg1); }

    if (modified) {
      updateRaw(ins);
      changes.push({ type: 'changed', before: old, after: instrToStr(ins), note: 'Propagated constant' });
    }

    if (ins.op === 'assign' && isNum(ins.arg1)) {
      blockConstants[ins.result] = ins.arg1;
    } else if (ins.result) {
      delete blockConstants[ins.result];
    }
  }
  return { name:'Constant Propagation', changes, before, after: result.map(instrToStr), instrs: result, description:'Replaces variable uses with constant values (Block-local).' };
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
    let simplified = null, note = '';
    if (op === '+' && num(arg2) === 0) { simplified = arg1; note = `${arg1} + 0 = ${arg1}`; }
    else if (op === '+' && num(arg1) === 0) { simplified = arg2; note = `0 + ${arg2} = ${arg2}`; }
    else if (op === '-' && num(arg2) === 0) { simplified = arg1; note = `${arg1} - 0 = ${arg1}`; }
    else if (op === '*' && num(arg2) === 1) { simplified = arg1; note = `${arg1} * 1 = ${arg1}`; }
    else if (op === '*' && num(arg1) === 1) { simplified = arg2; note = `1 * ${arg2} = ${arg2}`; }
    else if (op === '*' && (num(arg1) === 0 || num(arg2) === 0)) { simplified = '0'; note = 'x * 0 = 0'; }
    else if (op === '/' && num(arg2) === 1) { simplified = arg1; note = `${arg1} / 1 = ${arg1}`; }
    else if (op === '-' && arg1 === arg2) { simplified = '0'; note = 'x - x = 0'; }
    if (simplified !== null) {
      ins.op = 'assign'; ins.arg1 = simplified; delete ins.arg2; delete ins.operator;
      updateRaw(ins);
      changes.push({ type:'changed', before: old, after: instrToStr(ins), note });
    }
  }
  return { name:'Algebraic Simplification', changes, before, after: result.map(instrToStr), instrs: result, description:'Applies algebraic identities (x+0, x*1, etc.).' };
}

// ── 4. COPY PROPAGATION ───────────────────────────────────────
function copyPropagation(instrs) {
  const before = instrs.map(instrToStr);
  const result = deepClone(instrs);
  syncBlocks(result);
  const changes = [];
  let copyMap = {};
  let curBlock = -1;

  for (const ins of result) {
    if (ins._block !== undefined && ins._block !== curBlock) {
      curBlock = ins._block; copyMap = {};
    }
    let changed = false; const old = instrToStr(ins);
    const sub = (v) => { if (copyMap[v]) { changed = true; return copyMap[v]; } return v; };
    if (ins.op === 'binop') { ins.arg1 = sub(ins.arg1); ins.arg2 = sub(ins.arg2); }
    else if (ins.op === 'assign') { ins.arg1 = sub(ins.arg1); }
    else if (ins.op === 'if') { ins.arg1 = sub(ins.arg1); ins.arg2 = sub(ins.arg2); }
    
    if (ins.op === 'assign' && !isNum(ins.arg1)) {
      copyMap[ins.result] = ins.arg1;
    } else if (ins.result) {
      delete copyMap[ins.result];
      Object.keys(copyMap).forEach(k => { if (copyMap[k] === ins.result) delete copyMap[k]; });
    }

    if (changed) { updateRaw(ins); changes.push({ type:'changed', before: old, after: instrToStr(ins), note:'copy propagated' }); }
  }
  return { name:'Copy Propagation', changes, before, after: result.map(instrToStr), instrs: result, description:'Replaces copies (x = y) with original variables (Block-local).' };
}

// ── 5. COMMON SUBEXPRESSION ELIMINATION ──────────────────────
function commonSubexpressionElimination(instrs) {
  const before = instrs.map(instrToStr);
  const result = deepClone(instrs);
  syncBlocks(result);
  const changes = [];
  let exprMap = {};
  let curBlock = -1;

  for (const ins of result) {
    if (ins._block !== undefined && ins._block !== curBlock) {
      curBlock = ins._block; exprMap = {};
    }
    if (ins.op === 'binop') {
      const key = `${ins.arg1}${ins.operator}${ins.arg2}`;
      const old = instrToStr(ins);
      if (exprMap[key] && exprMap[key] !== ins.result) {
        const prev = exprMap[key];
        ins.op = 'assign'; ins.arg1 = prev; delete ins.arg2; delete ins.operator;
        updateRaw(ins);
        changes.push({ type:'changed', before: old, after: instrToStr(ins), note:`reuses ${prev}` });
      } else { exprMap[key] = ins.result; }
    }
    if (ins.result) {
      Object.keys(exprMap).forEach(key => { if (key.includes(ins.result)) delete exprMap[key]; });
    }
  }
  return { name:'Common Subexpression Elimination', changes, before, after: result.map(instrToStr), instrs: result, description:'Detects and removes repeated computations (Block-local).' };
}

// ── 6. DEAD CODE ELIMINATION (LVA-based) ──────────────────────
function deadCodeElimination(instrs) {
  const before = instrs.map(instrToStr);
  const snapshot = deepClone(instrs);
  const changes = [];
  const blocks = syncBlocks(snapshot); // Rebuild fresh CFG
  window.computeLiveness(snapshot, blocks);
  const toRemove = new Set();
  blocks.forEach(b => {
    let live = new Set(b.OUT);
    for (let i = b.instrs.length - 1; i >= 0; i--) {
      const ins = b.instrs[i];
      const flatIdx = snapshot.indexOf(ins);
      if (flatIdx === -1) continue;
      if ((ins.op === 'assign' || ins.op === 'binop') && ins.result && !live.has(ins.result)) {
        changes.push({ type:'removed', before: instrToStr(ins), after:'(removed)', note:`${ins.result} not live` });
        toRemove.add(flatIdx);
      }
      const { use, def } = window.instrUseDef(ins);
      def.forEach(v => live.delete(v));
      use.forEach(v => live.add(v));
    }
  });
  const filtered = snapshot.filter((_, i) => !toRemove.has(i));
  return { name:'Dead Code Elimination', changes, before, after: filtered.map(instrToStr), instrs: filtered, description:'Removes results that are never used (LVA-based).' };
}

// ── PIPELINE RUNNER ───────────────────────────────────────────
function runPassesAtLevel(instrs, level) {
  let current = deepClone(instrs);
  const passes = [];
  if (level === 0) return { passes: [], optimized: current };

  const run = (fn) => { const r = fn(current); current = r.instrs; passes.push(r); };

  run(constantFolding);
  run(algebraicSimplification);
  if (level === 1) return { passes, optimized: current };

  if (level >= 2) {
    const blocks = syncBlocks(current);
    const licmRes = window.applyLICM(current, blocks);
    const licmPass = { name: licmRes.name, description: licmRes.description, changes: licmRes.changes, before: current.map(instrToStr), after: licmRes.instrs.map(instrToStr), instrs: licmRes.instrs };
    current = licmRes.instrs;
    passes.push(licmPass);
  }

  run(constantPropagation);
  run(copyPropagation);
  run(commonSubexpressionElimination);
  run(deadCodeElimination);

  return { passes, optimized: current };
}

window.runPassesAtLevel = runPassesAtLevel;
window.instrToStr = instrToStr;
window.isNum = isNum;
window.num = num;
window.updateRaw = updateRaw;
window.syncBlocks = syncBlocks;
