declare module 'rbush' {
  export default class RBush<T = any> {
    insert(item: T): void;
    load(items: T[]): void;
    search(bbox: any): T[];
    all(): T[];
    clear(): void;
  }
}
declare module '@pascal-app/core/schema';
declare module '@pascal-app/core';
