/**
 * Lazy Loader Utilities
 * Eliminates repeated null-check-and-create boilerplate across tool modules
 */

/**
 * Create a lazy-loaded singleton. The factory is called once on first access.
 */
export function createLazyLoader<T>(factory: () => T): () => T {
  let instance: T | null = null;
  return () => {
    if (!instance) {
      instance = factory();
    }
    return instance;
  };
}

/**
 * Create a resettable lazy-loaded singleton.
 * Useful for testing or when config changes require re-initialization.
 */
export function createResettableLazyLoader<T>(factory: () => T): {
  get: () => T;
  reset: () => void;
} {
  let instance: T | null = null;
  return {
    get: () => {
      if (!instance) {
        instance = factory();
      }
      return instance;
    },
    reset: () => {
      instance = null;
    },
  };
}
