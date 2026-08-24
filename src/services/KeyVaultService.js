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
