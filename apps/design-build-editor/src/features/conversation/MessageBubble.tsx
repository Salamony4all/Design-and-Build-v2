// features/conversation/MessageBubble.tsx
'use client';
import React from 'react';

export function MessageBubble({ role, text }: { role: 'user' | 'assistant'; text: string }) {
  return (
    <div className={`db-bubble ${role}`}>
      <p style={{ margin: 0 }}>{text}</p>
    </div>
  );
}
