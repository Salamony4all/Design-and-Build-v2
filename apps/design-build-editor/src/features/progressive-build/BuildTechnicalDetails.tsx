// features/progressive-build/BuildTechnicalDetails.tsx
'use client';
import React from 'react';

export function BuildTechnicalDetails({ data }: { data?: Record<string, unknown> }) {
  if (!data || Object.keys(data).length === 0) return null;
  return (
    <div className="db-rail-details" style={{ flexDirection: 'column', gap: 2, marginTop: 10 }}>
      {Object.entries(data).map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{k}</span><b>{String(v)}</b>
        </div>
      ))}
    </div>
  );
}
