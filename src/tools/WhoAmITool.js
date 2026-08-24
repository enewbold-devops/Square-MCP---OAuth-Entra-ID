import { z } from 'zod';
import { McpTool } from './base/McpTool.js';

// End-to-end diagnostic: Key Vault -> Square locations, for the single connected merchant.
export class WhoAmITool extends McpTool {
    static toolName = 'who_am_i';
    static description = 'Diagnostic tool: resolves the connected Square merchant/locations end-to-end.';
    static outputSchema = z.object({
        resolved: z.boolean(),
        merchantId: z.string().optional(),
        locationCount: z.number().optional(),
        locations: z.array(z.object({ id: z.string(), name: z.string().optional() })).optional(),
        reason: z.string().optional(),
    });
    static annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

    #squareContextResolver;

    constructor(squareContextResolver) {
        super();
        this.#squareContextResolver = squareContextResolver;
    }

    async handler(_args, principal) {
        try {
            const squareContext = await this.#squareContextResolver.resolve(principal.principalId);
            return {
                resolved: true,
                merchantId: squareContext.merchantId,
                locationCount: squareContext.authorizedLocations.length,
                locations: squareContext.authorizedLocations.map((location) => ({ id: location.id, name: location.name })),
            };
        } catch (error) {
            return { resolved: false, reason: error.message };
        }
    }
}
