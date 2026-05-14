import { App } from '@slack/bolt'
import pino from 'pino'
import type { ConsumerPlugin, ConsumerContext, ChannelBindConfig, IncomingMessage } from '../types.js'
import { stripMention, resolveUserName } from './utils.js'

const log = pino({ name: 'slack-consumer' })

type SlackClient = App['client']
type SayFn = (message: { text: string; thread_ts: string }) => Promise<unknown>

interface SlackMessageEvent {
  bot_id?: string
  user?: string
  text?: string
  ts: string
  thread_ts?: string
  channel: string
  channel_type?: string
}

let botUserId: string | null = null
let activeApp: App | null = null
let activeCtx: ConsumerContext | null = null

async function handleIncoming(
  query: string,
  channel: string,
  threadTs: string,
  eventTs: string,
  userId: string,
  client: SlackClient,
  say: SayFn,
  ctx: ConsumerContext,
) {
  if (!query) {
    say({ text: 'Ask a question.', thread_ts: threadTs })
    return
  }

  const userName = await resolveUserName(userId, client)
  const ws = await ctx.getWorkspaceForChannel(channel)
  if (!ws) {
    log.warn({ channel }, 'No workspace found for channel')
    return
  }

  // Show typing indicator
  try { await client.reactions.add({ channel, timestamp: eventTs, name: 'hourglass_flowing_sand' }) } catch { /* ignore */ }

  try {
    const msg: IncomingMessage = {
      query,
      channel,
      userId,
      userName,
      threadId: `${channel}:${threadTs}`,
      consumerType: 'slack',
    }

    const result = await ctx.onMessage(msg)

    // Clear typing, show done
    try { await client.reactions.remove({ channel, timestamp: eventTs, name: 'hourglass_flowing_sand' }) } catch { /* ignore */ }
    try { await client.reactions.add({ channel, timestamp: eventTs, name: 'white_check_mark' }) } catch { /* ignore */ }

    // Reply in thread
    try {
      await say({ text: result.answer, thread_ts: threadTs })
    } catch {
      try {
        await client.chat.postMessage({ channel, thread_ts: threadTs, text: result.answer })
      } catch (err) {
        log.error({ error: (err as Error).message }, 'Fallback reply failed')
      }
    }
  } catch (err) {
    ctx.onError(err as Error)
    try { await client.reactions.remove({ channel, timestamp: eventTs, name: 'hourglass_flowing_sand' }) } catch { /* ignore */ }
  }
}

export const slackPlugin: ConsumerPlugin = {
  type: 'slack',
  name: 'Slack',
  description: 'Bind a Slack channel to this workspace. When someone mentions the SupaProxy bot in this channel, queries will use this workspace\'s connections and knowledge.',

  capabilities: {
    channels: true,
    threads: true,
    orgCredentials: true,
    outbound: true,
  },

  configSchema: {
    fields: [
      {
        name: 'bot_token',
        label: 'Bot token',
        type: 'password',
        required: true,
        placeholder: 'xoxb-...',
        helpText: 'Slack bot OAuth token (Bot User OAuth Token)',
      },
      {
        name: 'app_token',
        label: 'App token',
        type: 'password',
        required: true,
        placeholder: 'xapp-...',
        helpText: 'Slack app-level token for Socket Mode',
      },
    ],
  },

  channelBindSchema: {
    fields: [
      { name: 'channelName', label: 'Slack channel', type: 'text', required: true, placeholder: '#support', helpText: 'The name of your Slack channel, e.g. #support or #billing.', pattern: '^#[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$', patternError: 'Must start with # followed by letters, numbers, hyphens, or underscores.' },
      { name: 'channelId', label: 'Slack channel ID', type: 'text', required: true, placeholder: 'C0EXAMPLE123', helpText: 'Right-click the channel in Slack, View channel details, copy the ID at the bottom.', pattern: '^[A-Z][A-Z0-9]{8,}$', patternError: 'Must be an uppercase alphanumeric ID (e.g. C0EXAMPLE123).' },
    ],
  },

  sections: [
    {
      id: 'credentials',
      label: 'Credentials',
      description: 'Connect your Slack workspace. SupaProxy uses Socket Mode so no public URL is needed.',
      source: 'settings',
      fields: [
        { name: 'bot_token', label: 'Bot token', type: 'password', required: true, placeholder: 'xoxb-...', helpText: 'Slack bot OAuth token (Bot User OAuth Token)' },
        { name: 'app_token', label: 'App token', type: 'password', required: true, placeholder: 'xapp-...', helpText: 'Slack app-level token for Socket Mode' },
      ],
    },
    {
      id: 'slack-channels',
      label: 'Slack channels',
      description: 'Add the Slack channels where users mention the bot. SupaProxy automatically routes each message to the right workspace.',
      source: 'entry_points',
      fields: [
        { name: 'channelName', label: 'Slack channel', type: 'text', required: true, placeholder: '#support', helpText: 'The name of your Slack channel, e.g. #support or #billing.', pattern: '^#[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$', patternError: 'Must start with # followed by letters, numbers, hyphens, or underscores.' },
        { name: 'channelId', label: 'Slack channel ID', type: 'text', required: true, placeholder: 'C0EXAMPLE123', helpText: 'Right-click the channel in Slack, View channel details, copy the ID at the bottom.', pattern: '^[A-Z][A-Z0-9]{8,}$', patternError: 'Must be an uppercase alphanumeric ID (e.g. C0EXAMPLE123).' },
      ],
    },
  ],

  testConfig: {
    fields: [
      { key: 'channel', label: 'Channel', type: 'text', placeholder: '#general', required: true, defaultValue: 'C0TEST' },
      { key: 'userId', label: 'User ID', type: 'text', placeholder: 'U0123456789', required: true, defaultValue: 'U0TEST' },
      { key: 'userName', label: 'User name', type: 'text', placeholder: 'Elvis Magagula' },
      { key: 'message', label: 'Message', type: 'textarea', placeholder: 'Check my account balance', required: true },
    ],
    payloadTemplate: {
      query: '{{message}}',
      consumer_type: 'slack',
      consumer_context: {
        channel: '{{channel}}',
        userId: '{{userId}}',
        userName: '{{userName}}',
        threadId: '{{channel}}:test-thread',
      },
    },
  },

  async validateCredentials(config) {
    const { bot_token, app_token } = config
    if (!bot_token || !app_token) {
      return { ok: false, error: 'Both bot token and app token are required' }
    }
    try {
      const app = new App({ token: bot_token, appToken: app_token, socketMode: true })
      const auth = await app.client.auth.test({ token: bot_token })
      await app.stop()
      return {
        ok: true,
        detail: {
          team: auth.team as string,
          bot_user: auth.user_id as string,
        },
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  },

  async start(ctx, config) {
    const { bot_token, app_token } = config
    if (!bot_token || !app_token) {
      log.warn('No Slack tokens — consumer disabled')
      return
    }

    await this.stop()
    activeCtx = ctx

    const app = new App({ token: bot_token, appToken: app_token, socketMode: true })
    const auth = await app.client.auth.test({ token: bot_token })
    botUserId = auth.user_id as string
    log.info({ botUserId }, 'Bot user resolved')

    // Channel mentions
    app.event('app_mention', async ({ event, say, client }) => {
      const threadTs = event.thread_ts || event.ts
      const query = stripMention(event.text || '')
      handleIncoming(query, event.channel, threadTs, event.ts, event.user || '', client, say as SayFn, ctx)
    })

    // Thread replies + DMs
    app.event('message', async ({ event, say, client }) => {
      const msg = event as SlackMessageEvent
      if (msg.bot_id || msg.user === botUserId) return

      if (msg.thread_ts) {
        const query = stripMention(msg.text || '')
        handleIncoming(query, msg.channel, msg.thread_ts, msg.ts, msg.user || '', client, say as SayFn, ctx)
        return
      }

      if (msg.channel_type === 'im') {
        const query = (msg.text || '').trim()
        handleIncoming(query, msg.channel, msg.ts, msg.ts, msg.user || '', client, say as SayFn, ctx)
      }
    })

    await app.start()
    activeApp = app
    log.info('Slack consumer started (Socket Mode)')
  },

  async stop() {
    if (activeApp) {
      try { await activeApp.stop() } catch { /* ignore */ }
      activeApp = null
      activeCtx = null
    }
  },

  async bindChannel(config: ChannelBindConfig) {
    // Channel binding is handled at the server level (DB write).
    // This hook allows consumers to validate the channel exists.
    if (!activeApp) {
      return { ok: false, error: 'Slack consumer not running' }
    }
    try {
      await activeApp.client.conversations.info({ channel: config.channelId })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: `Channel not found: ${(err as Error).message}` }
    }
  },

  async sendMessage(channel, message, threadId) {
    if (!activeApp) throw new Error('Slack consumer not running')
    await activeApp.client.chat.postMessage({
      channel,
      text: message,
      ...(threadId ? { thread_ts: threadId } : {}),
    })
  },
}
