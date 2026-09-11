import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';

// Implements the MCP SDK's OAuthTokenVerifier contract for requireBearerAuth - validates the MCP
// access token this server's own broker issued (not a raw Entra token; Entra is only ever seen by
// EntraOAuthService during the broker->Entra leg).
export class McpTokenVerifier {
    #brokerTokenSigner;
    #issuer;
    #audience;

    constructor(brokerTokenSigner, { issuer, audience }) {
        this.#brokerTokenSigner = brokerTokenSigner;
        this.#issuer = issuer;
        this.#audience = audience;
    }

    async verifyAccessToken(token) {
        let claims;
        try {
            claims = await this.#brokerTokenSigner.verify(token, { issuer: this.#issuer, audience: this.#audience });
        } catch {
            throw new OAuthError(OAuthErrorCode.InvalidToken, 'The access token is invalid, expired, or was not issued by this server.');
        }

        if (!claims.tid || !claims.oid) {
            throw new OAuthError(OAuthErrorCode.InvalidToken, 'The access token is missing the expected enterprise principal claims.');
        }

        return {
            token,
            clientId: claims.client_id ?? 'chatgpt',
            scopes: typeof claims.scope === 'string' ? claims.scope.split(' ') : [],
            expiresAt: claims.exp,
            extra: { tid: claims.tid, oid: claims.oid, displayName: claims.name },
        };
    }
}
