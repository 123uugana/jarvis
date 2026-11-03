import { z } from 'zod'

/** Local tools share the same schemas between direct commands and OpenCode MCP. */
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
