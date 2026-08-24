import { createHmac, timingSafeEqual } from 'node:crypto';

const PREVIEW_TTL_MS = 15 * 60 * 1000;

// Signs a JSON-serializable payload with an embedded expiry so commit_cash_tips can only ever act on
// an unmodified, still-valid reconcile_cash_tips preview - never a model-invented amount.
export class PreviewTokenSigner {
    #keyVaultService;
    #signingKey = null;

    constructor(keyVaultService) {
        this.#keyVaultService = keyVaultService;
    }

    async #getSigningKey() {
        if (!this.#signingKey) {
            this.#signingKey = await this.#keyVaultService.getSecret('Square-TipPreviewSigningKey');
        }
        return this.#signingKey;
    }

    #sign(body, key) {
        return createHmac('sha256', key).update(body).digest('hex');
    }

    async sign(payload) {
        const key = await this.#getSigningKey();
        const expiresAt = Date.now() + PREVIEW_TTL_MS;
        const body = Buffer.from(JSON.stringify({ payload, expiresAt })).toString('base64url');
        return `${body}.${this.#sign(body, key)}`;
    }

    // Returns the original payload if the token is well-formed, signed with our key, and unexpired; otherwise null.
    async verify(token) {
        if (typeof token !== 'string') {
            return null;
        }
        const dotIndex = token.lastIndexOf('.');
        if (dotIndex === -1) {
            return null;
        }
        const body = token.slice(0, dotIndex);
        const signature = token.slice(dotIndex + 1);
        const key = await this.#getSigningKey();
        const expected = this.#sign(body, key);

        const expectedBuffer = Buffer.from(expected, 'hex');
        const actualBuffer = Buffer.from(signature, 'hex');
        if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
            return null;
        }

        let decoded;
        try {
            decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
        } catch {
            return null;
        }

        if (!decoded || typeof decoded.expiresAt !== 'number' || Date.now() > decoded.expiresAt) {
            return null;
        }

        return decoded.payload;
    }
}
