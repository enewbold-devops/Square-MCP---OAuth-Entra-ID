import { createRemoteJWKSet, jwtVerify } from 'jose';

// Broker-side confidential client for the upstream Entra sign-in - separate from, and unrelated to,
// SquareOAuthService (Entra proves enterprise identity; Square is a per-owner delegated connection).
export class EntraOAuthService {
    #keyVaultService;
    #tenantId = null;
    #clientId = null;
    #clientSecret = null;
    #jwks = null;

    constructor(keyVaultService) {
        this.#keyVaultService = keyVaultService;
    }

    async #getCredentials() {
        if (!this.#tenantId) {
            this.#tenantId = await this.#keyVaultService.getSecret('Entra-TenantId');
        }
        if (!this.#clientId) {
            this.#clientId = await this.#keyVaultService.getSecret('Entra-ClientId');
        }
        if (!this.#clientSecret) {
            this.#clientSecret = await this.#keyVaultService.getSecret('Entra-ClientSecret');
        }
        return { tenantId: this.#tenantId, clientId: this.#clientId, clientSecret: this.#clientSecret };
    }

    async #getIssuer() {
        const { tenantId } = await this.#getCredentials();
        return `https://login.microsoftonline.com/${tenantId}/v2.0`;
    }

    async getAuthorizeUrl({ redirectUri, state }) {
        const { tenantId, clientId } = await this.#getCredentials();
        const url = new URL(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`);
        url.searchParams.set('client_id', clientId);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('redirect_uri', redirectUri);
        url.searchParams.set('response_mode', 'query');
        url.searchParams.set('scope', 'openid profile email');
        url.searchParams.set('state', state);
        return url.toString();
    }

    // Exchanges Entra's authorization code and returns the caller's stable enterprise identity
    // (tenantId/objectId), verified from the signed ID token rather than trusted from raw claims.
    async exchangeCodeForIdentity({ code, redirectUri }) {
        const { tenantId, clientId, clientSecret } = await this.#getCredentials();
        const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

        const body = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
        });

        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        });
        if (!response.ok) {
            throw new Error(`Entra token exchange failed: ${response.status} ${await response.text()}`);
        }
        const { id_token: idToken } = await response.json();
        if (!idToken) {
            throw new Error('Entra token response did not include an id_token.');
        }

        if (!this.#jwks) {
            this.#jwks = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`));
        }
        const issuer = await this.#getIssuer();
        const { payload } = await jwtVerify(idToken, this.#jwks, { issuer, audience: clientId });

        if (!payload.tid || !payload.oid) {
            throw new Error('Entra ID token is missing tid/oid claims.');
        }
        return { tenantId: payload.tid, objectId: payload.oid, displayName: payload.name };
    }
}
