// Re-exports ONLY the Pascal schema (no React/hooks) so unit tests can exercise
// the REAL installed @pascal-app/core schema without pulling the full app bundle
// (whose root entry imports React hooks that fail under plain Node/vitest).
export * from 'C:/Users/Mohamad60025/Desktop/Design And Build - Clean/node_modules/@pascal-app/core/dist/schema/index.js';
