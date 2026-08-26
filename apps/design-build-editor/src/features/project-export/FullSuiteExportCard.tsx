// features/project-export/FullSuiteExportCard.tsx
'use client';
import React from 'react';

export function FullSuiteExportCard({ visible }: { visible: boolean }) {
  if (!visible) return null;
  const tree = [
    'Project_Name/', '  BOQ/ Detailed_BOQ.xlsx, BOQ_Summary.pdf',
    '  Drawings/ Source_Drawing.pdf, Extracted_Plan.png, Annotated_Plan.png',
    '  Presentation/ Design_and_Build_Presentation.pptx',
    '  FF&E/ FF&E_Schedule.xlsx, Mood_Board.pdf, Catalogue_Links.xlsx',
    '  Renders/ Perspective_01.png', '  Model/ Pascal_Scene.json',
    '  Reports/ Extraction_Audit.pdf',
  ];
  return (
    <aside className="db-export glass" aria-label="Full suite structure">
      <h4>Full Design & Build Package</h4>
      <pre style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--muted)', whiteSpace: 'pre-wrap', margin: 0 }}>
        {tree.join('\n')}
      </pre>
      <p className="db-pending-note">Structure shown for review. Generation pending provider migration.</p>
    </aside>
  );
}
