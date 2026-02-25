import type { StorageAdapter } from "./types.js";

/**
 * LocalStorage-backed StorageAdapter.
 * Stores JSON-serialised values under literal key strings.
 *
 * Usage:
 *   const adapter = new LocalStorageAdapter();
 *   // Engine will call adapter.load(`assumption-drift:${packId}`) etc.
 */
export class LocalStorageAdapter<T = unknown> implements StorageAdapter<T> {
  async load(key: string): Promise<T | null> {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async save(key: string, value: T): Promise<void> {
    localStorage.setItem(key, JSON.stringify(value));
  }

  async clear(key: string): Promise<void> {
    localStorage.removeItem(key);
  }
}
