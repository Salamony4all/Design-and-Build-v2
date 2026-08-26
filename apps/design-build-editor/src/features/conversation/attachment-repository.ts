// features/conversation/attachment-repository.ts
// Clean attachment repository (Change Set 2 activation, §1).
// The REAL File/Blob bytes live here, module-scoped — NOT duplicated as
// Base64 copies inside React state. React state carries only AttachmentRef
// metadata (id, name, mime, size). The extraction boundary reads bytes from
// this repository by attachment id.

const files = new Map<string, File>();

export const attachmentRepository = {
  put(id: string, file: File): void {
    files.set(id, file);
  },
  get(id: string): File | undefined {
    return files.get(id);
  },
  remove(id: string): void {
    files.delete(id);
  },
  has(id: string): boolean {
    return files.has(id);
  },
  /** Read the raw bytes of a stored attachment (undefined if missing). */
  async bytes(id: string): Promise<Uint8Array | undefined> {
    const f = files.get(id);
    if (!f) return undefined;
    return new Uint8Array(await f.arrayBuffer());
  },
};
