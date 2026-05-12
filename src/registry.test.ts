import { describe, it, expect, beforeEach } from 'vitest'
import { registry } from './registry.js'
import { verifyWebhook } from './whatsapp/index.js'
import { apiPlugin } from './api/index.js'
import type { ConsumerPlugin, ConsumerCapabilities, ChannelBindConfig } from './types.js'

// ── Helpers ──

function makeMockPlugin(type: string, overrides?: Partial<ConsumerPlugin>): ConsumerPlugin {
  return {
    type,
    name: `${type} Consumer`,
    description: `Mock ${type} consumer`,
    capabilities: {
      channels: false,
      threads: false,
      orgCredentials: false,
      outbound: false,
    },
    configSchema: {
      fields: [
        { name: 'token', label: 'Token', type: 'password', required: true },
      ],
    },
    validateCredentials: async () => ({ ok: true }),
    start: async () => {},
    stop: async () => {},
    ...overrides,
  }
}

// ── Registry tests ──

describe('ConsumerRegistry', () => {
  beforeEach(() => {
    registry.plugins.clear()
  })

  describe('register', () => {
    it('registers a plugin', () => {
      const plugin = makeMockPlugin('test-consumer')
      registry.register(plugin)
      expect(registry.has('test-consumer')).toBe(true)
    })

    it('replaces an existing plugin with the same type', () => {
      registry.register(makeMockPlugin('dup', { name: 'V1' }))
      registry.register(makeMockPlugin('dup', { name: 'V2' }))
      expect(registry.get('dup').name).toBe('V2')
    })
  })

  describe('get', () => {
    it('returns the registered plugin', () => {
      const plugin = makeMockPlugin('slack-mock')
      registry.register(plugin)
      expect(registry.get('slack-mock')).toBe(plugin)
    })

    it('throws for an unknown type', () => {
      expect(() => registry.get('nonexistent')).toThrow('Consumer plugin not found: nonexistent')
    })
  })

  describe('has', () => {
    it('returns true for registered types', () => {
      registry.register(makeMockPlugin('present'))
      expect(registry.has('present')).toBe(true)
    })

    it('returns false for unregistered types', () => {
      expect(registry.has('absent')).toBe(false)
    })
  })

  describe('types', () => {
    it('returns empty array when empty', () => {
      expect(registry.types()).toEqual([])
    })

    it('returns all registered type strings', () => {
      registry.register(makeMockPlugin('alpha'))
      registry.register(makeMockPlugin('beta'))
      expect(registry.types()).toEqual(['alpha', 'beta'])
    })
  })

  describe('list', () => {
    it('returns empty array when empty', () => {
      expect(registry.list()).toEqual([])
    })

    it('returns all plugins', () => {
      const a = makeMockPlugin('a')
      const b = makeMockPlugin('b')
      registry.register(a)
      registry.register(b)
      expect(registry.list()).toEqual([a, b])
    })
  })

  describe('schemas', () => {
    it('returns empty array when empty', () => {
      expect(registry.schemas()).toEqual([])
    })

    it('returns schema info for all registered plugins', () => {
      registry.register(makeMockPlugin('schema-test', {
        capabilities: { channels: true, threads: true, orgCredentials: true, outbound: false },
        channelBindSchema: { fields: [{ name: 'channelId', label: 'Channel', type: 'text', required: true }] },
        testConfig: {
          fields: [{ key: 'msg', label: 'Message', type: 'text', required: true }],
          payloadTemplate: { query: '{{msg}}' },
        },
      }))
      const schemas = registry.schemas()
      expect(schemas).toHaveLength(1)
      const s = schemas[0]
      expect(s.type).toBe('schema-test')
      expect(s.name).toBeDefined()
      expect(s.description).toBeDefined()
      expect(s.configSchema.fields.length).toBeGreaterThan(0)
      expect(s.capabilities.channels).toBe(true)
      expect(s.channelBindSchema).toBeDefined()
      expect(s.testConfig).toBeDefined()
    })

    it('schema omits optional fields when not set', () => {
      registry.register(makeMockPlugin('minimal'))
      const s = registry.schemas()[0]
      expect(s.channelBindSchema).toBeUndefined()
      expect(s.testConfig).toBeUndefined()
    })
  })
})

// ── WhatsApp verifyWebhook ──

describe('verifyWebhook', () => {
  it('returns challenge when mode is subscribe and token matches', () => {
    const result = verifyWebhook('subscribe', 'my-token', 'challenge-123', 'my-token')
    expect(result).toBe('challenge-123')
  })

  it('returns null when mode is not subscribe', () => {
    const result = verifyWebhook('unsubscribe', 'my-token', 'challenge-123', 'my-token')
    expect(result).toBeNull()
  })

  it('returns null when token does not match', () => {
    const result = verifyWebhook('subscribe', 'wrong-token', 'challenge-123', 'my-token')
    expect(result).toBeNull()
  })

  it('returns null when both mode and token are wrong', () => {
    const result = verifyWebhook('invalid', 'wrong', 'challenge', 'expected')
    expect(result).toBeNull()
  })
})

// ── API plugin contract ──

describe('apiPlugin', () => {
  it('has correct metadata', () => {
    expect(apiPlugin.type).toBe('api')
    expect(apiPlugin.name).toBe('API')
    expect(apiPlugin.capabilities.channels).toBe(false)
    expect(apiPlugin.capabilities.threads).toBe(false)
    expect(apiPlugin.capabilities.orgCredentials).toBe(false)
    expect(apiPlugin.capabilities.outbound).toBe(false)
  })

  it('validateCredentials always returns ok', async () => {
    const result = await apiPlugin.validateCredentials({})
    expect(result.ok).toBe(true)
  })

  it('start and stop do nothing (no throw)', async () => {
    await expect(apiPlugin.start({} as never, {})).resolves.toBeUndefined()
    await expect(apiPlugin.stop()).resolves.toBeUndefined()
  })

  it('bindChannel returns ok', async () => {
    const result = await apiPlugin.bindChannel!({ workspaceId: 'ws', channelId: 'ch' })
    expect(result.ok).toBe(true)
  })

  it('sendMessage throws (not supported)', async () => {
    await expect(apiPlugin.sendMessage!('ch', 'msg')).rejects.toThrow('API consumer does not support outbound messages')
  })

  it('has a testConfig', () => {
    expect(apiPlugin.testConfig).toBeDefined()
    expect(apiPlugin.testConfig!.fields.length).toBeGreaterThan(0)
  })
})

// ── ConsumerPlugin contract check ──

describe('ConsumerPlugin contract', () => {
  it('mock plugin satisfies the full interface', () => {
    const plugin = makeMockPlugin('contract')
    expect(typeof plugin.type).toBe('string')
    expect(typeof plugin.name).toBe('string')
    expect(typeof plugin.description).toBe('string')
    expect(Array.isArray(plugin.configSchema.fields)).toBe(true)
    expect(typeof plugin.capabilities.channels).toBe('boolean')
    expect(typeof plugin.capabilities.threads).toBe('boolean')
    expect(typeof plugin.capabilities.orgCredentials).toBe('boolean')
    expect(typeof plugin.capabilities.outbound).toBe('boolean')
    expect(typeof plugin.validateCredentials).toBe('function')
    expect(typeof plugin.start).toBe('function')
    expect(typeof plugin.stop).toBe('function')
  })
})
