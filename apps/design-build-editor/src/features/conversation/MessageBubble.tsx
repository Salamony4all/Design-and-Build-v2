// features/conversation/MessageBubble.tsx — renders rich message bubbles with attachments and photoreal cards.
'use client';
import React, { useState } from 'react';
import { FileText, Image as ImageIcon, Sparkles } from 'lucide-react';
import type { AttachmentRef } from 'design-build-conversation-core';
import type { RenderResult } from 'design-build-render-orchestrator';
import { RenderResultCard } from './RenderResultCard';
import { attachmentRepository } from './attachment-repository';

export interface MessageBubbleProps {
  role: 'user' | 'assistant';
  text: string;
  attachments?: AttachmentRef[];
  renderResult?: RenderResult;
  onOpenLightbox?: (imgUrl: string, title: string) => void;
  onIteratePrompt?: (prompt: string) => void;
}

export function MessageBubble({
  role,
  text,
  attachments,
  renderResult,
  onOpenLightbox,
  onIteratePrompt,
}: MessageBubbleProps) {
  return (
    <div className={`db-bubble ${role}`}>
      {/* User attachment thumbnails */}
      {attachments && attachments.length > 0 && (
        <div className="db-bubble-attachments">
          {attachments.map((a) => (
            <div key={a.id} className="db-bubble-attach-pill">
              {a.kind === 'pdf' ? (
                <FileText className="w-3.5 h-3.5 text-blue-400" />
              ) : (
                <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />
              )}
              <span className="font-semibold text-xs">{a.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Main Text Content */}
      {text && <p className="db-bubble-text">{text}</p>}

      {/* Rich Photorealistic Render Card if attached */}
      {renderResult && (
        <div className="db-bubble-render-wrap">
          <RenderResultCard
            result={renderResult}
            onOpenLightbox={onOpenLightbox}
            onIteratePrompt={onIteratePrompt}
          />
        </div>
      )}
    </div>
  );
}

export default MessageBubble;
