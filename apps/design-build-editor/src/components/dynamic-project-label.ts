export function projectLabelFromFiles(files: Array<{name:string}>, extracted?: {projectName?:string; drawingNumber?:string}) {
  const clean=(v:string)=>v.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();
  if (extracted?.projectName) return extracted.drawingNumber ? `${extracted.projectName} — ${extracted.drawingNumber}` : extracted.projectName;
  if (files.length === 1) return clean(files[0].name) || 'Untitled drawing';
  if (files.length > 1) return `${clean(files[0].name) || 'Project'} + ${files.length-1} more file${files.length>2?'s':''}`;
  return 'Untitled project';
}
