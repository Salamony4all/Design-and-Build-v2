// design-build-attachment-service
// §12 — attachment / reference repository. Multi-attachment support, per-item
// enable/disable, explicit order, and client-side preview metadata (NO base64
// blobs pushed into React state — the File/Blob lives in the clean repo; the
// reference carries only preview info + a generated id for the active run).
// Migrates the legacy ReferenceImage (apps/editor/src/types/messages.ts) shape
// and the ChatBox attachments[]/references[] mutation behavior.

export type AttachmentKind = 'pdf' | 'png' | 'jpeg' | 'other';

export interface AttachmentReference {
  id: string;
  name: string;
  mimeType: string;
  kind: AttachmentKind;
  enabled: boolean;
  /** 0-based order in the attachment set. */
  order: number;
  /** Client-side preview (object URL or small thumbnail) — never the raw blob. */
  previewUrl?: string;
  sizeBytes?: number;
  createdAt: string;
}

export interface AttachmentRepositoryState {
  /** Ordered list of attachments; `order` mirrors array index but is explicit. */
  items: AttachmentReference[];
}

export function createEmptyRepository(): AttachmentRepositoryState {
  return { items: [] };
}

export function addAttachment(
  state: AttachmentRepositoryState,
  ref: Omit<AttachmentReference, 'order' | 'createdAt'>,
): AttachmentRepositoryState {
  const order = state.items.length;
  const item: AttachmentReference = {
    ...ref,
    order,
    createdAt: new Date().toISOString(),
  };
  const items = [...state.items, item].sort((a, b) => a.order - b.order);
  return { items: reindex(items) };
}

export function setEnabled(
  state: AttachmentRepositoryState,
  id: string,
  enabled: boolean,
): AttachmentRepositoryState {
  return { items: state.items.map((it) => (it.id === id ? { ...it, enabled } : it)) };
}

export function removeAttachment(state: AttachmentRepositoryState, id: string): AttachmentRepositoryState {
  return { items: reindex(state.items.filter((it) => it.id !== id)) };
}

/** Move an item to a new 0-based position, preserving enabled flags. */
export function reorder(state: AttachmentRepositoryState, id: string, toIndex: number): AttachmentRepositoryState {
  const from = state.items.findIndex((it) => it.id === id);
  if (from === -1) return state;
  const items = [...state.items];
  const [moved] = items.splice(from, 1);
  const clamped = Math.max(0, Math.min(toIndex, items.length));
  items.splice(clamped, 0, moved);
  return { items: reindex(items) };
}

/** Only enabled attachments, in order — the set sent to the extraction run. */
export function getActiveAttachments(state: AttachmentRepositoryState): AttachmentReference[] {
  return state.items.filter((it) => it.enabled).sort((a, b) => a.order - b.order);
}

function reindex(items: AttachmentReference[]): AttachmentReference[] {
  // Reindex in the array's CURRENT visual order (no re-sort) so explicit
  // reordering via splice positions is preserved.
  return items.map((it, i) => ({ ...it, order: i }));
}

export function kindFromMime(mimeType: string): AttachmentKind {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return 'jpeg';
  return 'other';
}
