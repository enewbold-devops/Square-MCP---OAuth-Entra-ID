import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const STATE_TTL_MS = 15 * 60 * 1000;

// Signed and durable OAuth transactions: a HMAC protects integrity while Key Vault records and
// consumes each nonce once. This prevents a leaked connect link or callback state from being reused.
export class OAuthStateSigner {
    #keyVaultService;
    #signingKey = null;

    constructor(keyVaultService) {
        this.#keyVaultService = keyVaultService;
    }

    async #getSigningKey() {
        if (!this.#signingKey) {
            this.#signingKey = await this.#keyVaultService.getSecret('Square-OAuthStateSigningKey');
        }
        return this.#signingKey;
    }

    #sign(payload, key) {
        return createHmac('sha256', key).update(payload).digest('hex');
    }

    async create(principalId, purpose) {
        if (!['connect-link', 'square-callback'].includes(purpose)) {
            throw new Error('Invalid OAuth transaction purpose.');
        }
        const key = await this.#getSigningKey();
        const encodedPrincipalId = Buffer.from(principalId, 'utf-8').toString('base64url');
        const nonce = randomBytes(16).toString('hex');
        const timestamp = Date.now().toString();
        const payload = `${purpose}.${encodedPrincipalId}.${nonce}.${timestamp}`;
        await this.#keyVaultService.createOAuthTransaction(nonce, {
            purpose,
            principalId,
            expiresAt: Date.now() + STATE_TTL_MS,
        });
        return `${payload}.${this.#sign(payload, key)}`;
    }

    // Atomically consumes the server-side transaction after validating the token signature, its
    // purpose, expiry, and bound Entra principal. It returns the bound principal ID or null.
    async consume(state, expectedPurpose) {
        if (typeof state !== 'string') {
            return null;
        }
        const parts = state.split('.');
        if (parts.length !== 5) {
            return null;
        }
        const [purpose, encodedPrincipalId, nonce, timestamp, signature] = parts;
        if (purpose !== expectedPurpose) {
            return null;
        }
        const payload = `${purpose}.${encodedPrincipalId}.${nonce}.${timestamp}`;
        const key = await this.#getSigningKey();
        const expected = this.#sign(payload, key);

        const expectedBuffer = Buffer.from(expected, 'hex');
        const actualBuffer = Buffer.from(signature, 'hex');
        if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
            return null;
        }

        const issuedAt = Number(timestamp);
        if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > STATE_TTL_MS || issuedAt > Date.now() + 30_000) {
            return null;
        }

        let principalId;
        try {
            principalId = Buffer.from(encodedPrincipalId, 'base64url').toString('utf-8');
        } catch {
            return null;
        }

        // Do not convert Key Vault outages or authorization failures into an "invalid link". The
        // caller must receive an operational error so monitoring can distinguish an attack from a
        // dependency incident.
        const consumed = await this.#keyVaultService.consumeOAuthTransaction(nonce);
        return consumed ? principalId : null;
    }
}
