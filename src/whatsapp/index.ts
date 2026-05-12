import pino from 'pino'
import type { ConsumerPlugin, ConsumerContext, ChannelBindConfig, IncomingMessage } from '../types.js'
import { handleFlowCompletion } from './flows.js'

const log = pino({ name: 'whatsapp-consumer' })

const GRAPH_API = 'https://graph.facebook.com/v21.0'

interface WhatsAppMessage {
  from: string
  id: string
  timestamp: string
  type: string
  text?: { body: string }
  interactive?: {
    type: string
    nfm_reply?: {
      response_json: string
      body: string
      name: string
    }
  }
}

interface WhatsAppWebhookEntry {
  id: string
  changes: Array<{
    value: {
      messaging_product: string
      metadata: { display_phone_number: string; phone_number_id: string }
      contacts?: Array<{ profile: { name: string }; wa_id: string }>
      messages?: WhatsAppMessage[]
    }
    field: string
  }>
}

interface WhatsAppWebhookBody {
  object: string
  entry: WhatsAppWebhookEntry[]
}

let activeCtx: ConsumerContext | null = null
let accessToken: string | null = null
let phoneNumberId: string | null = null

async function sendReply(to: string, text: string): Promise<void> {
  if (!accessToken || !phoneNumberId) {
    log.error('Cannot send reply, missing access token or phone number ID')
    return
  }

  const res = await fetch(`${GRAPH_API}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    log.error({ status: res.status, body: err }, 'Failed to send WhatsApp reply')
  }
}

async function markAsRead(messageId: string): Promise<void> {
  if (!accessToken || !phoneNumberId) return

  await fetch(`${GRAPH_API}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    }),
  }).catch(() => { /* ignore read receipt failures */ })
}

/**
 * Process an incoming webhook from Meta.
 * Called by the server's webhook route handler.
 */
export async function handleWebhook(body: WhatsAppWebhookBody): Promise<void> {
  if (!activeCtx) {
    log.warn('WhatsApp webhook received but consumer not started')
    return
  }

  if (body.object !== 'whatsapp_business_account') return

  for (const entry of body.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue

      const messages = change.value.messages || []
      const contacts = change.value.contacts || []
      const phoneId = change.value.metadata.phone_number_id

      for (const msg of messages) {
        const contact = contacts.find(c => c.wa_id === msg.from)
        const userName = contact?.profile?.name || msg.from

        const ws = await activeCtx.getWorkspaceForChannel(phoneId)
        if (!ws) {
          log.warn({ phoneNumberId: phoneId, from: msg.from }, 'No workspace bound to this phone number')
          continue
        }

        markAsRead(msg.id)

        // Handle flow form submissions
        if (msg.type === 'interactive' && msg.interactive?.type === 'nfm_reply' && msg.interactive.nfm_reply) {
          try {
            const responseData = JSON.parse(msg.interactive.nfm_reply.response_json) as Record<string, unknown>
            const flowToken = responseData.flow_token as string
            const completion = handleFlowCompletion(flowToken, responseData)

            if (completion) {
              log.info({ tool: completion.session.toolName, fields: Object.keys(completion.data) }, 'Flow form submitted')

              // Send the form data back as a message so the AI can process it
              const formSummary = Object.entries(completion.data)
                .filter(([k]) => k !== 'flow_token')
                .map(([k, v]) => `${k}: ${v}`)
                .join('\n')

              const incoming: IncomingMessage = {
                query: `[Form submitted for ${completion.session.toolName}]\n${formSummary}`,
                channel: phoneId,
                userId: msg.from,
                userName,
                threadId: `${phoneId}:${msg.from}`,
                consumerType: 'whatsapp',
              }

              const result = await activeCtx.onMessage(incoming)
              await sendReply(msg.from, result.answer)
            } else {
              await sendReply(msg.from, 'Form received, but the session expired. Please try again.')
            }
          } catch (err) {
            log.error({ error: (err as Error).message }, 'Failed to process flow submission')
            await sendReply(msg.from, 'Something went wrong processing your form. Please try again.')
          }
          continue
        }

        // Handle regular text messages
        if (msg.type !== 'text' || !msg.text?.body) continue

        const incoming: IncomingMessage = {
          query: msg.text.body,
          channel: phoneId,
          userId: msg.from,
          userName,
          threadId: `${phoneId}:${msg.from}`,
          consumerType: 'whatsapp',
        }

        try {
          const result = await activeCtx.onMessage(incoming)
          await sendReply(msg.from, result.answer)
        } catch (err) {
          activeCtx.onError(err as Error)
          await sendReply(msg.from, 'Something went wrong. Please try again.')
        }
      }
    }
  }
}

/**
 * Verify the webhook during Meta setup.
 * Returns the challenge token if the verify token matches.
 */
export function verifyWebhook(mode: string, token: string, challenge: string, expectedToken: string): string | null {
  if (mode === 'subscribe' && token === expectedToken) {
    log.info('Webhook verified')
    return challenge
  }
  log.warn('Webhook verification failed')
  return null
}

export const whatsappPlugin: ConsumerPlugin = {
  type: 'whatsapp',
  name: 'WhatsApp',
  description: 'Connect a WhatsApp Business number to this workspace. Customers message your number and get AI responses.',

  capabilities: {
    channels: true,
    threads: false,
    orgCredentials: true,
    outbound: true,
  },

  configSchema: {
    fields: [
      {
        name: 'access_token',
        label: 'Access token',
        type: 'password',
        required: true,
        placeholder: 'EAAx...',
        helpText: 'Permanent access token from Meta Business settings.',
      },
      {
        name: 'phone_number_id',
        label: 'Phone number ID',
        type: 'text',
        required: true,
        placeholder: '123456789012345',
        helpText: 'The phone number ID from WhatsApp Business API setup.',
      },
      {
        name: 'verify_token',
        label: 'Verify token',
        type: 'text',
        required: true,
        placeholder: 'my-verify-token',
        helpText: 'A secret you choose. Enter the same value in Meta webhook configuration.',
      },
    ],
  },

  channelBindSchema: {
    fields: [
      {
        name: 'channelId',
        label: 'Phone number ID',
        type: 'text',
        required: true,
        placeholder: '123456789012345',
        helpText: 'The WhatsApp phone number ID to bind to this workspace.',
      },
      {
        name: 'channelName',
        label: 'Display name',
        type: 'text',
        required: true,
        placeholder: '+27 81 234 5678',
        helpText: 'The phone number shown in the dashboard.',
      },
    ],
  },

  testConfig: {
    fields: [
      { key: 'phone', label: 'Phone number', type: 'phone', placeholder: '+27812345678', required: true },
      { key: 'message', label: 'Message', type: 'textarea', placeholder: 'Hi, what are your business hours?', required: true },
    ],
    payloadTemplate: {
      query: '{{message}}',
      consumer_type: 'whatsapp',
      consumer_context: {
        channel: '{{phone}}',
        userId: '{{phone}}',
        userName: 'Test User',
        threadId: 'test:{{phone}}',
      },
    },
  },

  async validateCredentials(config) {
    const { access_token, phone_number_id } = config
    if (!access_token || !phone_number_id) {
      return { ok: false, error: 'Access token and phone number ID are required.' }
    }

    try {
      const res = await fetch(`${GRAPH_API}/${phone_number_id}`, {
        headers: { 'Authorization': `Bearer ${access_token}` },
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        const msg = (data as Record<string, Record<string, string>>)?.error?.message || `HTTP ${res.status}`
        return { ok: false, error: `Meta API error: ${msg}` }
      }

      const data = await res.json() as Record<string, string>
      return {
        ok: true,
        detail: {
          phone_number: data.display_phone_number || phone_number_id,
          verified_name: data.verified_name || 'Unknown',
        },
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  },

  async start(ctx, config) {
    activeCtx = ctx
    accessToken = config.access_token || null
    phoneNumberId = config.phone_number_id || null

    if (!accessToken || !phoneNumberId) {
      log.warn('Missing WhatsApp credentials, consumer will not send replies')
      return
    }

    log.info({ phoneNumberId }, 'WhatsApp consumer started')
  },

  async stop() {
    activeCtx = null
    accessToken = null
    phoneNumberId = null
    log.info('WhatsApp consumer stopped')
  },

  async bindChannel(_config: ChannelBindConfig) {
    return { ok: true }
  },

  async sendMessage(channel, message) {
    await sendReply(channel, message)
  },
}
