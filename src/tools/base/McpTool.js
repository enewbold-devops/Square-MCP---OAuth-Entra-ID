// Abstract base for every MCP tool - centralizes the CallToolResult envelope and error handling so
// concrete tools just return a plain result object (or throw) from handler(args, principal).
import { resolvePrincipal } from './Principal.js';
import { writeAuditEvent } from '../../security/AuditLogger.js';
import { authorizeTool } from '../../security/ToolAuthorization.js';

export class McpTool {
    async handler(_args, _principal) {
        throw new Error(`${this.constructor.name} must implement handler(args, principal).`);
    }

    async run(args, ctx) {
        let principal;
        try {
            principal = resolvePrincipal(ctx);
            authorizeTool(principal, this.constructor.toolName);
            const result = await this.handler(args ?? {}, principal);
            writeAuditEvent({
                event: 'mcp.tool.invocation',
                tool: this.constructor.toolName,
                principal,
                outcome: 'success',
                requestId: principal.requestId,
            });
            return {
                content: [{ type: 'text', text: JSON.stringify(result) }],
                structuredContent: result,
            };
        } catch (error) {
            writeAuditEvent({
                event: 'mcp.tool.invocation',
                tool: this.constructor.toolName,
                principal,
                outcome: 'failure',
                requestId: principal?.requestId,
                reason: error.message,
            });
            return {
                content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }],
                isError: true,
            };
        }
    }
}
