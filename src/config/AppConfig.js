// Fail-fast app settings wrapper - replaces the per-call "app setting not configured" errors from azfn-mcp.
export class AppConfig {
    keyVaultUri;
    squareOAuthRedirectUri;
    port;
    allowedHosts;
    publicBaseUrl;
    easyAuthDevPrincipal;
    easyAuthDevRoles;
    entraAllowedTenantIds;

    constructor(env = process.env) {
        this.keyVaultUri = this.#require(env, 'KeyVaultUri');
        this.squareOAuthRedirectUri = this.#require(env, 'SquareOAuthRedirectUri');
        this.port = Number(env.PORT) || 3000;
        this.allowedHosts = this.#resolveAllowedHosts(env);
        this.publicBaseUrl = this.#resolvePublicBaseUrl(env);
        this.easyAuthDevPrincipal = this.#resolveEasyAuthDevPrincipal(env);
        this.easyAuthDevRoles = this.#resolveCommaSeparated(env.EasyAuthDevRoles);
        this.entraAllowedTenantIds = this.#resolveAllowedTenantIds(env);
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
        if (env.PublicBaseUrl) {
            return this.#resolveHttpsOrigin(env.PublicBaseUrl, 'PublicBaseUrl');
        }
        if (env.WEBSITE_HOSTNAME) {
            // The configured Square callback is authoritative when the MCP server is exposed through
            // a custom domain. WEBSITE_HOSTNAME only contains App Service's default hostname.
            return this.#resolveHttpsOrigin(this.squareOAuthRedirectUri, 'SquareOAuthRedirectUri');
        }
        return `http://localhost:${Number(env.PORT) || 3000}`;
    }

    // WEBSITE_HOSTNAME is auto-injected by Azure App Service (absent locally) - keeps the MCP
    // transport's Host-header allowlist in sync with wherever this app is actually reachable.
    #resolveAllowedHosts(env) {
        const hosts = new Set();

        for (const host of this.#resolveCommaSeparated(env.McpAllowedHosts)) {
            hosts.add(this.#normalizeHostname(host, 'McpAllowedHosts'));
        }
        if (env.WEBSITE_HOSTNAME) {
            hosts.add(this.#normalizeHostname(env.WEBSITE_HOSTNAME, 'WEBSITE_HOSTNAME'));
        } else {
            hosts.add('localhost');
            hosts.add('127.0.0.1');
            hosts.add('[::1]');
        }
        return [...hosts];
    }

    #resolveAllowedTenantIds(env) {
        const tenantIds = this.#resolveCommaSeparated(env.EntraAllowedTenantIds);
        if (env.WEBSITE_HOSTNAME && tenantIds.length === 0) {
            throw new Error('EntraAllowedTenantIds must be configured on Azure App Service.');
        }
        return tenantIds;
    }

    #resolveCommaSeparated(value) {
        return (value ?? '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    }

    #resolveHttpsOrigin(value, settingName) {
        let url;
        try {
            url = new URL(value);
        } catch {
            throw new Error(`${settingName} must be a valid HTTPS URL.`);
        }
        if (url.protocol !== 'https:') {
            throw new Error(`${settingName} must use HTTPS on Azure App Service.`);
        }
        return url.origin;
    }

    #normalizeHostname(value, settingName) {
        try {
            // URL handles a hostname with an optional port and returns a normalized hostname.
            return new URL(`https://${value}`).hostname;
        } catch {
            throw new Error(`${settingName} contains an invalid hostname: ${value}`);
        }
    }

    #require(env, name) {
        const value = env[name];
        if (!value) {
            throw new Error(`${name} app setting is not configured.`);
        }
        return value;
    }
}
