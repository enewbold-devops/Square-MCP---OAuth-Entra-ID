# Easy Auth + Entra ID + Power Platform/Copilot Studio — Setup Runbook

Step-by-step configuration for gating this MCP server with Azure App Service Authentication
("Easy Auth") backed by a dedicated Microsoft Entra ID app registration, and connecting it to
Microsoft Copilot Studio. Grounded in current Microsoft Learn guidance:

- [Authentication and authorization in Azure App Service](https://learn.microsoft.com/en-us/azure/app-service/overview-authentication-authorization)
- [Configure Microsoft Entra authentication for App Service](https://learn.microsoft.com/en-us/azure/app-service/configure-authentication-provider-aad)
- [Configure MCP server authorization](https://learn.microsoft.com/en-us/azure/app-service/configure-authentication-mcp)
- [Connect your agent to an existing MCP server (Copilot Studio)](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent)

No application code changes are required for any step below — everything here is Azure
portal/Entra admin center/Copilot Studio configuration. The app's identity chain
([EasyAuthPrincipal.js](src/web/middleware/EasyAuthPrincipal.js), [Principal.js](src/tools/base/Principal.js))
already expects exactly the headers this setup produces.

## Prerequisites

- The server already deployed to Azure App Service, reachable at `https://<your-app>.azurewebsites.net`.
- `KeyVaultUri` and `SquareOAuthRedirectUri` app settings already configured (see [.env.example](.env.example)).
- Owner/Contributor access to the App Service resource and permission to create app registrations in the target Microsoft Entra tenant.

## Step 1 — Create a dedicated app registration

Microsoft Learn is explicit that the identity provider registration backing an MCP server
"should be unique for the MCP server. Don't reuse an existing registration from another
application component." Let App Service create it for you rather than pointing it at a
registration shared with anything else:

1. In the [Azure portal](https://portal.azure.com), go to your App Service → **Settings → Authentication**.
2. Select **Add identity provider** → **Microsoft** as the identity provider.
3. Choose **Workforce configuration (current tenant)** (this is a business-facing tool, not a consumer app).
4. Under **App registration**, select **Create new app registration**, name it something specific to this server (e.g. `square-mcp-server`), and leave **Supported account types** as **Current tenant - Single tenant** unless you need multi-tenant.
5. Leave **Client secret** as generated — App Service stores it as the slot-sticky `MICROSOFT_PROVIDER_AUTHENTICATION_SECRET` app setting.
6. Under **Authentication settings**:
   - **Restrict access**: **Require authentication** (matches [AppConfig.js](src/config/AppConfig.js)'s assumption that every `/mcp` request already carries a verified principal).
   - **Unauthenticated requests**: **HTTP 401 Unauthorized** (recommended for APIs, not `302 redirect`).
   - **Token store**: leave enabled (default).
7. Select **Add**.

Record these three values — you'll need them in later steps:
- **Application (client) ID** of the new registration
- **Directory (tenant) ID**
- The **Application ID URI** (defaults to `api://<client-id>`)

## Step 2 — Add a scope and preauthorize the calling client

1. In **Entra ID admin center → App registrations**, open the registration created in Step 1.
2. Go to **Expose an API**. Confirm the **Application ID URI** is set (default `api://<client-id>` is fine).
3. **Add a scope**:
   - Scope name: `mcp.tools`
   - Who can consent: **Admins and users** (or **Admins only** to have one environment admin consent once for all makers)
   - Description: "Access Square Operations MCP tools"
4. Still on **Expose an API**, under **Authorized client applications**, select **Add a client application** and add the client ID of whichever app will call this MCP server (Copilot Studio's own multi-tenant client ID, or your custom connector's client ID once created in Step 4). This is the **preauthorization** step Microsoft Learn recommends to avoid interactive-consent friction — "preauthorization is recommended when possible."

   > If you don't yet know the calling client ID (e.g. you haven't created the Copilot Studio connection yet), skip this now and come back after Step 4 — the flow will otherwise prompt the signed-in user for consent the first time, which is also an acceptable fallback.

## Step 3 — Fix the default authorization policy (required)

By default, Easy Auth's `defaultAuthorizationPolicy` only accepts tokens obtained by the app
itself — Copilot Studio's calls will be rejected until its client ID is explicitly allowed. The
Azure portal doesn't expose this setting; it must be set via REST/CLI:

```powershell
# 1. Export the current settings
az rest --method get `
  --uri "/subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.Web/sites/<your-app>/config/authsettingsV2?api-version=2020-09-01" `
  > authsettings.json
```

Open `authsettings.json`, find `properties.identityProviders.azureActiveDirectory.validation`, and
add the calling client's ID to `allowedApplications` (leave `allowedPrincipals.identities` empty
unless you also want to restrict by specific Entra user object IDs):

```json
"validation": {
    "defaultAuthorizationPolicy": {
        "allowedApplications": ["<copilot-studio-or-connector-client-id>"],
        "allowedPrincipals": { "identities": [] }
    }
}
```

```powershell
# 2. Push the updated settings back
az rest --method put `
  --uri "/subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.Web/sites/<your-app>/config/authsettingsV2?api-version=2020-09-01" `
  --body "@authsettings.json"
```

## Step 4 — Connect Copilot Studio (choose one)

There are two supported paths, and **each expects a different redirect/callback URI** — don't mix them up.

### Option A — Native MCP onboarding wizard (recommended, no custom connector)

1. In [Copilot Studio](https://copilotstudio.microsoft.com), open your agent → **Tools** → **Add a tool** → **New tool** → **Model Context Protocol**.
2. Fill in **Server name**, **Server description**, and **Server URL**: `https://<your-app>.azurewebsites.net/mcp`.
3. Under authentication, select **OAuth 2.0** → **Manual**, and fill in:
   - **Client ID / Client secret**: the values from Step 1.
   - **Authorization URL**: `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/authorize`
   - **Token URL template**: `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token`
   - **Refresh URL**: same as the token URL.
   - **Scopes**: `api://<client-id>/mcp.tools` (or `api://<client-id>/user_impersonation` if you used the default scope).
4. Select **Create**. Copilot Studio generates a **connection-specific callback URL** — copy it.
5. Back in the Step 1 app registration → **Authentication** → **Platform configurations** → **Web**, add that callback URL as a redirect URI, and **Save**.
6. In Copilot Studio, finish by creating a new connection and selecting **Add to agent**.

### Option B — Power Platform custom connector (OpenAPI import)

Use this only if you need solution-based governance/DLP policies or reuse across multiple agents.

1. Go to the Power Apps or Power Automate portal → **Custom connectors** → **New custom connector** → **Import an OpenAPI file** (see the [MCP server schema example](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent#mcp-server-schema-example) for the minimal YAML shape, with `x-ms-agentic-protocol: mcp-streamable-1.0` on the `/mcp` path).
2. On the connector's **Security** tab, select **OAuth 2.0**, identity provider **Azure Active Directory**, and fill in the Step 1 registration's client ID/secret and the tenant's authorize/token endpoints.
3. Save — the connector's **Redirect URL** field populates with Power Platform's fixed redirect: `https://global.consent.azure-apim.net/redirect/<connector-id>`.
4. Add that fixed redirect URL to the Step 1 app registration's **Authentication → Web** redirect URIs.
5. Back in Copilot Studio: **Tools → Add a tool → Custom connector**, select the connector you just created, and add it to the agent.

## Step 5 — Validate end-to-end

1. **Dev/test consent as yourself first**: browse to `https://<your-app>.azurewebsites.net/.auth/login/aad` and sign in — this authors consent for your own account before testing from Copilot Studio.
2. From Copilot Studio, start a conversation and ask the agent to call `who_am_i`. A successful round trip confirms:
   - Easy Auth accepted Copilot Studio's token (Step 3's `allowedApplications` fix worked).
   - [EasyAuthPrincipal.js](src/web/middleware/EasyAuthPrincipal.js) found `tid`/`oid` claims and attached `req.auth`.
   - [SquareContextResolver.js](src/services/SquareContextResolver.js) either resolves an existing Square connection or the tool reports "no connection" as expected for a first-time user.
3. If `who_am_i` returns a 401 at the platform level (never reaches the app, no log line from this Node process), re-check Step 3 — this is almost always the `allowedApplications` policy.
4. If it reaches the app but `resolvePrincipal` throws "No authenticated principal on this request," check that the identity provider is Microsoft Entra (not another provider) and that claims mapping wasn't customized to rename `tid`/`oid`.

## Reference — values to keep on hand

| Value | Where it's used |
|---|---|
| Tenant ID | Authorization/token URLs, `WEBSITE_AUTH_AAD_ALLOWED_TENANTS` if restricting further |
| App registration client ID | Copilot Studio/connector OAuth config, `allowedApplications` policy |
| App registration client secret | Copilot Studio/connector OAuth config (stored as `MICROSOFT_PROVIDER_AUTHENTICATION_SECRET` on the App Service side) |
| Application ID URI / scope (`api://<client-id>/mcp.tools`) | Copilot Studio/connector **Scopes** field |
| Copilot Studio callback URL (Option A) or fixed Power Platform redirect (Option B) | App registration redirect URIs |
