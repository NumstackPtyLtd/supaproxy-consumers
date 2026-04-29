# @supaproxy/consumers

Plugin package for SupaProxy consumer types. Each consumer is a self-contained plugin implementing the `ConsumerPlugin` interface.

## Architecture

```
src/
├── types.ts          ConsumerPlugin interface, ConfigField, ConsumerContext
├── registry.ts       PluginRegistry (list, get, register, schemas)
├── slack/            Slack consumer (Socket Mode, @slack/bolt)
│   ├── index.ts      slackPlugin implementation
│   └── utils.ts      stripMention, resolveUserName
├── api/              API consumer (REST, Bearer token auth)
│   └── index.ts      apiPlugin stub
└── index.ts          Re-exports + auto-registration
```

## Adding a new consumer

1. Create `src/my-consumer/index.ts` implementing `ConsumerPlugin`
2. Export from `src/index.ts`
3. Auto-register in `src/index.ts`

The dashboard auto-discovers consumers via the server API.

## Code rules

- Each plugin is a single exported object, not a class
- Config schemas drive dashboard form rendering — no hardcoded UI
- Plugins must handle their own cleanup in `stop()`
- Use pino for logging with a named child logger
- All external service calls must handle errors gracefully
