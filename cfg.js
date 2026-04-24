// ============================================================
//  CFG BUILDER  — Basic Block Identification + CFG edges
// ============================================================

/**
 * BasicBlock { id, name, instrs[], successors[], predecessors[] }
 */
function buildCFG(instrs) {
  const blocks = identifyBasicBlocks(instrs);
  linkBlocks(blocks);
  return blocks;
}

// ── Step 1: Identify leaders and split into blocks ───────────
function identifyBasicBlocks(instrs) {
  if (!instrs.length) return [];

  const leaders = new Set([0]);
  // Instructions that follow a branch or are jump targets are leaders
  for (let i = 0; i < instrs.length; i++) {
    const ins = instrs[i];
    if (ins.op === 'goto' || ins.op === 'if' || ins.op === 'return') {
      if (i + 1 < instrs.length) leaders.add(i + 1);
    }
    if (ins.op === 'label') leaders.add(i);
  }

  // Build label → index map
  const labelMap = {};
  instrs.forEach((ins, i) => {
    if (ins.op === 'label') labelMap[ins.label] = i;
  });
  // Jump targets are also leaders
  for (const ins of instrs) {
    if ((ins.op === 'goto' || ins.op === 'if') && ins.label in labelMap)
      leaders.add(labelMap[ins.label]);
  }

  const sortedLeaders = [...leaders].sort((a, b) => a - b);
  const blocks = [];

  for (let li = 0; li < sortedLeaders.length; li++) {
    const start = sortedLeaders[li];
    const end   = li + 1 < sortedLeaders.length ? sortedLeaders[li + 1] : instrs.length;
    const blockInstrs = instrs.slice(start, end);
    const blockId = li;

    // Name: use label if first instr is a label, else B0 B1 ...
    let name = `Block${blockId}`;
    if (blockInstrs.length && blockInstrs[0].op === 'label')
      name = blockInstrs[0].label;

    blocks.push({
      id: blockId,
      name,
      instrs: blockInstrs,
      successors: [],
      predecessors: [],
      startIdx: start,
      endIdx: end - 1
    });
  }

  return blocks;
}

// ── Step 2: Link blocks via successors/predecessors ──────────
function linkBlocks(blocks) {
  if (!blocks.length) return;

  // Build name → block map
  const nameMap = {};
  blocks.forEach(b => {
    nameMap[b.name] = b;
    // Also map by label in first instruction
    if (b.instrs.length && b.instrs[0].op === 'label')
      nameMap[b.instrs[0].label] = b;
  });

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block.instrs.length) continue;
    const last = block.instrs[block.instrs.length - 1];

    if (last.op === 'goto') {
      const target = findBlockByLabel(blocks, last.label);
      if (target) addEdge(block, target);
    } else if (last.op === 'if') {
      // true branch
      const target = findBlockByLabel(blocks, last.label);
      if (target) addEdge(block, target);
      // fall-through
      if (i + 1 < blocks.length) addEdge(block, blocks[i + 1]);
    } else if (last.op === 'return') {
      // no successors
    } else {
      // fall-through to next block
      if (i + 1 < blocks.length) addEdge(block, blocks[i + 1]);
    }
  }
}

function findBlockByLabel(blocks, label) {
  for (const b of blocks) {
    if (b.name === label) return b;
    if (b.instrs.length && b.instrs[0].op === 'label' && b.instrs[0].label === label) return b;
  }
  return null;
}

function addEdge(from, to) {
  if (!from.successors.find(s => s.id === to.id)) from.successors.push(to);
  if (!to.predecessors.find(p => p.id === from.id)) to.predecessors.push(from);
}

// ── Export ───────────────────────────────────────────────────
window.buildCFG = buildCFG;
