/** Services the engine hands to plugins, so they never depend on its implementation. */
export interface PluginCache {
  withCache<T>(key: string, fn: () => Promise<T>, ttlSeconds?: number): Promise<T>;
}

export interface PluginLogger {
  debug(message: string): void;
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export type PluginLoggerFactory = (context: string) => PluginLogger;

const consoleLoggerFactory: PluginLoggerFactory = (context) => ({
  debug: (message) => console.debug(`[${context}] ${message}`),
  log: (message) => console.info(`[${context}] ${message}`),
  warn: (message) => console.warn(`[${context}] ${message}`),
  error: (message) => console.error(`[${context}] ${message}`),
});

let loggerFactory: PluginLoggerFactory = consoleLoggerFactory;

/** Called once by the engine at boot to route every plugin log into its own logger. */
export function setPluginLoggerFactory(factory: PluginLoggerFactory): void {
  loggerFactory = factory;
}

/**
 * A logger bound to the factory installed when it first writes, so plugins can create it
 * at import time (static fields), before the engine has installed its factory.
 */
export function createLogger(context: string): PluginLogger {
  let boundFactory: PluginLoggerFactory | null = null;
  let target: PluginLogger | null = null;
  const current = (): PluginLogger => {
    if (target === null || boundFactory !== loggerFactory) {
      boundFactory = loggerFactory;
      target = loggerFactory(context);
    }
    return target;
  };
  return {
    debug: (message) => current().debug(message),
    log: (message) => current().log(message),
    warn: (message) => current().warn(message),
    error: (message) => current().error(message),
  };
}
