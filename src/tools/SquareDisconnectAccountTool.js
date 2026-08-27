import { z } from 'zod';
import { McpTool } from './base/McpTool.js';

export class SquareDisconnectAccountTool extends McpTool {
    static toolName = 'square_disconnect_account';
    static description = 'Revokes the caller’s Square OAuth authorization and removes this server’s usable token. This cannot be undone; reconnect Square to restore access.';
    static inputSchema = z.object({
        confirmation: z.literal('REVOKE').describe('Type REVOKE to confirm that Square authorization should be revoked.'),
    });
    static outputSchema = z.object({ disconnected: z.literal(true) });
    static annotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

    #squareContextResolver;

    constructor(squareContextResolver) {
        super();
        this.#squareContextResolver = squareContextResolver;
    }

    async handler(_args, principal) {
        await this.#squareContextResolver.disconnect(principal.principalId);
        return { disconnected: true };
    }
}
