import { z } from 'zod';
import { McpTool } from './base/McpTool.js';
import { SquareConnectionNotFoundError } from '../services/SquareContextResolver.js';

// Entry point for linking a franchise owner's personal Square account. Mints a one-time,
// principal-bound "Connect Square" link rather than ever returning a raw Square authorize URL -
// closing the account-binding gap where one user's link could be used to attach someone else's
// Square account to the wrong enterprise principal.
export class SquareConnectAccountTool extends McpTool {
    static toolName = 'square_connect_account';
    static description = 'Checks whether the caller has a connected Square account and, if not, returns a one-time link to connect one.';
    static outputSchema = z.object({
        connected: z.boolean(),
        merchantId: z.string().optional(),
        locationCount: z.number().optional(),
        connectUrl: z.string().optional(),
    });
    static annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

    #squareContextResolver;
    #oauthStateSigner;
    #config;

    constructor(squareContextResolver, oauthStateSigner, config) {
        super();
        this.#squareContextResolver = squareContextResolver;
        this.#oauthStateSigner = oauthStateSigner;
        this.#config = config;
    }

    async handler(_args, principal) {
        try {
            const squareContext = await this.#squareContextResolver.resolve(principal.principalId);
            return { connected: true, merchantId: squareContext.merchantId, locationCount: squareContext.authorizedLocations.length };
        } catch (error) {
            if (!(error instanceof SquareConnectionNotFoundError)) {
                throw error;
            }
            const link = await this.#oauthStateSigner.create(principal.principalId, 'connect-link');
            const connectUrl = `${this.#config.publicBaseUrl}/square/oauth/start?link=${link}`;
            return { connected: false, connectUrl };
        }
    }
}
