// Abstract base for every MCP tool - centralizes the CallToolResult envelope and error handling so
// concrete tools just return a plain result object (or throw) from handler(args, principal).
import { resolvePrincipal } from './Principal.js';

export class McpTool {
    async handler(_args, _principal) {
        throw new Error(`${this.constructor.name} must implement handler(args, principal).`);
    }

    async run(args, ctx) {
        try {
            const principal = resolvePrincipal(ctx);
            const result = await this.handler(args ?? {}, principal);
            return {
                content: [{ type: 'text', text: JSON.stringify(result) }],
                structuredContent: result,
            };
        } catch (error) {
            return {
                content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }],
                isError: true,
            };
        }
    }
}
