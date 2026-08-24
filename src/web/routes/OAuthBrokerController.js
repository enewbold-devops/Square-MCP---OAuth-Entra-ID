import { randomUUID, createHash } from 'node:crypto';
import express from 'express';

const PENDING_REQUEST_TTL_MS = 10 * 60 * 1000;
const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const DEFAULT_SCOPE = 'mcp.read mcp.write';

function base64UrlSha256(value) {
    return createHash('sha256').update(value).digest('base64url');
}

// The PKCE authorization server ChatGPT talks to: fronts Entra sign-in with metadata that satisfies
// ChatGPT's MCP requirement (code_challenge_methods_supported: ["S256"]), which Entra's own discovery
// document does not reliably advertise. Pending requests and issued codes are in-memory - fine for a
// single-instance App Service, but won't survive a restart or scale-out (see plan follow-ups).
export class OAuthBrokerController {
    #config;
    #entraOAuthService;
    #brokerTokenSigner;
    #pendingRequests = new Map();
    #authorizationCodes = new Map();

    constructor({ config, entraOAuthService, brokerTokenSigner }) {
        this.#config = config;
        this.#entraOAuthService = entraOAuthService;
        this.#brokerTokenSigner = brokerTokenSigner;
    }

    get issuer() {
        return this.#config.publicBaseUrl;
    }

    get mcpResourceUrl() {
        return `${this.#config.publicBaseUrl}/mcp`;
    }

    get #entraRedirectUri() {
        return `${this.#config.publicBaseUrl}/oauth/entra/callback`;
    }

    registerRoutes(app) {
        app.get('/oauth/authorize', (req, res) => this.#authorize(req, res));
        app.get('/oauth/entra/callback', (req, res) => this.#entraCallback(req, res));
        app.post('/oauth/token', express.urlencoded({ extended: false }), (req, res) => this.#token(req, res));
        app.get('/.well-known/jwks.json', (req, res) => this.#jwks(req, res));
    }

    #evictExpired(store) {
        const now = Date.now();
        for (const [key, value] of store) {
            if (value.expiresAt < now) {
                store.delete(key);
            }
        }
    }

    // Entry point ChatGPT's MCP client redirects the user to - validates the PKCE params it must
    // send, then hands off to Entra for the actual sign-in.
    async #authorize(req, res) {
        const { response_type: responseType, client_id: clientId, redirect_uri: redirectUri, state: clientState, code_challenge: codeChallenge, code_challenge_method: codeChallengeMethod, resource, scope } = req.query;

        if (responseType !== 'code' || !clientId || !redirectUri || !codeChallenge || codeChallengeMethod !== 'S256') {
            res.status(400).json({ error: 'invalid_request', error_description: 'response_type=code with a PKCE S256 code_challenge is required.' });
            return;
        }

        this.#evictExpired(this.#pendingRequests);
        const requestId = randomUUID();
        this.#pendingRequests.set(requestId, {
            clientId,
            clientRedirectUri: redirectUri,
            clientState: clientState ?? '',
            codeChallenge,
            resource: resource ?? this.mcpResourceUrl,
            scope: scope ?? DEFAULT_SCOPE,
            expiresAt: Date.now() + PENDING_REQUEST_TTL_MS,
        });

        try {
            const entraAuthorizeUrl = await this.#entraOAuthService.getAuthorizeUrl({
                redirectUri: this.#entraRedirectUri,
                state: requestId,
            });
            res.redirect(302, entraAuthorizeUrl);
        } catch (error) {
            console.error('Failed to start Entra sign-in:', error.message);
            res.status(500).json({ error: 'server_error', error_description: 'Unable to start sign-in. Please try again later.' });
        }
    }

    // Entra's redirect target - exchanges Entra's code server-to-server, then mints this broker's
    // own single-use authorization code bound to the original ChatGPT PKCE challenge.
    async #entraCallback(req, res) {
        const { code, state: requestId } = req.query;
        const pending = this.#pendingRequests.get(requestId);
        this.#pendingRequests.delete(requestId);

        if (!code || !pending || pending.expiresAt < Date.now()) {
            res.status(400).set('Content-Type', 'text/html').send('<p>Sign-in failed or expired. Please try connecting again.</p>');
            return;
        }

        try {
            const principal = await this.#entraOAuthService.exchangeCodeForIdentity({ code, redirectUri: this.#entraRedirectUri });

            this.#evictExpired(this.#authorizationCodes);
            const brokerCode = randomUUID();
            this.#authorizationCodes.set(brokerCode, {
                principal,
                codeChallenge: pending.codeChallenge,
                redirectUri: pending.clientRedirectUri,
                resource: pending.resource,
                scope: pending.scope,
                expiresAt: Date.now() + AUTHORIZATION_CODE_TTL_MS,
            });

            const redirectUrl = new URL(pending.clientRedirectUri);
            redirectUrl.searchParams.set('code', brokerCode);
            redirectUrl.searchParams.set('state', pending.clientState);
            res.redirect(302, redirectUrl.toString());
        } catch (error) {
            console.error('Entra sign-in exchange failed:', error.message);
            res.status(400).set('Content-Type', 'text/html').send('<p>Sign-in failed. Please try connecting again.</p>');
        }
    }

    // ChatGPT's token exchange - verifies the PKCE code_verifier against the stored challenge and
    // issues the MCP access token, scoped to this MCP resource, never to Entra itself.
    async #token(req, res) {
        const { grant_type: grantType, code, redirect_uri: redirectUri, code_verifier: codeVerifier } = req.body ?? {};

        if (grantType !== 'authorization_code') {
            res.status(400).json({ error: 'unsupported_grant_type' });
            return;
        }

        const record = this.#authorizationCodes.get(code);
        this.#authorizationCodes.delete(code);

        if (!record || record.expiresAt < Date.now() || record.redirectUri !== redirectUri) {
            res.status(400).json({ error: 'invalid_grant' });
            return;
        }

        if (!codeVerifier || base64UrlSha256(codeVerifier) !== record.codeChallenge) {
            res.status(400).json({ error: 'invalid_grant', error_description: 'code_verifier does not match the original code_challenge.' });
            return;
        }

        try {
            const accessToken = await this.#brokerTokenSigner.sign(
                {
                    tid: record.principal.tenantId,
                    oid: record.principal.objectId,
                    name: record.principal.displayName,
                    scope: record.scope,
                },
                { issuer: this.issuer, audience: record.resource, expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS }
            );

            res.json({
                access_token: accessToken,
                token_type: 'Bearer',
                expires_in: ACCESS_TOKEN_TTL_SECONDS,
                scope: record.scope,
            });
        } catch (error) {
            console.error('Failed to issue access token:', error.message);
            res.status(500).json({ error: 'server_error' });
        }
    }

    async #jwks(_req, res) {
        try {
            res.json(await this.#brokerTokenSigner.getJwks());
        } catch (error) {
            console.error('Failed to load JWKS:', error.message);
            res.status(500).json({ error: 'server_error' });
        }
    }
}
