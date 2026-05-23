export class PluginNotFoundError extends Error {
  constructor(type: string) {
    super(`Consumer plugin not found: ${type}`)
    this.name = 'PluginNotFoundError'
  }
}
