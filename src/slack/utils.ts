import type { App } from '@slack/bolt'

type SlackClient = App['client']

const userNameCache = new Map<string, string>()

/** Strip @mention tags from Slack message text. */
export function stripMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>\s*/g, '').trim()
}

/** Resolve a Slack user ID to their display name, with caching. */
export async function resolveUserName(userId: string, client: SlackClient): Promise<string> {
  if (userNameCache.has(userId)) return userNameCache.get(userId)!
  try {
    const info = await client.users.info({ user: userId })
    const name = info.user?.real_name || info.user?.name || userId
    userNameCache.set(userId, name)
    return name
  } catch {
    return userId
  }
}
