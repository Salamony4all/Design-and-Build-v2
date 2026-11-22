// features/conversation/MessageList.tsx — renders typed ChatEvents as rich messages & render cards.
'use client';
import React, { useState } from 'react';
import type { ChatEvent } from 'design-build-conversation-core';
import { MessageBubble } from './MessageBubble';
import { RenderResultCard } from './RenderResultCard';
import { RenderLightboxModal } from './RenderLightboxModal';

export interface MessageListProps {
  events: ChatEvent[];
  onIteratePrompt?: (prompt: string) => void;
}

export function MessageList({ events, onIteratePrompt }: MessageListProps) {
  const [lightboxState, setLightboxState] = useState<{ open: boolean; url: string; title: string }>({
    open: false,
    url: '',
    title: '',
  });

  const visible = events.filter((e) => e.type === 'message' || e.type === 'error' || e.type === 'render-complete');

  return (
    <>
      <div className="db-messages" role="log" aria-live="polite">
        {visible.map((e, i) => {
          if (e.type === 'message') {
            return (
              <MessageBubble
                key={e.id || `msg_${i}`}
                role={e.role}
                text={e.text}
                attachments={e.attachments}
                renderResult={e.renderResult}
                onOpenLightbox={(url, title) => setLightboxState({ open: true, url, title })}
                onIteratePrompt={onIteratePrompt}
              />
            );
          }
          if (e.type === 'render-complete') {
            return (
              <div key={`rc_${i}`} className="db-render-complete-event-wrap">
                <RenderResultCard
                  result={e.result}
                  onOpenLightbox={(url, title) => setLightboxState({ open: true, url, title })}
                  onIteratePrompt={onIteratePrompt}
                />
              </div>
            );
          }
          return (
            <div key={`err_${i}`} className="db-error-bubble" role="alert">
              ⚠ {e.message}
            </div>
          );
        })}
      </div>

      {/* Lightbox Modal */}
      {lightboxState.open && (
        <RenderLightboxModal
          imageUrl={lightboxState.url}
          title={lightboxState.title}
          onClose={() => setLightboxState({ open: false, url: '', title: '' })}
        />
      )}
    </>
  );
}

export default MessageList;
