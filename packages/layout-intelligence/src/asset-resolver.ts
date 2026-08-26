import type { SemanticFurniture } from './furniture-intelligence';

export class AssetResolver {
  /**
   * Resolves semantic objects to corresponding Pascal production assets/SKUs.
   */
  public resolve(furniture: SemanticFurniture[]): any[] {
    return furniture.map(item => {
      let resolvedSku = 'PASCAL-SKU-CLOSET'; // Default fallback

      switch (item.type) {
        case 'bed_single':
          resolvedSku = 'PASCAL-SKU-SINGLE-BED';
          break;
        case 'bed_double':
          resolvedSku = 'PASCAL-SKU-DOUBLE-BED';
          break;
        case 'bunk_bed':
          resolvedSku = 'PASCAL-SKU-BUNKBED';
          break;
        case 'wardrobe':
          resolvedSku = 'PASCAL-SKU-CLOSET';
          break;
        case 'locker':
          resolvedSku = 'PASCAL-SKU-LOCKER'; // Will resolve in bridge to closet or locker
          break;
        case 'desk':
          resolvedSku = 'PASCAL-SKU-DESK';
          break;
        case 'reception_desk':
          resolvedSku = 'PASCAL-SKU-DESK';
          break;
        case 'table':
          resolvedSku = 'PASCAL-SKU-TABLE';
          break;
        case 'chair':
          resolvedSku = 'PASCAL-SKU-CHAIR';
          break;
        case 'toilet':
          resolvedSku = 'toilet';
          break;
        case 'sink':
          resolvedSku = 'sink-cabinet';
          break;
        case 'shower':
          resolvedSku = 'shower';
          break;
        case 'cabinet':
          resolvedSku = 'PASCAL-SKU-CABINET';
          break;
        default:
          resolvedSku = `sku-${item.type}`;
          break;
      }

      return {
        id: item.id,
        sku: resolvedSku,
        pos: item.position,
        rotation: item.rotation,
        width: item.size[0],
        depth: item.size[1],
        status: item.status,
        type: item.type
      };
    });
  }
}
