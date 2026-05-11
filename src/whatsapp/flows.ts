import pino from 'pino'

const log = pino({ name: 'whatsapp-flows' })

const GRAPH_API = 'https://graph.facebook.com/v21.0'

/**
 * A tool's input schema as defined by MCP.
 * This is what we convert into a WhatsApp Flow form.
 */
export interface ToolInputSchema {
  type: 'object'
  properties: Record<string, {
    type: string
    description?: string
    enum?: string[]
    minimum?: number
    maximum?: number
  }>
  required?: string[]
}

/** Pending flow session waiting for user to submit the form. */
export interface FlowSession {
  flowId: string
  toolName: string
  toolConnection: string
  workspaceId: string
  userId: string
  schema: ToolInputSchema
  createdAt: number
}

// In-memory store for active flow sessions (keyed by flow_token)
const activeSessions = new Map<string, FlowSession>()

/**
 * Convert a tool input schema property to a WhatsApp Flow form component.
 */
function schemaPropertyToComponent(
  name: string,
  prop: ToolInputSchema['properties'][string],
  required: boolean,
): Record<string, unknown> {
  // Enum → Dropdown
  if (prop.enum && prop.enum.length > 0) {
    return {
      type: 'Dropdown',
      name,
      label: formatLabel(name),
      required,
      'data-source': prop.enum.map(v => ({ id: v, title: v })),
      ...(prop.description ? { 'helper-text': prop.description } : {}),
    }
  }

  // Map JSON schema types to WhatsApp input types
  switch (prop.type) {
    case 'number':
    case 'integer':
      return {
        type: 'TextInput',
        name,
        label: formatLabel(name),
        'input-type': 'number',
        required,
        ...(prop.description ? { 'helper-text': prop.description } : {}),
      }

    case 'boolean':
      return {
        type: 'OptIn',
        name,
        label: formatLabel(name),
        required,
      }

    default: {
      // Detect special fields by name
      const lower = name.toLowerCase()
      let inputType = 'text'
      if (lower.includes('email')) inputType = 'email'
      else if (lower.includes('phone') || lower.includes('mobile') || lower.includes('cell')) inputType = 'phone'

      return {
        type: 'TextInput',
        name,
        label: formatLabel(name),
        'input-type': inputType,
        required,
        ...(prop.description ? { 'helper-text': prop.description } : {}),
      }
    }
  }
}

/** Convert snake_case or camelCase to a readable label. */
function formatLabel(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, c => c.toUpperCase())
}

/**
 * Generate a WhatsApp Flow JSON from a tool's input schema.
 * Creates a single-screen form with all fields.
 */
export function generateFlowJson(toolName: string, schema: ToolInputSchema): Record<string, unknown> {
  const requiredFields = new Set(schema.required || [])
  const children: Record<string, unknown>[] = []

  // Description header
  children.push({
    type: 'TextHeading',
    text: formatLabel(toolName),
  })

  // Form wrapper with all fields
  const formChildren: Record<string, unknown>[] = []

  for (const [name, prop] of Object.entries(schema.properties)) {
    formChildren.push(schemaPropertyToComponent(name, prop, requiredFields.has(name)))
  }

  children.push({
    type: 'Form',
    name: 'tool_form',
    children: formChildren,
  })

  // Submit footer
  children.push({
    type: 'Footer',
    label: 'Submit',
    'on-click-action': {
      name: 'complete',
      payload: Object.fromEntries(
        Object.keys(schema.properties).map(k => [k, `\${form.${k}}`])
      ),
    },
  })

  return {
    version: '5.0',
    screens: [
      {
        id: 'FORM_SCREEN',
        title: formatLabel(toolName),
        terminal: true,
        layout: {
          type: 'SingleColumnLayout',
          children,
        },
      },
    ],
  }
}

/**
 * Create a WhatsApp Flow via the Graph API.
 * Returns the flow ID.
 */
export async function createFlow(
  accessToken: string,
  wabaId: string,
  name: string,
  flowJson: Record<string, unknown>,
): Promise<string> {
  // Step 1: Create the flow
  const createRes = await fetch(`${GRAPH_API}/${wabaId}/flows`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      categories: ['OTHER'],
    }),
  })

  if (!createRes.ok) {
    const err = await createRes.text()
    throw new Error(`Failed to create flow: ${err}`)
  }

  const createData = await createRes.json() as { id: string }
  const flowId = createData.id

  // Step 2: Upload the flow JSON
  const formData = new FormData()
  const jsonBlob = new Blob([JSON.stringify(flowJson)], { type: 'application/json' })
  formData.append('file', jsonBlob, 'flow.json')
  formData.append('name', 'flow.json')
  formData.append('asset_type', 'FLOW_JSON')

  const uploadRes = await fetch(`${GRAPH_API}/${flowId}/assets`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}` },
    body: formData,
  })

  if (!uploadRes.ok) {
    const err = await uploadRes.text()
    log.error({ flowId, error: err }, 'Failed to upload flow JSON')
    throw new Error(`Failed to upload flow JSON: ${err}`)
  }

  log.info({ flowId, name }, 'WhatsApp Flow created')
  return flowId
}

/**
 * Send a flow message to a WhatsApp user.
 */
export async function sendFlowMessage(
  accessToken: string,
  phoneNumberId: string,
  to: string,
  flowId: string,
  flowToken: string,
  headerText: string,
  bodyText: string,
): Promise<void> {
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
      type: 'interactive',
      interactive: {
        type: 'flow',
        header: { type: 'text', text: headerText },
        body: { text: bodyText },
        footer: { text: 'Powered by SupaProxy' },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            flow_id: flowId,
            flow_token: flowToken,
            mode: 'draft',
            flow_cta: 'Fill in details',
            flow_action: 'navigate',
            flow_action_payload: {
              screen: 'FORM_SCREEN',
            },
          },
        },
      },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    log.error({ status: res.status, body: err }, 'Failed to send flow message')
    throw new Error(`Failed to send flow message: ${err}`)
  }

  log.info({ to, flowId }, 'Flow message sent')
}

/**
 * Register a flow session so we can match the submission back to the tool call.
 */
export function registerFlowSession(flowToken: string, session: FlowSession): void {
  activeSessions.set(flowToken, session)
  // Auto-expire after 30 minutes
  setTimeout(() => activeSessions.delete(flowToken), 30 * 60 * 1000)
}

/**
 * Get and remove a flow session by token.
 */
export function consumeFlowSession(flowToken: string): FlowSession | null {
  const session = activeSessions.get(flowToken)
  if (session) activeSessions.delete(flowToken)
  return session || null
}

/**
 * Handle a flow completion webhook.
 * Called when the user submits the form.
 * Returns the form data and session info, or null if no session found.
 */
export function handleFlowCompletion(flowToken: string, formData: Record<string, unknown>): {
  session: FlowSession
  data: Record<string, unknown>
} | null {
  const session = consumeFlowSession(flowToken)
  if (!session) {
    log.warn({ flowToken }, 'No active session for flow token')
    return null
  }

  log.info({ toolName: session.toolName, fields: Object.keys(formData) }, 'Flow form submitted')
  return { session, data: formData }
}
