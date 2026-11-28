// features/project-export/FullSuiteExportCard.tsx
'use client';
import React from 'react';

export function FullSuiteExportCard({ visible }: { visible: boolean }) {
  if (!visible) return null;
  const tree = [
    'Project_Name/',
    '  BOQ/ Detailed_BOQ.xlsx, BOQ_Summary.pdf',
    '  Submittals/ MAS.pdf, MIR.pdf, WIR.pdf, Delivery_Note.pdf',
    '  Programme/ Action_and_Project_Plan.xlsx, MS_Project_Schedule.xml',
    '  Drawings/ Source_Drawing.pdf, Extracted_Plan.png, Annotated_Plan.png',
    '  Presentation/ Design_and_Build_Presentation.pptx',
    '  FF&E/ FF&E_Schedule.xlsx, Mood_Board.pdf',
    '  Renders/ Perspective_01.png',
    '  Model/ Pascal_Scene.json',
    '  Reports/ Extraction_Audit.pdf',
  ];
  return (
    <aside className="db-export glass" aria-label="Full suite structure">
      <h4>Full Design & Build Package</h4>
      <pre style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--muted)', whiteSpace: 'pre-wrap', margin: 0 }}>
        {tree.join('\n')}
      </pre>
    </aside>
  );
}
