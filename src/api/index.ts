import type { ConsumerPlugin, ConsumerContext, ChannelBindConfig } from '../types.js'

/**
 * API Consumer — REST API access to workspaces via Bearer token.
 *
 * Unlike Slack/WhatsApp, this consumer doesn't connect to an external service.
 * It exposes workspace queries via authenticated API endpoints.
 * The server handles the HTTP layer; this plugin provides the config schema
 * and validates API key credentials.
 *
 * Depends on: token system (#15)
 */
export const apiPlugin: ConsumerPlugin = {
  type: 'api',
  name: 'API',
  description: 'Generate an API key to send queries to this workspace programmatically.',

  configSchema: {
    fields: [
      {
        name: 'key_name',
        label: 'Key name',
        type: 'text',
        required: true,
        placeholder: 'my-api-key',
        helpText: 'A label for this API key.',
      },
    ],
  },

  async validateCredentials() {
    // API consumer doesn't need external credentials
    return { ok: true }
  },

  async start() {
    // No external connection needed — API is served by the server itself
  },

  async stop() {
    // Nothing to disconnect
  },

  async bindChannel(_config: ChannelBindConfig) {
    // API doesn't have channels — each key is scoped to a workspace
    return { ok: true }
  },

  async sendMessage() {
    // API consumer doesn't send outbound messages
    throw new Error('API consumer does not support outbound messages')
  },
}
