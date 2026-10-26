import { z } from 'zod'

/** Minimal local tool registry used by the Ashna Chat Completions loop. */
export function tool(name, description, shape, execute) {
  const schema = z.object(shape)
  return {
    name,
    description,
    parameters: z.toJSONSchema(schema, { unrepresentable: 'any' }),
    execute: async (input, context = {}) => execute(schema.parse(input), context),
  }
}

export function createToolServer(server) {
  return server
}
