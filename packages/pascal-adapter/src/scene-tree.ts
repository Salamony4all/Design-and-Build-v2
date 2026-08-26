// design-build-pascal-adapter — scene-tree mutation layer.
//
// THE ONLY place that is permitted to mutate parent/child relationships in the
// Pascal scene graph. Every helper below maintains BOTH sides of the contract
// that Pascal 0.9.2 rendering requires:
//   - child.parentId        (the child's own pointer)
//   - parent.children        (the parent's ordered child list)
// No UI component or extraction provider may update these fields directly; they
// must call through this module so the bidirectional agreement can never drift.
//
// These helpers operate on a plain `Record<string, AnyNode>` working copy and
// return a NEW nodes map (immutable update) so callers can feed it straight into
// useScene.setScene without mutating shared state.

import type { AnyNode } from '@pascal-app/core';

export type NodeMap = Record<string, AnyNode>;

export interface SceneTreeValidationIssue {
  code:
    | 'INVALID_ROOT'
    | 'MISSING_PARENT'
    | 'CHILD_NOT_IN_PARENT'
    | 'PARENT_NOT_IN_CHILD'
    | 'DUPLICATE_CHILD'
    | 'CYCLE'
    | 'UNREACHABLE'
    | 'DOOR_WINDOW_NOT_WALL_HOSTED'
    | 'UNREACHABLE_DIRTY';
  message: string;
  nodeId?: string;
  relatedId?: string;
}

export interface SceneTreeValidationResult {
  ok: boolean;
  issues: SceneTreeValidationIssue[];
  roots: string[];
  reachable: Set<string>;
  childOf: Record<string, string | null>;
  childrenOf: Record<string, string[]>;
}

// ---- internal helpers -------------------------------------------------------

function childArray(node: AnyNode | undefined): string[] {
  if (!node) return [];
  const c = (node as { children?: unknown }).children;
  return Array.isArray(c) ? (c as string[]) : [];
}

function withChild(parent: AnyNode, childId: string): AnyNode {
  const cur = childArray(parent);
  if (cur.includes(childId)) return parent;
  return { ...parent, children: [...cur, childId] } as AnyNode;
}

function withoutChild(parent: AnyNode, childId: string): AnyNode {
  const cur = childArray(parent);
  if (!cur.includes(childId)) return parent;
  return { ...parent, children: cur.filter((c) => c !== childId) } as AnyNode;
}

// ---- public mutation API ----------------------------------------------------

/**
 * Append `childId` under `parentId`, updating BOTH child.parentId and
 * parent.children. Returns a new nodes map (immutable).
 */
export function appendChild(nodes: NodeMap, parentId: string, childId: string): NodeMap {
  const parent = nodes[parentId];
  const child = nodes[childId];
  if (!parent || !child) {
    throw new Error(`appendChild: missing node parent=${parentId} child=${childId}`);
  }
  return {
    ...nodes,
    [parentId]: withChild(parent, childId),
    [childId]: { ...child, parentId } as AnyNode,
  };
}

/** Remove `childId` from `parentId`, clearing both sides. */
export function removeChild(nodes: NodeMap, parentId: string, childId: string): NodeMap {
  const parent = nodes[parentId];
  const child = nodes[childId];
  const next = { ...nodes };
  if (parent) next[parentId] = withoutChild(parent, childId);
  if (child) next[childId] = { ...child, parentId: null } as AnyNode;
  return next;
}

/**
 * Move `childId` from its current parent (resolved from child.parentId) to
 * `newParentId`. Both sides updated on both ends.
 */
export function moveChild(nodes: NodeMap, childId: string, newParentId: string): NodeMap {
  const child = nodes[childId];
  const newParent = nodes[newParentId];
  if (!child || !newParent) {
    throw new Error(`moveChild: missing node child=${childId} newParent=${newParentId}`);
  }
  const oldParentId = (child as { parentId?: string | null }).parentId ?? null;
  let next = { ...nodes };
  if (oldParentId && next[oldParentId]) {
    next[oldParentId] = withoutChild(next[oldParentId], childId);
  }
  next[newParentId] = withChild(newParent, childId);
  next[childId] = { ...child, parentId: newParentId } as AnyNode;
  return next;
}

/**
 * Replace the entire children list of `parentId` with `childIds`, rewriting
 * every affected child's parentId (clearing parents of removed children, setting
 * the parent of added children).
 */
export function replaceChildren(nodes: NodeMap, parentId: string, childIds: string[]): NodeMap {
  const parent = nodes[parentId];
  if (!parent) throw new Error(`replaceChildren: missing parent ${parentId}`);
  const prev = childArray(parent);
  const wanted = [...new Set(childIds)];
  let next = { ...nodes };
  // detach old children no longer listed
  for (const oldId of prev) {
    if (!wanted.includes(oldId) && next[oldId]) {
      next[oldId] = { ...(next[oldId] as AnyNode), parentId: null } as AnyNode;
    }
  }
  // attach new children
  for (const id of wanted) {
    if (next[id]) next[id] = { ...(next[id] as AnyNode), parentId } as AnyNode;
  }
  next[parentId] = { ...parent, children: wanted } as AnyNode;
  return next;
}

// ---- validation -------------------------------------------------------------

/**
 * Validate the full parent/child contract of a node map.
 * Checks: valid roots, parent refs, child refs, bidirectional agreement,
 * duplicate children, cycles, reachability from roots, door/window hosted by
 * walls, and unreachable dirty nodes.
 */
export function validateSceneTree(
  nodes: NodeMap,
  opts: { rootNodeIds?: string[]; dirtyNodeIds?: string[] } = {},
): SceneTreeValidationResult {
  const issues: SceneTreeValidationIssue[] = [];
  const childOf: Record<string, string | null> = {};
  const childrenOf: Record<string, string[]> = {};

  const ids = Object.keys(nodes);
  for (const id of ids) {
    const n = nodes[id] as unknown as AnyNode | undefined;
    childOf[id] = (n?.parentId ?? null) as string | null;
    childrenOf[id] = childArray(n);
  }

  // 1. valid roots
  const declaredRoots = opts.rootNodeIds ?? ids.filter((id) => !childOf[id]);
  const roots: string[] = [];
  for (const r of declaredRoots) {
    if (!nodes[r]) { issues.push({ code: 'INVALID_ROOT', message: `declared root ${r} missing`, nodeId: r }); continue; }
    if (childOf[r]) { issues.push({ code: 'INVALID_ROOT', message: `root ${r} has a parent`, nodeId: r, relatedId: childOf[r]! }); continue; }
    roots.push(r);
  }

  // 2. parent references exist + 3. bidirectional agreement + 5. duplicates
  for (const id of ids) {
    const pid = childOf[id];
    if (pid) {
      if (!nodes[pid]) {
        issues.push({ code: 'MISSING_PARENT', message: `node ${id} parent ${pid} missing`, nodeId: id, relatedId: pid });
      } else if (!childrenOf[pid].includes(id)) {
        issues.push({ code: 'PARENT_NOT_IN_CHILD', message: `parent ${pid} does not list ${id}`, nodeId: id, relatedId: pid });
      } else {
        const seen = new Set<string>();
        for (const c of childrenOf[pid]) {
          if (seen.has(c)) issues.push({ code: 'DUPLICATE_CHILD', message: `duplicate child ${c} under ${pid}`, nodeId: pid, relatedId: c });
          seen.add(c);
        }
      }
    }
    for (const c of childrenOf[id]) {
      if (!nodes[c]) issues.push({ code: 'CHILD_NOT_IN_PARENT', message: `child ${c} of ${id} missing`, nodeId: id, relatedId: c });
      else if (childOf[c] !== id) issues.push({ code: 'CHILD_NOT_IN_PARENT', message: `child ${c} parentId=${childOf[c]} != ${id}`, nodeId: id, relatedId: c });
    }
  }

  // 4. cycle detection (DFS) + 6. reachability
  const reachable = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (reachable.has(id) || visiting.has(id)) return;
    visiting.add(id);
    for (const c of childrenOf[id]) {
      if (visiting.has(c)) issues.push({ code: 'CYCLE', message: `cycle involving ${c}`, nodeId: c });
      else if (nodes[c]) visit(c);
    }
    visiting.delete(id);
    reachable.add(id);
  };
  for (const r of roots) visit(r);
  for (const id of ids) {
    if (childOf[id] && !reachable.has(id)) {
      issues.push({ code: 'UNREACHABLE', message: `node ${id} not reachable from any root`, nodeId: id, relatedId: childOf[id] ?? undefined });
    }
  }

  // 7. doors / windows parented to walls
  for (const id of ids) {
    const t = (nodes[id] as { type?: string }).type;
    if (t === 'door' || t === 'window') {
      const pid = childOf[id];
      const pt = pid ? (nodes[pid] as { type?: string }).type : undefined;
      if (pt !== 'wall') {
        issues.push({ code: 'DOOR_WINDOW_NOT_WALL_HOSTED', message: `${t} ${id} hosted by ${pt ?? 'none'} (expected wall)`, nodeId: id, relatedId: pid ?? undefined });
      }
    }
  }

  // 8. unreachable dirty nodes
  for (const d of opts.dirtyNodeIds ?? []) {
    if (!reachable.has(d)) issues.push({ code: 'UNREACHABLE_DIRTY', message: `dirty node ${d} is unreachable`, nodeId: d });
  }

  return { ok: issues.length === 0, issues, roots, reachable, childOf, childrenOf };
}
