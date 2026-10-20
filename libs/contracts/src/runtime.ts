/** Services the engine hands to plugins, so they never depend on its implementation. */
export interface PluginCache {
  withCache<T>(key: string, fn: () => Promise<T>, ttlSeconds?: number): Promise<T>;
}
