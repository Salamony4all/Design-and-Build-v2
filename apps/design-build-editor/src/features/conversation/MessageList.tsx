// features/conversation/MessageList.tsx — renders typed ChatEvents as messages.
'use client';
import React from 'react';
import type { ChatEvent } from 'design-build-conversation-core';
import { MessageBubble } from './MessageBubble';

export function MessageList({ events }: { events: ChatEvent[] }) {
  const visible = events.filter((e) => e.type === 'message' || e.type === 'error');
  return (
    <div className="db-messages" role="log" aria-live="polite">
      {visible.map((e, i) =>
        e.type === 'message'
          ? <MessageBubble key={e.id} role={e.role} text={e.text} />
          : <div key={`err_${i}`} className="db-error-bubble" role="alert">⚠ {e.message}</div>
      )}
    </div>
  );
}
