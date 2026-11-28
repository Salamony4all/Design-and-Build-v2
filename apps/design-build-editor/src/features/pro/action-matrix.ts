// features/pro/action-matrix.ts
// Type-safe contextual action capability matrix by semantic node type.

export const ACTION_FLAGS = {
  PASCAL_ITEM_CONTEXT_ACTIONS: true,
  PASCAL_GUIDE_CONTEXT_ACTIONS: true,
  PASCAL_SLAB_CONTEXT_ACTIONS: true,
  PASCAL_DOOR_CONTEXT_ACTIONS: true,
  PASCAL_WINDOW_CONTEXT_ACTIONS: true,
  PASCAL_WALL_CONTEXT_ACTIONS: true,
  PASCAL_REHOST_ACTIONS: true,
};

export const CURRENT_BUILD_INFO = {
  buildId: 'live-prod-build-v2',
  commit: 'feat(editor-pro): add explicit hosted-opening rehost mode',
  itemRotationFeatureEnabled: true,
  flags: ACTION_FLAGS,
};

export type SemanticNodeType =
  | 'item'
  | 'guide'
  | 'slab'
  | 'wall'
  | 'door'
  | 'window'
  | string;

export interface ContextualAction {
  id: string;
  label: string;
  icon: string;
  enabled: boolean;
  tooltip: string;
  disabledReason?: string;
}

export function getSemanticActionsForNode(
  nodeType?: string | null,
  context?: {
    hasHostedChildren?: boolean;
    isOnlyGuide?: boolean;
    hasAdjacentWall?: boolean;
  },
): ContextualAction[] {
  if (!nodeType) return [];

  switch (nodeType) {
    case 'item':
      return [
        { id: 'move', label: 'Move', icon: 'Move', enabled: ACTION_FLAGS.PASCAL_ITEM_CONTEXT_ACTIONS, tooltip: 'Move item' },
        { id: 'duplicate', label: 'Duplicate', icon: 'Copy', enabled: ACTION_FLAGS.PASCAL_ITEM_CONTEXT_ACTIONS, tooltip: 'Duplicate item with small offset' },
        { id: 'rotate-left-90', label: 'Rotate Left', icon: 'RotateCcw', enabled: ACTION_FLAGS.PASCAL_ITEM_CONTEXT_ACTIONS, tooltip: 'Rotate Left 90° (counter-clockwise)' },
        { id: 'rotate-right-90', label: 'Rotate Right', icon: 'RotateCw', enabled: ACTION_FLAGS.PASCAL_ITEM_CONTEXT_ACTIONS, tooltip: 'Rotate Right 90° (clockwise)' },
        { id: 'delete', label: 'Delete', icon: 'Trash2', enabled: ACTION_FLAGS.PASCAL_ITEM_CONTEXT_ACTIONS, tooltip: 'Delete item' },
      ];

    case 'guide':
      return [
        { id: 'move', label: 'Move Reference', icon: 'Move', enabled: ACTION_FLAGS.PASCAL_GUIDE_CONTEXT_ACTIONS, tooltip: 'Transform / Move guide plane' },
        { id: 'opacity', label: 'Opacity', icon: 'Sliders', enabled: ACTION_FLAGS.PASCAL_GUIDE_CONTEXT_ACTIONS, tooltip: 'Adjust guide opacity' },
        { id: 'nudge-menu', label: 'Nudge / Scale', icon: 'Compass', enabled: ACTION_FLAGS.PASCAL_GUIDE_CONTEXT_ACTIONS, tooltip: 'Precision nudge and scale' },
        { id: 'invert', label: 'Invert Orientation', icon: 'FlipVertical', enabled: ACTION_FLAGS.PASCAL_GUIDE_CONTEXT_ACTIONS, tooltip: 'Invert guide texture orientation' },
        { id: 'rotate-left-90', label: 'Rotate Left', icon: 'RotateCcw', enabled: ACTION_FLAGS.PASCAL_GUIDE_CONTEXT_ACTIONS, tooltip: 'Rotate guide plane 90° CCW' },
        { id: 'rotate-right-90', label: 'Rotate Right', icon: 'RotateCw', enabled: ACTION_FLAGS.PASCAL_GUIDE_CONTEXT_ACTIONS, tooltip: 'Rotate guide plane 90° CW' },
        { id: 'visibility-toggle', label: 'Visibility', icon: 'Eye', enabled: ACTION_FLAGS.PASCAL_GUIDE_CONTEXT_ACTIONS, tooltip: 'Toggle guide visibility' },
        { id: 'duplicate', label: 'Duplicate Reference', icon: 'Copy', enabled: ACTION_FLAGS.PASCAL_GUIDE_CONTEXT_ACTIONS, tooltip: 'Duplicate guide plane' },
        { id: 'delete', label: 'Delete Reference', icon: 'Trash2', enabled: ACTION_FLAGS.PASCAL_GUIDE_CONTEXT_ACTIONS, tooltip: 'Delete guide plane' },
      ];

    case 'slab':
      return [
        { id: 'edit-finishes', label: 'Edit Floor Finishes', icon: 'Sliders', enabled: ACTION_FLAGS.PASCAL_SLAB_CONTEXT_ACTIONS, tooltip: 'Edit floor slab finishes & elevation' },
        { id: 'move', label: 'Move Slab', icon: 'Move', enabled: ACTION_FLAGS.PASCAL_SLAB_CONTEXT_ACTIONS, tooltip: 'Move slab boundary (+0.5m offset)' },
        { id: 'duplicate', label: 'Duplicate Slab', icon: 'Copy', enabled: ACTION_FLAGS.PASCAL_SLAB_CONTEXT_ACTIONS, tooltip: 'Duplicate slab' },
        { id: 'rotate-left-90', label: 'Rotate Slab Left', icon: 'RotateCcw', enabled: ACTION_FLAGS.PASCAL_SLAB_CONTEXT_ACTIONS, tooltip: 'Rotate slab 90° CCW around centroid' },
        { id: 'rotate-right-90', label: 'Rotate Slab Right', icon: 'RotateCw', enabled: ACTION_FLAGS.PASCAL_SLAB_CONTEXT_ACTIONS, tooltip: 'Rotate slab 90° CW around centroid' },
        { id: 'delete', label: 'Delete Slab', icon: 'Trash2', enabled: ACTION_FLAGS.PASCAL_SLAB_CONTEXT_ACTIONS, tooltip: 'Delete slab (with dependency check)' },
      ];

    case 'wall':
      return [
        { id: 'edit-finishes', label: 'Edit Wall', icon: 'Sliders', enabled: ACTION_FLAGS.PASCAL_WALL_CONTEXT_ACTIONS, tooltip: 'Edit wall finishes, glass & dimensions' },
        { id: 'close-gaps', label: 'Close Gaps / Extend', icon: 'MoveHorizontal', enabled: ACTION_FLAGS.PASCAL_WALL_CONTEXT_ACTIONS, tooltip: 'Auto-close wall gaps or extend open ends to nearest wall' },
        { id: 'nudge', label: 'Nudge Wall', icon: 'Move', enabled: ACTION_FLAGS.PASCAL_WALL_CONTEXT_ACTIONS, tooltip: 'Nudge wall segment by +0.5m offset' },
        { id: 'duplicate', label: 'Duplicate Wall', icon: 'Copy', enabled: ACTION_FLAGS.PASCAL_WALL_CONTEXT_ACTIONS, tooltip: 'Duplicate wall segment' },
        { id: 'rotate-left-90', label: 'Rotate Wall Left', icon: 'RotateCcw', enabled: ACTION_FLAGS.PASCAL_WALL_CONTEXT_ACTIONS, tooltip: 'Rotate wall 90° CCW around center' },
        { id: 'rotate-right-90', label: 'Rotate Wall Right', icon: 'RotateCw', enabled: ACTION_FLAGS.PASCAL_WALL_CONTEXT_ACTIONS, tooltip: 'Rotate wall 90° CW around center' },
        { id: 'delete', label: 'Delete Wall', icon: 'Trash2', enabled: ACTION_FLAGS.PASCAL_WALL_CONTEXT_ACTIONS, tooltip: 'Delete wall and hosted openings' },
      ];

    case 'door':
      return [
        { id: 'move-along-host', label: 'Move Along Wall', icon: 'MoveHorizontal', enabled: ACTION_FLAGS.PASCAL_DOOR_CONTEXT_ACTIONS, tooltip: 'Move door along host wall' },
        { id: 'duplicate-on-host', label: 'Duplicate on Wall', icon: 'Copy', enabled: ACTION_FLAGS.PASCAL_DOOR_CONTEXT_ACTIONS, tooltip: 'Duplicate door on host wall' },
        { id: 'flip-handing', label: 'Flip Handing', icon: 'ArrowLeftRight', enabled: ACTION_FLAGS.PASCAL_DOOR_CONTEXT_ACTIONS, tooltip: 'Flip door handing (left/right hinges)' },
        { id: 'flip-swing', label: 'Flip Swing', icon: 'ArrowUpDown', enabled: ACTION_FLAGS.PASCAL_DOOR_CONTEXT_ACTIONS, tooltip: 'Flip door swing (inward/outward)' },
        { id: 'flip-side', label: 'Flip Side', icon: 'RotateCw', enabled: ACTION_FLAGS.PASCAL_DOOR_CONTEXT_ACTIONS, tooltip: 'Flip door facing (front/back)' },
        { id: 'rehost', label: 'Rehost to Wall', icon: 'RotateCcw', enabled: ACTION_FLAGS.PASCAL_REHOST_ACTIONS, tooltip: 'Rehost door to target wall segment' },
        { id: 'delete', label: 'Delete Door', icon: 'Trash2', enabled: ACTION_FLAGS.PASCAL_DOOR_CONTEXT_ACTIONS, tooltip: 'Delete door and restore host wall opening' },
      ];

    case 'window':
      return [
        { id: 'move-along-host', label: 'Move Along Wall', icon: 'MoveHorizontal', enabled: ACTION_FLAGS.PASCAL_WINDOW_CONTEXT_ACTIONS, tooltip: 'Move window along host wall' },
        { id: 'duplicate-on-host', label: 'Duplicate on Wall', icon: 'Copy', enabled: ACTION_FLAGS.PASCAL_WINDOW_CONTEXT_ACTIONS, tooltip: 'Duplicate window on host wall' },
        { id: 'flip-side', label: 'Flip Side', icon: 'ArrowLeftRight', enabled: ACTION_FLAGS.PASCAL_WINDOW_CONTEXT_ACTIONS, tooltip: 'Flip window facing (front/back)' },
        { id: 'rehost', label: 'Rehost to Wall', icon: 'RotateCcw', enabled: ACTION_FLAGS.PASCAL_REHOST_ACTIONS, tooltip: 'Rehost window to target wall segment' },
        { id: 'delete', label: 'Delete Window', icon: 'Trash2', enabled: ACTION_FLAGS.PASCAL_WINDOW_CONTEXT_ACTIONS, tooltip: 'Delete window and restore host wall opening' },
      ];

    default:
      return [];
  }
}
