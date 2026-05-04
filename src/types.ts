import type { Logger } from 'pino'

/** Field definition for config forms — dashboard renders UI from this. */
export interface ConfigField {
  name: string
  label: string
  type: 'text' | 'password' | 'select' | 'textarea'
  required: boolean
  placeholder?: string
  helpText?: string
  options?: string[]
}

/** Config schema drives dynamic form rendering in the dashboard. */
export interface ConfigSchema {
  fields: ConfigField[]
}

/** Field definition for test playground forms — rendered dynamically per consumer. */
export interface TestField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'phone' | 'select'
  placeholder?: string
  required?: boolean
  defaultValue?: string
  options?: Array<{ label: string; value: string }>
}

/**
 * Test config — allows the test playground to simulate requests
 * as if they came from this consumer type.
 *
 * `fields` define the form UI. `payloadTemplate` uses {{key}} placeholders
 * that get interpolated with field values before sending to the server.
 */
export interface TestConfig {
  fields: TestField[]
  payloadTemplate: Record<string, unknown>
}

/** Incoming message from a consumer channel. */
export interface IncomingMessage {
  query: string
  channel: string
  userId: string
  userName: string
  threadId: string
  consumerType: string
}

/** Response from the AI agent after processing a query. */
export interface AgentResponse {
  answer: string
  conversationId: string
}

/** Workspace info passed to consumers for channel routing. */
export interface Workspace {
  id: string
  name: string
}

/** Channel binding configuration. */
export interface ChannelBindConfig {
  workspaceId: string
  channelId: string
  channelName?: string
}

/** Target for outbound messages (cold notifications, etc.). */
export interface ColdMessageTarget {
  conversationId: string
  consumerType: string
  channel: string
  externalThreadId: string
}

/** Context provided to consumers by the host server. */
export interface ConsumerContext {
  onMessage: (msg: IncomingMessage) => Promise<AgentResponse>
  onError: (error: Error) => void
  logger: Logger
  getWorkspaceForChannel: (channelId: string) => Promise<Workspace | null>
}

/** Credential validation result. */
export interface ValidationResult {
  ok: boolean
  detail?: Record<string, string>
  error?: string
}

/**
 * Declares what this consumer supports. The dashboard uses this
 * to decide which UI slots to render for this consumer type.
 */
export interface ConsumerCapabilities {
  /** Supports binding channels/numbers to workspaces (Slack, Teams — yes. API — no). */
  channels: boolean
  /** Supports threaded replies (Slack — yes. WhatsApp — no). */
  threads: boolean
  /** Needs org-level credentials before use (Slack — yes. API — no). */
  orgCredentials: boolean
  /** Supports outbound/cold messages (Slack — yes. API — no). */
  outbound: boolean
}

/** Schema for channel binding form — rendered in the Add Consumer modal. */
export interface ChannelBindSchema {
  fields: ConfigField[]
}

/**
 * ConsumerPlugin — the contract every consumer type must implement.
 *
 * Adding a new consumer = one file implementing this interface.
 * The dashboard auto-discovers consumers via the registry.
 */
export interface ConsumerPlugin {
  /** Unique type identifier: 'slack', 'api', 'whatsapp', etc. */
  readonly type: string

  /** Human-readable name for the dashboard. */
  readonly name: string

  /** Short description shown in the dashboard. */
  readonly description: string

  /** Config schema — dashboard renders credential forms from this. */
  readonly configSchema: ConfigSchema

  /** What this consumer supports — drives dashboard slot rendering. */
  readonly capabilities: ConsumerCapabilities

  /** Channel binding schema — rendered in Add Consumer modal when capabilities.channels is true. */
  readonly channelBindSchema?: ChannelBindSchema

  /** Test config — dashboard test playground renders consumer-specific forms from this. */
  readonly testConfig?: TestConfig

  /** Validate org-level credentials (API keys, tokens). */
  validateCredentials(config: Record<string, string>): Promise<ValidationResult>

  /** Start the consumer (connect to external service). */
  start(ctx: ConsumerContext, config: Record<string, string>): Promise<void>

  /** Stop the consumer (disconnect cleanly). */
  stop(): Promise<void>

  /** Bind a channel to a workspace. Only required when capabilities.channels is true. */
  bindChannel?(config: ChannelBindConfig): Promise<{ ok: boolean; error?: string }>

  /** Send an outbound message. Only required when capabilities.outbound is true. */
  sendMessage?(channel: string, message: string, threadId?: string): Promise<void>
}
