import { SquareContext } from './SquareContext.js';

// Square recommends renewals every seven days or less, rather than waiting near its 30-day token
// expiry. A scheduled worker invokes refreshIfDue for dormant connections.
const MAX_TOKEN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export class SquareConnectionNotFoundError extends Error {
    constructor() {
        super('No Square connection found for this account. Call square_connect_account to connect Square.');
        this.name = 'SquareConnectionNotFoundError';
    }
}

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
        const token = await this.#keyVaultService.tryGetSquareToken(SquareContextResolver.secretNameFor(principalId));
        if (!token || token.revokedAt) {
            throw new SquareConnectionNotFoundError();
        }

        if (!token.accessToken || !token.refreshToken || !token.expiresAt || !token.obtainedAt || !token.merchantId) {
            throw new Error('The stored Square connection is incomplete. Reconnect Square or contact an administrator.');
        }

        const obtainedAt = new Date(token.obtainedAt).getTime();
        const expiresAt = new Date(token.expiresAt).getTime();
        if (!Number.isFinite(obtainedAt) || !Number.isFinite(expiresAt) || expiresAt <= obtainedAt) {
            throw new Error('The stored Square connection has invalid token expiry metadata. Reconnect Square or contact an administrator.');
        }
        const refreshAt = Math.min(obtainedAt + MAX_TOKEN_AGE_MS, expiresAt - 60 * 60 * 1000);

        if (Date.now() < refreshAt) {
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

    async refreshIfDue(principalId) {
        await this.#getValidToken(principalId);
    }

    async disconnect(principalId) {
        const secretName = SquareContextResolver.secretNameFor(principalId);
        const token = await this.#keyVaultService.tryGetSquareToken(secretName);
        if (!token?.accessToken) {
            throw new SquareConnectionNotFoundError();
        }
        await this.#squareOAuthService.revokeToken(token.accessToken);
        await this.#keyVaultService.markSquareTokenRevoked(secretName);
    }
}
