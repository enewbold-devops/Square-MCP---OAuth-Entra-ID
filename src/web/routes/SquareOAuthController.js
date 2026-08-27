import { SquareContextResolver } from '../../services/SquareContextResolver.js';

export class SquareOAuthController {
    #config;
    #oauthStateSigner;
    #squareOAuthService;
    #keyVaultService;
    #authMiddleware;

    constructor({ config, oauthStateSigner, squareOAuthService, keyVaultService, authMiddleware }) {
        this.#config = config;
        this.#oauthStateSigner = oauthStateSigner;
        this.#squareOAuthService = squareOAuthService;
        this.#keyVaultService = keyVaultService;
        this.#authMiddleware = authMiddleware;
    }

    registerRoutes(app) {
        app.get('/square/oauth/start', this.#authMiddleware, (req, res) => this.#start(req, res));
        app.get('/square/oauth/callback', (req, res) => this.#callback(req, res));
    }

    // Browser entry point for "Connect Square" - requires the one-time, principal-bound link token
    // an authenticated MCP tool call minted (never reachable anonymously), so the resulting Square
    // connection is bound to whichever franchise owner actually asked to connect.
    async #start(req, res) {
        try {
            const { link } = req.query;
            const principalId = await this.#oauthStateSigner.consume(link, 'connect-link');
            const browserPrincipalId = this.#principalIdFromRequest(req);
            if (!principalId || !browserPrincipalId || principalId !== browserPrincipalId) {
                res.status(400).json({ error: 'This connection link is invalid or has expired. Ask the agent to generate a new one.' });
                return;
            }

            const { applicationId } = await this.#squareOAuthService.getApplicationCredentials();
            const state = await this.#oauthStateSigner.create(principalId, 'square-callback');
            const authorizeBaseUrl = await this.#squareOAuthService.getOAuthAuthorizeBaseUrl();

            const authorizeUrl = new URL(authorizeBaseUrl);
            authorizeUrl.searchParams.set('client_id', applicationId);
            authorizeUrl.searchParams.set('scope', this.#squareOAuthService.constructor.SQUARE_OAUTH_SCOPES.join(' '));
            authorizeUrl.searchParams.set('session', 'false');
            authorizeUrl.searchParams.set('state', state);
            authorizeUrl.searchParams.set('redirect_uri', this.#config.squareOAuthRedirectUri);

            res.redirect(302, authorizeUrl.toString());
        } catch (error) {
            console.error('Failed to start Square OAuth flow:', error.message);
            res.status(500).json({ error: 'Unable to start Square connection. Please try again later.' });
        }
    }

    // Square's OAuth redirect target - the signed `state` both proves this round-trip is genuine
    // and carries the principalId of whichever franchise owner initiated the connection.
    async #callback(req, res) {
        const { code, state } = req.query;

        const principalId = await this.#oauthStateSigner.consume(state, 'square-callback');
        if (!principalId || !code) {
            res.status(400).set('Content-Type', 'text/html').send('<p>Square connection failed. Please try again.</p>');
            return;
        }

        try {
            const response = await this.#squareOAuthService.obtainToken({
                code,
                redirectUri: this.#config.squareOAuthRedirectUri,
            });

            await this.#keyVaultService.setSquareToken(SquareContextResolver.secretNameFor(principalId), {
                accessToken: response.accessToken,
                refreshToken: response.refreshToken,
                expiresAt: response.expiresAt,
                merchantId: response.merchantId,
                obtainedAt: new Date().toISOString(),
            });

            res.status(200).set('Content-Type', 'text/html').send('<p>Square connected. You can close this window.</p>');
        } catch (error) {
            console.error('Square OAuth authorization code exchange failed:', error.message);
            res.status(400).set('Content-Type', 'text/html').send('<p>Square connection failed. Please try again.</p>');
        }
    }

    #principalIdFromRequest(req) {
        const tenantId = req.auth?.extra?.tid;
        const objectId = req.auth?.extra?.oid;
        return tenantId && objectId ? `${tenantId}:${objectId}` : null;
    }
}
