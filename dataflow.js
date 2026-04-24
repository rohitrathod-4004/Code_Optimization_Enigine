// ============================================================
//  DATAFLOW.JS — Live Variable Analysis + Variable Stats
// ============================================================

function dfIsConst(v) {
  return v !== undefined && v !== null && v !== '' && !isNaN(Number(v));
}

// Per-instruction use/def sets
function instrUseDef(ins) {
  const use = [], def = [];
  switch(ins.op) {
    case 'binop':
      if (!dfIsConst(ins.arg1)) use.push(ins.arg1);
      if (!dfIsConst(ins.arg2)) use.push(ins.arg2);
      if (ins.result) def.push(ins.result); break;
    case 'assign':
      if (!dfIsConst(ins.arg1)) use.push(ins.arg1);
      if (ins.result) def.push(ins.result); break;
    case 'if':
      if (!dfIsConst(ins.arg1)) use.push(ins.arg1);
      if (!dfIsConst(ins.arg2)) use.push(ins.arg2); break;
    case 'return':
      if (ins.arg1 && !dfIsConst(ins.arg1)) use.push(ins.arg1); break;
  }
  return { use, def };
}

// Block-level aggregated use/def (upward-exposed uses and definitions)
function blockUseDef(block) {
  const use = new Set(), def = new Set();
  for (const ins of block.instrs) {
    const { use: u, def: d } = instrUseDef(ins);
    for (const v of u) { if (!def.has(v)) use.add(v); }
    for (const v of d) def.add(v);
  }
  return { use, def };
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// Main liveness computation
function computeLiveness(instrs, blocks) {
  const empty = () => instrs.map(() => new Set());
  if (!blocks.length || !instrs.length) {
    return { instrLiveIn: empty(), instrLiveOut: empty() };
  }

  // Block-level use/def
  const bUD = blocks.map(b => blockUseDef(b));
  const bIn  = blocks.map(() => new Set());
  const bOut = blocks.map(() => new Set());

  // Fixed-point iteration (backward)
  let changed = true, iter = 0;
  while (changed && iter++ < 60) {
    changed = false;
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      const newOut = new Set();
      for (const s of b.successors) for (const v of bIn[s.id]) newOut.add(v);
      const newIn = new Set(bUD[i].use);
      for (const v of newOut) if (!bUD[i].def.has(v)) newIn.add(v);
      if (!setsEqual(newIn, bIn[i]) || !setsEqual(newOut, bOut[i])) {
        bIn[i] = newIn; bOut[i] = newOut; changed = true;
      }
    }
  }

  // Per-instruction liveness (within each block, process backward)
  const instrLiveIn  = instrs.map(() => new Set());
  const instrLiveOut = instrs.map(() => new Set());

  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    let live = new Set(bOut[bi]);
    for (let j = b.instrs.length - 1; j >= 0; j--) {
      const ins = b.instrs[j];
      const gIdx = instrs.indexOf(ins);
      if (gIdx === -1) continue;
      instrLiveOut[gIdx] = new Set(live);
      const { use, def } = instrUseDef(ins);
      for (const v of def) live.delete(v);
      for (const v of use) live.add(v);
      instrLiveIn[gIdx] = new Set(live);
    }
  }

  return { instrLiveIn, instrLiveOut, blockLiveIn: bIn, blockLiveOut: bOut };
}

// Variable statistics for the insight panel
function computeVariableStats(instrs) {
  const stats = {};
  const get = v => { if (!stats[v]) stats[v] = { uses: 0, defs: 0, constVal: null }; return stats[v]; };
  for (const ins of instrs) {
    const { use, def } = instrUseDef(ins);
    for (const v of use) get(v).uses++;
    for (const v of def) get(v).defs++;
    // Detect constant assignments
    if (ins.op === 'assign' && dfIsConst(ins.arg1) && ins.result) {
      get(ins.result).constVal = ins.arg1;
    }
  }
  return stats;
}

window.computeLiveness     = computeLiveness;
window.computeVariableStats = computeVariableStats;
window.instrUseDef         = instrUseDef;
