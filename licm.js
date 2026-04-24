// ============================================================
//  LICM.JS — Loop Invariant Code Motion
// ============================================================

function licmIsConst(v) {
  return v !== undefined && v !== null && v !== '' && !isNaN(Number(v));
}

// DFS-based back-edge detection
function findBackEdges(blocks) {
  const backEdges = [], visited = new Set(), stack = new Set();
  function dfs(b) {
    visited.add(b.id); stack.add(b.id);
    for (const s of b.successors) {
      if (stack.has(s.id)) backEdges.push({ tail: b, header: s });
      else if (!visited.has(s.id)) dfs(s);
    }
    stack.delete(b.id);
  }
  if (blocks.length) dfs(blocks[0]);
  return backEdges;
}

// Find all block IDs in the loop body (header inclusive)
function findLoopBody(header, tail, blocks) {
  const body = new Set([header.id]);
  const worklist = [tail];
  const seen = new Set([header.id, tail.id]);
  body.add(tail.id);
  while (worklist.length) {
    const b = worklist.shift();
    for (const pred of b.predecessors) {
      if (!seen.has(pred.id)) {
        seen.add(pred.id); body.add(pred.id);
        worklist.push(pred);
      }
    }
  }
  return body;
}

// Apply LICM: move invariant expressions before the loop
function applyLICM(instrs, blocks) {
  const changes = [];
  if (!blocks.length) return { name:'Loop Invariant Code Motion', changes, instrs: instrs.slice(),
    description: 'Moves loop-invariant computations to before the loop header.' };

  const backEdges = findBackEdges(blocks);
  if (!backEdges.length) return { name:'Loop Invariant Code Motion', changes, instrs: instrs.slice(),
    description: 'Moves loop-invariant computations to before the loop header.' };

  let result = instrs.slice();

  for (const { tail, header } of backEdges) {
    const bodyIds = findLoopBody(header, tail, blocks);

    // Collect instructions & defs inside loop
    const loopInstrs = [];
    for (const b of blocks) {
      if (bodyIds.has(b.id)) loopInstrs.push(...b.instrs);
    }
    const loopDefs = new Set();
    for (const ins of loopInstrs) {
      if ((ins.op === 'binop' || ins.op === 'assign') && ins.result) loopDefs.add(ins.result);
    }

    // Identify invariant binops
    const invariant = [];
    for (const ins of loopInstrs) {
      if (ins.op !== 'binop') continue;
      const a1ok = licmIsConst(ins.arg1) || !loopDefs.has(ins.arg1);
      const a2ok = licmIsConst(ins.arg2) || !loopDefs.has(ins.arg2);
      // Result must not be used as loop-carried dependency (simplified: result not in loopDefs excluding itself)
      const tmpDefs = new Set(loopDefs); tmpDefs.delete(ins.result);
      if (a1ok && a2ok && !tmpDefs.has(ins.result)) invariant.push(ins);
    }
    if (!invariant.length) continue;

    // Find header's first instruction in result array
    const headerBlock = blocks.find(b => b.id === header.id);
    if (!headerBlock || !headerBlock.instrs.length) continue;
    const firstHeaderInstr = headerBlock.instrs[0];

    // Move each invariant instruction before header
    const toInsert = [];
    for (const inv of invariant) {
      const idx = result.indexOf(inv);
      const hIdx = result.indexOf(firstHeaderInstr);
      if (idx === -1 || idx < hIdx) continue; // already before header or not found
      result.splice(idx, 1);
      toInsert.push(inv);
      changes.push({
        type: 'moved',
        before: instrToStr(inv) + '  [inside loop]',
        after:  instrToStr(inv) + '  [before loop]',
        note: `${inv.arg1} and ${inv.arg2} are loop-invariant`
      });
    }
    // Re-find header position after splices and insert
    const newHIdx = result.indexOf(firstHeaderInstr);
    if (newHIdx !== -1) result.splice(newHIdx, 0, ...toInsert);
    else result.unshift(...toInsert);
  }

  return {
    name: 'Loop Invariant Code Motion',
    description: 'Identifies expressions inside loops whose operands are never modified in the loop, and hoists them to a preheader block before the loop.',
    changes,
    instrs: result
  };
}

window.applyLICM      = applyLICM;
window.findBackEdges  = findBackEdges;
