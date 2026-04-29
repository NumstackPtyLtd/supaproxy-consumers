import pino from 'pino'
import type { ConsumerPlugin } from './types.js'

const log = pino({ name: 'consumer-registry' })

/**
 * Plugin registry — discovers and manages consumer plugins.
 *
 * Usage:
 *   import { registry } from '@supaproxy/consumers'
 *   registry.list()           // all registered plugins
 *   registry.get('slack')     // get a specific plugin
 *   registry.schemas()        // config schemas for dashboard
 */
class PluginRegistry {
  private readonly plugins = new Map<string, ConsumerPlugin>()

  /** Register a consumer plugin. Called automatically by each plugin module. */
  register(plugin: ConsumerPlugin): void {
    if (this.plugins.has(plugin.type)) {
      log.warn({ type: plugin.type }, 'Plugin already registered, replacing')
    }
    this.plugins.set(plugin.type, plugin)
    log.info({ type: plugin.type, name: plugin.name }, 'Consumer plugin registered')
  }

  /** Get a plugin by type. Throws if not found. */
  get(type: string): ConsumerPlugin {
    const plugin = this.plugins.get(type)
    if (!plugin) {
      throw new Error(`Consumer plugin not found: ${type}`)
    }
    return plugin
  }

  /** Check if a plugin type is registered. */
  has(type: string): boolean {
    return this.plugins.has(type)
  }

  /** List all registered plugin types. */
  types(): string[] {
    return Array.from(this.plugins.keys())
  }

  /** List all registered plugins. */
  list(): ConsumerPlugin[] {
    return Array.from(this.plugins.values())
  }

  /**
   * Return config schemas for all plugins — used by
   * GET /api/consumers/types to drive dashboard form rendering.
   */
  schemas(): Array<{
    type: string
    name: string
    description: string
    configSchema: ConsumerPlugin['configSchema']
  }> {
    return this.list().map((p) => ({
      type: p.type,
      name: p.name,
      description: p.description,
      configSchema: p.configSchema,
    }))
  }
}

/** Singleton registry instance. */
export const registry = new PluginRegistry()
