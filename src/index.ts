// Types
export type {
  ConsumerPlugin,
  ConsumerCapabilities,
  ConsumerContext,
  ConfigField,
  ConfigSchema,
  ChannelBindSchema,
  TestField,
  TestConfig,
  IncomingMessage,
  AgentResponse,
  Workspace,
  ChannelBindConfig,
  ColdMessageTarget,
  ValidationResult,
} from './types.js'

// Registry
export { registry } from './registry.js'

// Plugins — exported for host to register selectively
export { slackPlugin } from './slack/index.js'
export { apiPlugin } from './api/index.js'
export { whatsappPlugin, handleWebhook, verifyWebhook } from './whatsapp/index.js'
