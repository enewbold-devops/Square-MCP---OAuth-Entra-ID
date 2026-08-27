import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';

export class KeyVaultService {
    #vaultUri;
    #client = null;

    constructor(vaultUri) {
        if (!vaultUri) {
            throw new Error('KeyVaultUri is not configured.');
        }
        this.#vaultUri = vaultUri;
    }

    #getClient() {
        if (!this.#client) {
            this.#client = new SecretClient(this.#vaultUri, new DefaultAzureCredential());
        }
        return this.#client;
    }

    async getSquareToken(secretName) {
        const secret = await this.#getClient().getSecret(secretName);
        return JSON.parse(secret.value);
    }

    async setSquareToken(secretName, tokenPayload) {
        await this.#getClient().setSecret(secretName, JSON.stringify(tokenPayload));
    }

    async markSquareTokenRevoked(secretName) {
        await this.setSquareToken(secretName, { revokedAt: new Date().toISOString() });
    }

    async listSquareConnectionPrincipalIds() {
        const principalIds = [];
        for await (const secret of this.#getClient().listPropertiesOfSecrets()) {
            const match = /^square-oauth-([0-9a-f-]{36})-([0-9a-f-]{36})$/i.exec(secret.name ?? '');
            if (match) {
                principalIds.push(`${match[1]}:${match[2]}`);
            }
        }
        return principalIds;
    }

    // Plain-string secret getter for static app credentials (Square app id/secret, signing keys).
    async getSecret(secretName) {
        const secret = await this.#getClient().getSecret(secretName);
        return secret.value;
    }

    // Plain-string secret setter, for values generated at runtime (e.g. the broker's signing key)
    // rather than provisioned ahead of time.
    async setSecret(secretName, value) {
        await this.#getClient().setSecret(secretName, value);
    }

    async tryGetSquareToken(secretName) {
        const value = await this.tryGetSecret(secretName);
        return value ? JSON.parse(value) : null;
    }

    async createOAuthTransaction(nonce, transaction) {
        const expiresOn = new Date(transaction.expiresAt);
        await this.#getClient().setSecret(this.#oauthTransactionSecretName(nonce), JSON.stringify(transaction), { expiresOn });
    }

    // Begin deletion before reading any transaction data. Key Vault accepts this state transition
    // only once, so callers racing to use the same nonce cannot both succeed.
    async consumeOAuthTransaction(nonce) {
        const secretName = this.#oauthTransactionSecretName(nonce);
        try {
            const poller = await this.#getClient().beginDeleteSecret(secretName);
            await poller.pollUntilDone();
            return true;
        } catch (error) {
            if (error.statusCode === 404 || error.code === 'SecretNotFound') {
                return false;
            }
            throw error;
        }
    }

    #oauthTransactionSecretName(nonce) {
        if (!/^[a-f0-9]{32}$/i.test(nonce)) {
            throw new Error('Invalid OAuth transaction nonce.');
        }
        return `mcp-oauth-tx-${nonce}`;
    }

    // Returns null instead of throwing when the secret has never been created, so callers can
    // distinguish "not provisioned yet" from a genuine Key Vault failure.
    async tryGetSecret(secretName) {
        try {
            return await this.getSecret(secretName);
        } catch (error) {
            if (error.statusCode === 404 || error.code === 'SecretNotFound') {
                return null;
            }
            throw error;
        }
    }
}
