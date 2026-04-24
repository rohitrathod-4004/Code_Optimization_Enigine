// ============================================================
//  DATAFLOW.JS — Live Variable Analysis (Backward Dataflow)
//  Operates on blocks produced by buildCFG().
//  Attaches .use, .def, .IN, .OUT (Sets) to each block.
// ============================================================

// ── Helpers ───────────────────────────────────────────────────

/** Return true if v is an identifier (not a numeric literal or empty). */
function isIdent(v) {
  return v !== undefined && v !== null && v !== '' && isNaN(Number(v));
}

/** Union of two Sets → new Set */
function setUnion(a, b) {
  const result = new Set(a);
  b.forEach(v => result.add(v));
  return result;
}

/** a − b (set difference) → new Set */
function setDiff(a, b) {
  const result = new Set(a);
  b.forEach(v => result.delete(v));
  return result;
}

/** True if two Sets have identical contents */
function setEq(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// ── Instruction-level use / def ───────────────────────────────

/**
 * instrUseDef(ins)
 * Returns { use: Set<string>, def: Set<string> }
 */
function instrUseDef(ins) {
  const use = new Set();
  const def = new Set();

  switch (ins.op) {
    case 'assign':
      if (ins.result) def.add(ins.result);
      if (isIdent(ins.arg1)) use.add(ins.arg1);
      break;

    case 'binop':
      if (ins.result) def.add(ins.result);
      if (isIdent(ins.arg1)) use.add(ins.arg1);
      if (isIdent(ins.arg2)) use.add(ins.arg2);
      break;

    case 'if':
      if (isIdent(ins.arg1)) use.add(ins.arg1);
      if (isIdent(ins.arg2)) use.add(ins.arg2);
      break;

    case 'return':
      if (isIdent(ins.arg1)) use.add(ins.arg1);
      break;

    case 'goto':
    case 'label':
    default:
      break;
  }

  return { use, def };
}

// ── Basic Block aggregation ───────────────────────────────────

/**
 * blockUseDef(block)
 * Computes upward-exposed uses and definitions for a basic block.
 * Attaches block.use and block.def (Sets) in-place.
 */
function blockUseDef(block) {
  const blockUse = new Set();
  const blockDef = new Set();

  for (const ins of block.instrs) {
    const { use, def } = instrUseDef(ins);

    // Upward-exposed: used before being defined in this block
    use.forEach(v => {
      if (!blockDef.has(v)) blockUse.add(v);
    });

    // Simple: everything defined
    def.forEach(v => blockDef.add(v));
  }

  block.use = blockUse;
  block.def = blockDef;
}

// ── Iterative Live Variable Algorithm ─────────────────────────

/**
 * runLiveVariableAnalysis(blocks)
 * Standard backward-dataflow fixed-point iteration.
 * Attaches block.IN and block.OUT (Sets) to every block in-place.
 *
 * Equations:
 *   OUT[B] = ∪ { IN[S] | S ∈ successors(B) }
 *   IN[B]  = use[B] ∪ (OUT[B] − def[B])
 */
function runLiveVariableAnalysis(blocks) {
  if (!blocks || !blocks.length) return;

  // 1. Compute use / def for every block
  blocks.forEach(b => blockUseDef(b));

  // 2. Initialize IN and OUT to empty sets
  blocks.forEach(b => {
    b.IN  = new Set();
    b.OUT = new Set();
  });

  // 3. Iterate until convergence (process in reverse for efficiency)
  let changed = true;
  while (changed) {
    changed = false;

    // Backward pass — iterate in reverse block order
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];

      // OUT[B] = union of IN of all successors
      const newOUT = new Set();
      b.successors.forEach(s => s.IN.forEach(v => newOUT.add(v)));

      // IN[B] = use[B] ∪ (OUT[B] − def[B])
      const newIN = setUnion(b.use, setDiff(newOUT, b.def));

      if (!setEq(newIN, b.IN) || !setEq(newOUT, b.OUT)) {
        b.IN  = newIN;
        b.OUT = newOUT;
        changed = true;
      }
    }
  }
}

// ── DOMINATOR SET COMPUTATION ──────────────────────────────────────────────
function computeDominators(blocks) {
  if (!blocks || blocks.length === 0) return;

  const allBlocks = new Set(blocks);
  let entry = blocks[0];
  for (const b of blocks) {
    if (b.preds.length === 0) {
      entry = b;
      break;
    }
  }

  for (const b of blocks) {
    if (b === entry) {
      b.dominators = new Set([b]);
    } else {
      b.dominators = new Set(allBlocks);
    }
  }

  let changed = true;
  let iters = 0;
  while (changed && iters++ < 1000) {
    changed = false;
    for (const b of blocks) {
      if (b === entry) continue;

      let intersection = null;
      for (const p of b.preds) {
        if (!intersection) {
          intersection = new Set(p.dominators);
        } else {
          const newIntersect = new Set();
          for (const d of intersection) {
            if (p.dominators.has(d)) newIntersect.add(d);
          }
          intersection = newIntersect;
        }
      }
      
      if (!intersection) intersection = new Set();
      
      intersection.add(b);

      if (b.dominators.size !== intersection.size) {
        b.dominators = intersection;
        changed = true;
      } else {
        for (const d of intersection) {
          if (!b.dominators.has(d)) {
            b.dominators = intersection;
            changed = true;
            break;
          }
        }
      }
    }
  }
}

// ── Export ────────────────────────────────────────────────────
window.instrUseDef             = instrUseDef;
window.blockUseDef             = blockUseDef;
window.runLiveVariableAnalysis = runLiveVariableAnalysis;
window.computeDominators       = computeDominators;
