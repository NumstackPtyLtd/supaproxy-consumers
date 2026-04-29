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

  /** Config schema — dashboard renders forms from this. */
  readonly configSchema: ConfigSchema

  /** Validate org-level credentials (API keys, tokens). */
  validateCredentials(config: Record<string, string>): Promise<ValidationResult>

  /** Start the consumer (connect to external service). */
  start(ctx: ConsumerContext, config: Record<string, string>): Promise<void>

  /** Stop the consumer (disconnect cleanly). */
  stop(): Promise<void>

  /** Bind a channel to a workspace. */
  bindChannel(config: ChannelBindConfig): Promise<{ ok: boolean; error?: string }>

  /** Send an outbound message (cold notifications, follow-ups). */
  sendMessage(channel: string, message: string, threadId?: string): Promise<void>
}
