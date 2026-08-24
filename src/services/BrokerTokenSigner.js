import { randomUUID } from 'node:crypto';
import { SignJWT, exportJWK, exportPKCS8, generateKeyPair, importJWK, importPKCS8, jwtVerify } from 'jose';

const SIGNING_KEY_SECRET_NAME = 'Mcp-BrokerSigningKey';
const ALG = 'RS256';

// Issues and verifies the MCP-facing access token this server's OAuth broker mints after an Entra
// sign-in - separate from the Square OAuth tokens, and the first asymmetric signer in this codebase
// (OAuthStateSigner/PreviewTokenSigner are HMAC because nothing outside this process reads them;
// this one's public key is meant to be published via JWKS).
export class BrokerTokenSigner {
    #keyVaultService;
    #keyMaterial = null;

    constructor(keyVaultService) {
        this.#keyVaultService = keyVaultService;
    }

    // Lazily loads the persisted signing key, or generates and persists one on first use -
    // every instance of this app must share the same key, hence storing it in Key Vault rather
    // than generating a fresh one per process.
    async #getKeyMaterial() {
        if (this.#keyMaterial) {
            return this.#keyMaterial;
        }

        const existing = await this.#keyVaultService.tryGetSecret(SIGNING_KEY_SECRET_NAME);
        if (existing) {
            const stored = JSON.parse(existing);
            const privateKey = await importPKCS8(stored.privateKeyPkcs8, ALG);
            const publicKey = await importJWK(stored.publicJwk, ALG);
            this.#keyMaterial = { privateKey, publicKey, publicJwk: stored.publicJwk, kid: stored.kid };
            return this.#keyMaterial;
        }

        const { privateKey, publicKey } = await generateKeyPair(ALG, { extractable: true });
        const publicJwk = await exportJWK(publicKey);
        const privateKeyPkcs8 = await exportPKCS8(privateKey);
        const kid = randomUUID();

        await this.#keyVaultService.setSecret(SIGNING_KEY_SECRET_NAME, JSON.stringify({ privateKeyPkcs8, publicJwk, kid }));

        this.#keyMaterial = { privateKey, publicKey, publicJwk, kid };
        return this.#keyMaterial;
    }

    async sign(claims, { issuer, audience, expiresInSeconds }) {
        const { privateKey, kid } = await this.#getKeyMaterial();
        return new SignJWT(claims)
            .setProtectedHeader({ alg: ALG, kid })
            .setIssuedAt()
            .setIssuer(issuer)
            .setAudience(audience)
            .setExpirationTime(`${expiresInSeconds}s`)
            .sign(privateKey);
    }

    async verify(token, { issuer, audience }) {
        const { publicKey } = await this.#getKeyMaterial();
        const { payload } = await jwtVerify(token, publicKey, { issuer, audience });
        return payload;
    }

    // RFC 7517 JWK Set for the /.well-known/jwks.json route.
    async getJwks() {
        const { publicJwk, kid } = await this.#getKeyMaterial();
        return { keys: [{ ...publicJwk, kid, alg: ALG, use: 'sig' }] };
    }
}
