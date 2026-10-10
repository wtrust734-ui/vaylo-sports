// ============================================================================
// VAYLO AD STUDIO — non-destructive revision history
// ----------------------------------------------------------------------------
// Every accepted edit becomes a Revision: an immutable document, the
// instruction that produced it, and a short summary of what changed. The store
// holds all of them and a pointer to HEAD.
//
// The four guarantees the brief asks for are properties of this file:
//
//   * NEVER OVERWRITE. Documents are immutable and every revision keeps its own.
//     Editing appends; nothing is replaced.
//   * UNDO / REDO / RESTORE. All three are pointer moves over documents that
//     still exist, so undo can never "lose" work and redo is always exact.
//   * A FAILED EDIT COSTS NOTHING. A provider failure is recorded as an attempt,
//     not a revision, and HEAD does not move. The last working asset is
//     therefore still on screen after a failure — by construction, not by
//     careful error handling at the call site.
//   * BRANCHING. Duplicating a version creates a new revision parented to that
//     version, so alternative cuts can be compared without one replacing the
//     other.
// ============================================================================

import { type AdDocument } from "./adDocument";

export interface Revision {
  id: string;
  /** The revision this one was edited from. `null` for the first. */
  parentId: string | null;
  createdAt: number;
  /** The full document at this point. Immutable — never mutated after commit. */
  doc: AdDocument;
  /** The natural-language instruction that produced this revision. */
  instruction: string;
  /** What actually changed, as reported to the athlete. */
  summary: string[];
  /** Ops that could not be applied, if any. Kept so the UI can be honest. */
  skipped: string[];
}

/** A failed edit. Recorded so it can be reported, but never part of history. */
export interface FailedAttempt {
  id: string;
  at: number;
  instruction: string;
  error: string;
}

export interface RevisionStore {
  /** All revisions, oldest first. Immutable documents, append-only. */
  revisions: Revision[];
  /** The revision currently on screen. */
  headId: string;
  /** Undo stack: revisions we stepped back from, newest last. */
  redoStack: string[];
  /** Provider failures, newest last. */
  failures: FailedAttempt[];
}

let counter = 0;
const revisionId = (): string => `rev_${(++counter).toString(36)}`;

/** Test seam so revision ids are reproducible. */
export const __resetRevisionIds = (): void => {
  counter = 0;
};

export const createStore = (doc: AdDocument, label = "Initial version", now = Date.now()): RevisionStore => {
  const first: Revision = {
    id: revisionId(),
    parentId: null,
    createdAt: now,
    doc,
    instruction: label,
    summary: [],
    skipped: [],
  };
  return { revisions: [first], headId: first.id, redoStack: [], failures: [] };
};

export const revisionById = (store: RevisionStore, id: string): Revision | undefined =>
  store.revisions.find((r) => r.id === id);

export const currentRevision = (store: RevisionStore): Revision =>
  revisionById(store, store.headId) ?? store.revisions[store.revisions.length - 1];

export const currentDoc = (store: RevisionStore): AdDocument => currentRevision(store).doc;

/**
 * Append an accepted edit.
 *
 * Committing clears the redo stack. That is standard editor behaviour and it is
 * the honest one: once you edit from a point, the future you had undone is no
 * longer reachable by "redo", and pretending otherwise would resurrect a
 * document that no longer follows from anything.
 */
export const commit = (
  store: RevisionStore,
  doc: AdDocument,
  instruction: string,
  summary: string[],
  skipped: string[] = [],
  now = Date.now(),
): RevisionStore => {
  const revision: Revision = {
    id: revisionId(),
    parentId: store.headId,
    createdAt: now,
    doc,
    instruction,
    summary,
    skipped,
  };
  return {
    ...store,
    revisions: [...store.revisions, revision],
    headId: revision.id,
    redoStack: [],
  };
};

/**
 * Record a failed edit.
 *
 * HEAD deliberately does not move and the redo stack is untouched, so the asset
 * on screen after a failure is exactly the asset that was on screen before it.
 */
export const recordFailure = (
  store: RevisionStore,
  instruction: string,
  error: string,
  now = Date.now(),
): RevisionStore => ({
  ...store,
  failures: [...store.failures, { id: `fail_${(++counter).toString(36)}`, at: now, instruction, error }],
});

export const canUndo = (store: RevisionStore): boolean =>
  revisionById(store, store.headId)?.parentId != null;

/** True when some other branch exists that we stepped back from. */
const childOf = (store: RevisionStore, id: string): Revision | undefined =>
  store.revisions.find((r) => r.parentId === id);

export const canRedo = (store: RevisionStore): boolean =>
  store.redoStack.length > 0 || childOf(store, store.headId) !== undefined;

/** Step back to the parent revision. Returns the store unchanged at the root. */
export const undo = (store: RevisionStore): RevisionStore => {
  const head = revisionById(store, store.headId);
  if (!head || head.parentId == null) return store;
  return { ...store, headId: head.parentId, redoStack: [...store.redoStack, head.id] };
};

/**
 * Step forward. Prefers a revision we explicitly stepped back from; otherwise
 * follows the first child, which is what makes redo work after switching
 * versions through `restore`.
 */
export const redo = (store: RevisionStore): RevisionStore => {
  if (store.redoStack.length > 0) {
    const redoStack = [...store.redoStack];
    const nextId = redoStack.pop() as string;
    return { ...store, headId: nextId, redoStack };
  }
  const child = childOf(store, store.headId);
  if (!child) return store;
  return { ...store, headId: child.id };
};

/** Jump to any revision in history. Undo can still step back out of it. */
export const restore = (store: RevisionStore, id: string): RevisionStore => {
  const target = revisionById(store, id);
  if (!target) return store;
  return { ...store, headId: target.id, redoStack: [] };
};

/**
 * Duplicate the current version as a new, independent revision to experiment
 * on. The copy is parented to the original, so the original is still one undo
 * away and neither version overwrites the other.
 */
export const duplicate = (store: RevisionStore, now = Date.now()): RevisionStore => {
  const head = currentRevision(store);
  return commit(store, head.doc, `Duplicated "${head.instruction}"`, ["Created an alternative version to experiment on."], [], now);
};

/** The accepted lineage from the root to HEAD, oldest first. */
export const lineage = (store: RevisionStore): Revision[] => {
  const chain: Revision[] = [];
  let cursor: Revision | undefined = currentRevision(store);
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.unshift(cursor);
    cursor = cursor.parentId ? revisionById(store, cursor.parentId) : undefined;
  }
  return chain;
};

/**
 * The pair the before/after control shows: what was on screen before the last
 * accepted edit, and what is on screen now.
 */
export const beforeAfter = (store: RevisionStore): { before: AdDocument | null; after: AdDocument } => {
  const head = currentRevision(store);
  const parent = head.parentId ? revisionById(store, head.parentId) : undefined;
  return { before: parent?.doc ?? null, after: head.doc };
};
