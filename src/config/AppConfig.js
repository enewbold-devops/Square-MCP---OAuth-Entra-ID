// Fail-fast app settings wrapper - replaces the per-call "app setting not configured" errors from azfn-mcp.
export class AppConfig {
    keyVaultUri;
    squareOAuthRedirectUri;
    port;
    allowedHosts;
    publicBaseUrl;
    easyAuthDevPrincipal;

    constructor(env = process.env) {
        this.keyVaultUri = this.#require(env, 'KeyVaultUri');
        this.squareOAuthRedirectUri = this.#require(env, 'SquareOAuthRedirectUri');
        this.port = Number(env.PORT) || 3000;
        this.allowedHosts = this.#resolveAllowedHosts(env);
        this.publicBaseUrl = this.#resolvePublicBaseUrl(env);
        this.easyAuthDevPrincipal = this.#resolveEasyAuthDevPrincipal(env);
    }

    // Local-only stand-in for App Service Authentication, which never runs outside App Service
    // itself (no X-MS-CLIENT-PRINCIPAL* headers locally). Format: "tenantId:objectId[:displayName]".
    // Refuses to activate when WEBSITE_HOSTNAME is set, so a stray dev setting can never bypass
    // Easy Auth on a real deployment.
    #resolveEasyAuthDevPrincipal(env) {
        if (env.WEBSITE_HOSTNAME || !env.EasyAuthDevPrincipal) {
            return null;
        }
        return env.EasyAuthDevPrincipal;
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
        const hosts = new Set(['localhost', '127.0.0.1', '[::1]', 'enewbold-square-mcp-d8bvfkazg9h7hjdn.eastus-01.azurewebsites.net']);
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
