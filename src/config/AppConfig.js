// Fail-fast app settings wrapper - replaces the per-call "app setting not configured" errors from azfn-mcp.
export class AppConfig {
    keyVaultUri;
    squareOAuthRedirectUri;
    port;
    allowedHosts;
    publicBaseUrl;

    constructor(env = process.env) {
        this.keyVaultUri = this.#require(env, 'KeyVaultUri');
        this.squareOAuthRedirectUri = this.#require(env, 'SquareOAuthRedirectUri');
        this.port = Number(env.PORT) || 3000;
        this.allowedHosts = this.#resolveAllowedHosts(env);
        this.publicBaseUrl = this.#resolvePublicBaseUrl(env);
    }

    // Same WEBSITE_HOSTNAME signal as #resolveAllowedHosts - the broker's issuer/redirect URIs must
    // match wherever this app is actually reachable, with no separate env setting to keep in sync.
    #resolvePublicBaseUrl(env) {
        if (env.WEBSITE_HOSTNAME) {
            return `https://${env.WEBSITE_HOSTNAME}`;
        }
        return `http://localhost:${Number(env.PORT) || 3000}`;
    }

    // WEBSITE_HOSTNAME is auto-injected by Azure App Service (absent locally) - keeps the MCP
    // transport's Host-header allowlist in sync with wherever this app is actually reachable.
    #resolveAllowedHosts(env) {
        const hosts = new Set(['localhost', '127.0.0.1', '[::1]']);
        if (env.WEBSITE_HOSTNAME) {
            hosts.add(env.WEBSITE_HOSTNAME);
        }
        return [...hosts];
    }

    #require(env, name) {
        const value = env[name];
        if (!value) {
            throw new Error(`${name} app setting is not configured.`);
        }
        return value;
    }
}
