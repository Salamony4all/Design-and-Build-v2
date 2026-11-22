// features/conversation/AttachmentGallery.tsx — reference/attachment trigger.
// Bytes go to the clean attachment repository; only metadata leaves this
// component (no Base64 duplicates in React state).
'use client';
import React, { useRef } from 'react';
import { Plus } from 'lucide-react';
import type { AttachmentRef } from 'design-build-conversation-core';
import { attachmentRepository } from './attachment-repository';

export function AttachmentGallery({ onAttach }: { onAttach: (ref: AttachmentRef) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="db-attach-gallery">
      <button
        type="button"
        className="db-gemini-add-btn"
        aria-label="Add drawing or reference image"
        title="Add drawing or reference image"
        onClick={() => fileRef.current?.click()}
      >
        <Plus className="w-4 h-4 text-slate-700" />
      </button>
      <input
        ref={fileRef}
        type="file"
        hidden
        multiple
        accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
        onChange={(e) => {
          Array.from(e.target.files ?? []).forEach((f) => {
            const id = crypto.randomUUID();
            const isPdf = f.type.includes('pdf') || /\.pdf$/i.test(f.name);
            attachmentRepository.put(id, f);
            onAttach({
              id,
              kind: isPdf ? 'pdf' : 'image',
              name: f.name,
              byteSize: f.size,
              mime: f.type || (isPdf ? 'application/pdf' : 'application/octet-stream'),
            });
          });
          e.target.value = '';
        }}
      />
    </div>
  );
}

export default AttachmentGallery;
