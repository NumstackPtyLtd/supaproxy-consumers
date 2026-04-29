// Types
export type {
  ConsumerPlugin,
  ConsumerContext,
  ConfigField,
  ConfigSchema,
  IncomingMessage,
  AgentResponse,
  Workspace,
  ChannelBindConfig,
  ColdMessageTarget,
  ValidationResult,
} from './types.js'

// Registry
export { registry } from './registry.js'

// Plugins
export { slackPlugin } from './slack/index.js'
export { apiPlugin } from './api/index.js'

// Auto-register all built-in plugins
import { registry } from './registry.js'
import { slackPlugin } from './slack/index.js'
import { apiPlugin } from './api/index.js'

registry.register(slackPlugin)
registry.register(apiPlugin)
