import { SquareContext } from './SquareContext.js';

// Proactive refresh threshold: refresh once 75% of the access token's validity window has elapsed.
const PROACTIVE_REFRESH_FRACTION = 0.75;

export class SquareContextResolver {
    #keyVaultService;
    #squareOAuthService;

    constructor(keyVaultService, squareOAuthService) {
        this.#keyVaultService = keyVaultService;
        this.#squareOAuthService = squareOAuthService;
    }

    // One Key Vault secret per franchise owner (tid:oid) - each owner has exactly one Square merchant
    // connection (with many locations under it), so no separate connection/merchant table is needed.
    static secretNameFor(principalId) {
        const [tenantId, objectId] = principalId.split(':');
        if (!tenantId || !objectId) {
            throw new Error(`Invalid principalId "${principalId}" - expected "tenantId:objectId".`);
        }
        return `square-oauth-${tenantId}-${objectId}`;
    }

    async #refreshSquareToken(principalId, refreshToken) {
        const response = await this.#squareOAuthService.refreshToken(refreshToken);
        const refreshed = {
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            expiresAt: response.expiresAt,
            merchantId: response.merchantId,
            obtainedAt: new Date().toISOString(),
        };
        await this.#keyVaultService.setSquareToken(SquareContextResolver.secretNameFor(principalId), refreshed);
        return refreshed;
    }

    async #getValidToken(principalId) {
        let token;
        try {
            token = await this.#keyVaultService.getSquareToken(SquareContextResolver.secretNameFor(principalId));
        } catch {
            throw new Error('No Square connection found for this account. Call square_connect_account to connect Square.');
        }

        const obtainedAt = new Date(token.obtainedAt).getTime();
        const expiresAt = new Date(token.expiresAt).getTime();
        const proactiveThreshold = obtainedAt + (expiresAt - obtainedAt) * PROACTIVE_REFRESH_FRACTION;

        if (Date.now() < proactiveThreshold) {
            return token;
        }
        return this.#refreshSquareToken(principalId, token.refreshToken);
    }

    async resolve(principalId) {
        const token = await this.#getValidToken(principalId);
        const client = await this.#squareOAuthService.createClient(token.accessToken);
        const { locations } = await client.locations.list();

        return new SquareContext({ merchantId: token.merchantId, client, authorizedLocations: locations ?? [] });
    }
}
