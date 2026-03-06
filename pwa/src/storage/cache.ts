type CacheRecord<T> = {
  value: T;
  expiresAt: number;
};

export class LocalCache {
  private records = new Map<string, CacheRecord<unknown>>();

  get<T>(key: string): T | null {
    const hit = this.records.get(key);
    if (!hit) {
      return null;
    }
    if (Date.now() > hit.expiresAt) {
      this.records.delete(key);
      return null;
    }
    return hit.value as T;
  }

  set<T>(key: string, value: T, ttlMs = 30_000) {
    this.records.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
  }

  invalidate(key: string) {
    this.records.delete(key);
  }

  clear() {
    this.records.clear();
  }
}

export const localCache = new LocalCache();
