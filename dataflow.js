// ============================================================
//  DATAFLOW.JS — Live Variable Analysis + Dominators
// ============================================================

function dfIsConst(v) {
  return v !== undefined && v !== null && v !== '' && !isNaN(Number(v));
}

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
    case 'param':
      if (!dfIsConst(ins.arg1)) use.push(ins.arg1); break;
  }
  return { use, def };
}

function setEq(a, b) {
  if (a.size !== b.size) return false;
  for (let v of a) if (!b.has(v)) return false;
  return true;
}

function computeLiveness(instrs, blocks) {
  const empty = () => instrs.map(() => new Set());
  if (!blocks.length || !instrs.length) return { instrLiveIn: empty(), instrLiveOut: empty() };

  const bUD = blocks.map(b => {
    const use = new Set(), def = new Set();
    for (const ins of b.instrs) {
      const { use: u, def: d } = instrUseDef(ins);
      for (const v of u) if (!def.has(v)) use.add(v);
      for (const v of d) def.add(v);
    }
    return { use, def };
  });

  blocks.forEach(b => { b.IN = new Set(); b.OUT = new Set(); });

  let changed = true;
  let iters = 0;
  while (changed && iters++ < 100) {
    changed = false;
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      const newOut = new Set();
      b.successors.forEach(s => { if (s.IN) s.IN.forEach(v => newOut.add(v)); });
      const newIn = new Set(bUD[i].use);
      newOut.forEach(v => { if (!bUD[i].def.has(v)) newIn.add(v); });
      
      if (!setEq(newIn, b.IN) || !setEq(newOut, b.OUT)) {
        b.IN = newIn; b.OUT = newOut; changed = true;
      }
    }
  }

  const instrLiveIn = instrs.map(() => new Set()), instrLiveOut = instrs.map(() => new Set());
  blocks.forEach((b) => {
    let live = new Set(b.OUT);
    for (let j = b.instrs.length - 1; j >= 0; j--) {
      const ins = b.instrs[j];
      const gIdx = instrs.indexOf(ins);
      if (gIdx === -1) continue;
      instrLiveOut[gIdx] = new Set(live);
      const { use, def } = instrUseDef(ins);
      def.forEach(v => live.delete(v));
      use.forEach(v => live.add(v));
      instrLiveIn[gIdx] = new Set(live);
    }
  });

  return { instrLiveIn, instrLiveOut };
}

function computeDominators(blocks) {
  if (!blocks.length) return;
  const allBlocks = new Set(blocks);
  blocks.forEach((b, i) => b.dominators = (i === 0) ? new Set([b]) : new Set(allBlocks));

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < blocks.length; i++) {
      const b = blocks[i];
      let intersect = null;
      b.predecessors.forEach(p => {
        if (!intersect) intersect = new Set(p.dominators);
        else {
          const next = new Set();
          intersect.forEach(d => { if (p.dominators.has(d)) next.add(d); });
          intersect = next;
        }
      });
      if (!intersect) intersect = new Set();
      intersect.add(b);
      if (!setEq(intersect, b.dominators)) {
        b.dominators = intersect; changed = true;
      }
    }
  }
}

function computeVariableStats(instrs) {
  const stats = {};
  instrs.forEach(ins => {
    const { use, def } = instrUseDef(ins);
    use.forEach(v => { if (!stats[v]) stats[v] = { uses: 0, defs: 0, constVal: null }; stats[v].uses++; });
    def.forEach(v => { if (!stats[v]) stats[v] = { uses: 0, defs: 0, constVal: null }; stats[v].defs++; });
    if (ins.op === 'assign' && dfIsConst(ins.arg1)) {
      if (!stats[ins.result]) stats[ins.result] = { uses: 0, defs: 0, constVal: null };
      stats[ins.result].constVal = ins.arg1;
    }
  });
  return stats;
}

window.computeLiveness = computeLiveness;
window.computeDominators = computeDominators;
window.computeVariableStats = computeVariableStats;
window.instrUseDef = instrUseDef;
