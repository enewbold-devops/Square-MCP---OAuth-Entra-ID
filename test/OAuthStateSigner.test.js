import assert from 'node:assert/strict';
import test from 'node:test';

import { OAuthStateSigner } from '../src/services/OAuthStateSigner.js';

test('creates and consumes a purpose-bound OAuth transaction only once', async () => {
    const transactions = new Map();
    const keyVault = {
        async getSecret(name) {
            assert.equal(name, 'Square-OAuthStateSigningKey');
            return 'test-signing-key';
        },
        async createOAuthTransaction(nonce, value) {
            transactions.set(nonce, value);
        },
        async consumeOAuthTransaction(nonce) {
            if (!transactions.has(nonce)) {
                return false;
            }
            transactions.delete(nonce);
            return true;
        },
    };
    const signer = new OAuthStateSigner(keyVault);
    const state = await signer.create('tenant-id:object-id', 'connect-link');

    assert.equal(await signer.consume(state, 'square-callback'), null);
    assert.equal(await signer.consume(state, 'connect-link'), 'tenant-id:object-id');
    assert.equal(await signer.consume(state, 'connect-link'), null);
});
