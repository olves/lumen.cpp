'use strict';
// Line diff for the coding agent's change cards: hunks with context lines, like `diff -u`. Lines are compared without their
// endings (CRLF and LF are the same line). An agent edit changes a small region, so the common prefix and suffix are trimmed
// first and an LCS runs only on the middle; a very large middle falls back to "all removed, all added".
const MAX_CELLS = 4e6;

function split(text) { const s = String(text ?? ''); if (s === '') return []; const parts = s.split(/\r?\n/); if (parts.at(-1) === '') parts.pop(); return parts; }

function diffLines(before, after, { context = 3 } = {}) {
  const a = split(before), b = split(after);
  let start = 0; while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length; while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  // ops: [type, oldIndex, newIndex] over the whole files ('=' kept, '-' removed, '+' added)
  const ops = [];
  for (let i = 0; i < start; i++) ops.push(['=', i, i]);
  const midA = a.slice(start, endA), midB = b.slice(start, endB);
  if (midA.length && midB.length && (midA.length + 1) * (midB.length + 1) <= MAX_CELLS) {
    const n = midA.length, m = midB.length, w = m + 1, table = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i * w + j] = midA[i] === midB[j] ? table[(i + 1) * w + j + 1] + 1 : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { ops.push(['=', start + i, start + j]); i++; j++; }
      else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) { ops.push(['-', start + i, start + j]); i++; }
      else { ops.push(['+', start + i, start + j]); j++; }
    }
    for (; i < n; i++) ops.push(['-', start + i, start + m]);
    for (; j < m; j++) ops.push(['+', start + n, start + j]);
  } else {
    for (let i = 0; i < midA.length; i++) ops.push(['-', start + i, start]);
    for (let j = 0; j < midB.length; j++) ops.push(['+', endA, start + j]);
  }
  for (let i = endA, j = endB; i < a.length; i++, j++) ops.push(['=', i, j]);

  let added = 0, removed = 0; const hunks = [];
  const changed = ops.map(op => op[0] !== '=');
  for (let k = 0; k < ops.length; k++) {
    if (!changed[k]) continue;
    // Grow a hunk around this change until `2 * context` unchanged lines separate it from the next one.
    let first = Math.max(0, k - context), last = k;
    for (let q = k + 1; q < ops.length; q++) { if (changed[q]) last = q; else if (q - last > 2 * context) break; }
    const end = Math.min(ops.length - 1, last + context);
    const lines = [];
    for (let q = first; q <= end; q++) {
      const [t, i, j] = ops[q];
      if (t === '=') lines.push({ t: ' ', s: a[i] }); else if (t === '-') { lines.push({ t: '-', s: a[i] }); removed++; } else { lines.push({ t: '+', s: b[j] }); added++; }
    }
    hunks.push({ oldStart: ops[first][1] + 1, newStart: ops[first][2] + 1, lines });
    k = end;
  }
  return { added, removed, hunks };
}

module.exports = { diffLines };
