import assert from 'node:assert/strict';
import test from 'node:test';

import { AppConfig } from '../src/config/AppConfig.js';

test('uses explicit production hosts, tenant restriction, and callback origin', () => {
    const config = new AppConfig({
        KeyVaultUri: 'https://example.vault.azure.net/',
        SquareOAuthRedirectUri: 'https://mcp.contoso.com/square/oauth/callback',
        WEBSITE_HOSTNAME: 'example.azurewebsites.net',
        McpAllowedHosts: 'mcp.contoso.com',
        EntraAllowedTenantIds: 'tenant-one, tenant-two',
        PORT: '8080',
    });

    assert.equal(config.port, 8080);
    assert.equal(config.publicBaseUrl, 'https://mcp.contoso.com');
    assert.deepEqual(config.allowedHosts.sort(), ['example.azurewebsites.net', 'mcp.contoso.com']);
    assert.deepEqual(config.entraAllowedTenantIds, ['tenant-one', 'tenant-two']);
});

test('refuses Azure startup without an Entra tenant restriction', () => {
    assert.throws(
        () =>
            new AppConfig({
                KeyVaultUri: 'https://example.vault.azure.net/',
                SquareOAuthRedirectUri: 'https://mcp.contoso.com/square/oauth/callback',
                WEBSITE_HOSTNAME: 'example.azurewebsites.net',
            }),
        /EntraAllowedTenantIds/
    );
});
