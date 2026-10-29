// buildFileTree nests diff files by directory, collapsing single-child directory chains (`a/b/c/`) into one node.
export function buildFileTree(files) {
  const root = newDir();
  for (const file of files) {
    const parts = file.path.split('/');
    const name = parts.pop();
    let dir = root;
    for (const p of parts) {
      if (!dir.dirs.has(p)) dir.dirs.set(p, newDir());
      dir = dir.dirs.get(p);
    }
    dir.files.push({ name, file });
  }
  return toNodes(root, '', 0);
}

function newDir() { return { dirs: new Map(), files: [] }; }

// A dir sorts as `name/` so siblings come out in git's bytewise full-path order.
function toNodes(dir, prefix, depth) {
  const nodes = [];
  for (const [name, sub] of dir.dirs) {
    let label = name;
    let d = sub;
    while (d.files.length === 0 && d.dirs.size === 1) {
      const [[next, child]] = d.dirs;
      label += `/${next}`;
      d = child;
    }
    const path = prefix + label;
    const children = toNodes(d, `${path}/`, depth + 1);
    nodes.push({
      kind: 'dir', name: label, path, depth, children, sortKey: `${label}/`,
      add: children.reduce((n, c) => n + c.add, 0),
      del: children.reduce((n, c) => n + c.del, 0),
    });
  }
  for (const { name, file } of dir.files) {
    const { add, del } = countRows(file);
    nodes.push({ kind: 'file', name, depth, file, add, del, sortKey: name });
  }
  return nodes.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
}

function countRows(file) {
  let add = 0; let del = 0;
  for (const h of file.hunks ?? []) for (const r of h.rows ?? []) {
    if (r.op === '+') add++; else if (r.op === '-') del++;
  }
  return { add, del };
}
