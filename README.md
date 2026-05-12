# @supaproxy/consumers

[![npm version](https://img.shields.io/npm/v/@supaproxy/consumers)](https://www.npmjs.com/package/@supaproxy/consumers)
[![license](https://img.shields.io/npm/l/@supaproxy/consumers)](./LICENSE)

Plugin package for [SupaProxy](https://supaproxy.com) consumer types. Consumers are the channels through which users interact with SupaProxy -- Slack, REST API, WhatsApp, and more.

Each consumer is a self-contained plugin that handles inbound messages, outbound replies, and channel binding. The dashboard auto-discovers consumers via the plugin registry.

## Installation

```bash
npm install @supaproxy/consumers
```

### Peer dependencies

Some plugins require optional peer dependencies:

```bash
# For the Slack consumer
npm install @slack/bolt
```

## Quick start

```typescript
import { registry } from '@supaproxy/consumers'

// All built-in plugins are auto-registered on import.

// List available consumer types
const plugins = registry.list()
console.log(registry.types()) // ['slack', 'api']

// Get a specific plugin
const slack = registry.get('slack')

// Get config schemas for dashboard form rendering
const schemas = registry.schemas()

// Start a consumer
await slack.start(
  {
    onMessage: async (msg) => {
      // Handle incoming message, return agent response
      return { answer: 'Hello!', conversationId: '123' }
    },
    onError: (err) => console.error(err),
    logger: pinoLogger,
    getWorkspaceForChannel: async (channelId) => {
      return { id: 'ws_1', name: 'My Workspace' }
    },
  },
  { SLACK_BOT_TOKEN: 'xoxb-...', SLACK_APP_TOKEN: 'xapp-...' }
)

// Send an outbound message
await slack.sendMessage('#general', 'Proactive notification', 'thread_ts')

// Stop the consumer
await slack.stop()
```

## API reference

### `ConsumerPlugin`

The interface every consumer type must implement.

```typescript
interface ConsumerPlugin {
  readonly type: string          // Unique identifier: 'slack', 'api', etc.
  readonly name: string          // Human-readable name
  readonly description: string   // Short description for the dashboard
  readonly configSchema: ConfigSchema

  validateCredentials(config: Record<string, string>): Promise<ValidationResult>
  start(ctx: ConsumerContext, config: Record<string, string>): Promise<void>
  stop(): Promise<void>
  bindChannel(config: ChannelBindConfig): Promise<{ ok: boolean; error?: string }>
  sendMessage(channel: string, message: string, threadId?: string): Promise<void>
}
```

### `ConsumerContext`

The context provided to consumers by the host server.

```typescript
interface ConsumerContext {
  onMessage: (msg: IncomingMessage) => Promise<AgentResponse>
  onError: (error: Error) => void
  logger: Logger
  getWorkspaceForChannel: (channelId: string) => Promise<Workspace | null>
}
```

### `IncomingMessage`

```typescript
interface IncomingMessage {
  query: string
  channel: string
  userId: string
  userName: string
  threadId: string
  consumerType: string
}
```

### `ConfigSchema`

Drives dynamic form rendering in the dashboard. Each field specifies its type, label, placeholder, and validation requirements.

```typescript
interface ConfigSchema {
  fields: ConfigField[]
}

interface ConfigField {
  name: string
  label: string
  type: 'text' | 'password' | 'select' | 'textarea'
  required: boolean
  placeholder?: string
  helpText?: string
  options?: string[]    // For 'select' type
}
```

### `ValidationResult`

```typescript
interface ValidationResult {
  ok: boolean
  detail?: Record<string, string>
  error?: string
}
```

### Registry methods

| Method | Returns | Description |
|--------|---------|-------------|
| `registry.list()` | `ConsumerPlugin[]` | All registered plugins |
| `registry.get(type)` | `ConsumerPlugin` | Get plugin by type (throws if not found) |
| `registry.has(type)` | `boolean` | Check if a plugin type is registered |
| `registry.types()` | `string[]` | List all registered type identifiers |
| `registry.schemas()` | `Array<{type, name, description, configSchema}>` | Config schemas for dashboard forms |
| `registry.register(plugin)` | `void` | Register a custom plugin |

## Available plugins

| Plugin | Type | Description |
|--------|------|-------------|
| Slack | `slack` | Slack integration via Socket Mode. Receives messages from Slack channels and threads, sends replies back. Requires `@slack/bolt` peer dependency. |
| API | `api` | REST API consumer. Exposes an HTTP endpoint for programmatic access to SupaProxy conversations. |

## Adding a new consumer plugin

Adding a new consumer type is a one-file change. Create a file that implements `ConsumerPlugin`:

```typescript
import type { ConsumerPlugin, ConsumerContext, ValidationResult } from '@supaproxy/consumers'

export const myPlugin: ConsumerPlugin = {
  type: 'my-consumer',
  name: 'My Consumer',
  description: 'A custom consumer channel',
  configSchema: {
    fields: [
      { name: 'API_KEY', label: 'API Key', type: 'password', required: true },
    ],
  },

  async validateCredentials(config) {
    // Validate the provided credentials
    return { ok: true }
  },

  async start(ctx, config) {
    // Connect to the external service
    // Call ctx.onMessage() when a message arrives
  },

  async stop() {
    // Disconnect cleanly
  },

  async bindChannel(config) {
    // Bind a channel to a workspace
    return { ok: true }
  },

  async sendMessage(channel, message, threadId) {
    // Send an outbound message
  },
}
```

Then register it:

```typescript
import { registry } from '@supaproxy/consumers'
import { myPlugin } from './my-plugin.js'

registry.register(myPlugin)
```

## Contributing

See the [SupaProxy contributing guide](https://github.com/NumstackPtyLtd/supaproxy) for development workflow, code standards, and PR process.

## Documentation

Full documentation at [docs.supaproxy.cloud](https://docs.supaproxy.cloud/plugins/consumers).

## License

MIT
