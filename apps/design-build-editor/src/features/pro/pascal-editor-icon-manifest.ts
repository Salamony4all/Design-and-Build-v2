// pascal-editor-icon-manifest.ts
//
// The EXACT finite set of Iconify icons the installed @pascal-app/editor@0.9.2
// shell (and the @pascal-app/nodes@0.1.1 components it renders) reference via
// <Icon icon="prefix:name" /> — extracted from the RESOLVED package sources that
// actually run at runtime (editor/src has no compiled dist; nodes ships dist).
// This includes variable-assigned icon props, not just literal icon="...".
//
// This list is the authoritative source used by:
//   - scripts/regen-pro-icons.cjs       -> regenerates pascal-editor-icon-data.json
//   - registerPascalEditorIcons()        -> addCollection() for each entry
//
// Only these curated names are bundled so the official Editor NEVER hits the
// public api.iconify.design endpoint. Do NOT add unrelated icons. Do NOT patch
// @pascal-app/editor or node_modules.

export const PASCAL_EDITOR_ICONS: readonly string[] = [
  // editor (carbon / charm / lucide / mdi / ph / qlementine-icons)
  'carbon:cut-out',
  'charm:stack-pop',
  'charm:stack-push',
  'lucide:ban',
  'lucide:box',
  'lucide:circle-check',
  'lucide:copy',
  'lucide:copy-plus',
  'lucide:fence',
  'lucide:grid-2x2',
  'lucide:magnet',
  'lucide:minus',
  'lucide:mouse-pointer-click',
  'lucide:palette',
  'lucide:rectangle-horizontal',
  'lucide:repeat',
  'lucide:ruler',
  'lucide:scan',
  'lucide:space',
  'lucide:spline',
  'lucide:square',
  'lucide:swatch-book',
  'lucide:table-2',
  'lucide:target',
  'lucide:triangle',
  'lucide:waypoints',
  'lucide:x',
  'mdi:cancel',
  'mdi:eraser-variant',
  'mdi:select-drag',
  'mdi:trash-can-outline',
  'ph:arrow-fat-up',
  'ph:mouse-left-click-fill',
  'ph:mouse-right-click-fill',
  'qlementine-icons:mouse-middle-button-16',
];
