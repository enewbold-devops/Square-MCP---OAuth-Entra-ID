import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const STATE_TTL_MS = 15 * 60 * 1000;

// Signed, stateless 'state'/link token: principalId.nonce.timestamp.hmac. Binds the token to the
// enterprise principal that initiated it, so a Square-connect link minted for one franchise owner
// can't be replayed to attach a different owner's Square account (the account-binding attack the
// MCP third-party-auth guidance warns about). Used both as the one-time "Connect Square" link a tool
// mints, and as the state param that round-trips through Square's OAuth callback.
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

    async create(principalId) {
        const key = await this.#getSigningKey();
        const encodedPrincipalId = Buffer.from(principalId, 'utf-8').toString('base64url');
        const nonce = randomBytes(16).toString('hex');
        const timestamp = Date.now().toString();
        const payload = `${encodedPrincipalId}.${nonce}.${timestamp}`;
        return `${payload}.${this.#sign(payload, key)}`;
    }

    // Returns the bound principalId if the token is well-formed, signed with our key, and within
    // TTL_MS; otherwise null.
    async verify(state) {
        if (typeof state !== 'string') {
            return null;
        }
        const parts = state.split('.');
        if (parts.length !== 4) {
            return null;
        }
        const [encodedPrincipalId, nonce, timestamp, signature] = parts;
        const payload = `${encodedPrincipalId}.${nonce}.${timestamp}`;
        const key = await this.#getSigningKey();
        const expected = this.#sign(payload, key);

        const expectedBuffer = Buffer.from(expected, 'hex');
        const actualBuffer = Buffer.from(signature, 'hex');
        if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
            return null;
        }

        const issuedAt = Number(timestamp);
        if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > STATE_TTL_MS) {
            return null;
        }

        try {
            return Buffer.from(encodedPrincipalId, 'base64url').toString('utf-8');
        } catch {
            return null;
        }
    }
}
