import 'dotenv/config';

import { AppConfig } from '../src/config/AppConfig.js';
import { KeyVaultService } from '../src/services/KeyVaultService.js';
import { SquareConnectionNotFoundError, SquareContextResolver } from '../src/services/SquareContextResolver.js';
import { SquareOAuthService } from '../src/services/SquareOAuthService.js';

const config = new AppConfig();
const keyVault = new KeyVaultService(config.keyVaultUri);
const resolver = new SquareContextResolver(keyVault, new SquareOAuthService(keyVault));
const principalIds = await keyVault.listSquareConnectionPrincipalIds();

let failures = 0;
for (const principalId of principalIds) {
    try {
        await resolver.refreshIfDue(principalId);
        console.log(JSON.stringify({ event: 'square.token.refresh', outcome: 'success', timestamp: new Date().toISOString() }));
    } catch (error) {
        if (error instanceof SquareConnectionNotFoundError) {
            continue;
        }
        failures += 1;
        console.error(
            JSON.stringify({
                event: 'square.token.refresh',
                outcome: 'failure',
                reason: error.message,
                timestamp: new Date().toISOString(),
            })
        );
    }
}

if (failures > 0) {
    process.exitCode = 1;
}
