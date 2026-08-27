# Square Franchise Operations MCP

Production-ready Node.js Streamable HTTP MCP server for Square workforce, scheduling, and payroll operations. It is designed for Azure App Service Authentication with Microsoft Entra ID and for use from a Power Platform custom connector.

## Security model

`POST /mcp` is protected by App Service Authentication. Easy Auth validates the Power Platform user's Entra access token, then the server reads its verified `tid`, `oid`, and app-role claims from `X-MS-CLIENT-PRINCIPAL`. The server never forwards that token to Square.

Each call resolves a Square connection by the trusted Entra principal key (`tenantId:objectId`), reads that seller's OAuth token from Key Vault, and creates a request-scoped Square client. The application identity needs **Key Vault Secrets Officer** because it manages those token secrets and short-lived OAuth transactions.

Tool access is deny-by-default and controlled by Entra app-role values defined in [infra/entra-api-manifest.json](infra/entra-api-manifest.json):

- `SquareMcp.Reader` — read-only workforce data.
- `SquareMcp.Scheduler` — schedule reads and mutations.
- `SquareMcp.PayrollApprover` — payroll reads, previews, and tip commits.
- `SquareMcp.SquareConnector` — connect or revoke a caller's Square account.
- `SquareMcp.Admin` — all operations.

Every MCP invocation emits a secret-free structured audit event. Write tools derive the approver from the verified Entra principal, not tool input. Tip-preview tokens are bound to principal, merchant, and location.

## Local development

1. Copy `.env.example` to `.env` and provide non-production Key Vault and Square values.
2. Set `EasyAuthDevPrincipal` and `EasyAuthDevRoles=SquareMcp.Admin` for local requests. These settings are ignored whenever `WEBSITE_HOSTNAME` is present.
3. Start with `npm start`.

`GET /healthz` returns only `{ "status": "ok" }`. Every other public route requires authentication except the Square OAuth callback, which must be excluded from Easy Auth as described below.

## Azure and Entra deployment

1. Create a **dedicated single-tenant Entra resource application** and use [infra/entra-api-manifest.json](infra/entra-api-manifest.json) as the role/scope model. Replace every `REPLACE_WITH_*` value with a newly generated GUID or the application's actual client ID before applying it.
2. Create a separate Entra client application for the Power Platform custom connector. Grant it delegated `mcp.tools` permission and preauthorize it under **Expose an API**. Assign the appropriate app role to each user or group.
3. Store the App Service Authentication client secret as a Key Vault secret and pass its **Key Vault reference** to the `entraAuthSecretKeyVaultReference` Bicep parameter. Do not commit it.
4. Deploy [infra/main.bicep](infra/main.bicep). It configures system-assigned managed identity, Key Vault RBAC, HTTPS-only App Service, `Return401`, protected-resource metadata, allowed connector client, and only two unauthenticated paths: `/healthz` and `/square/oauth/callback`.
5. Register the exact `SquareOAuthRedirectUri` with the Square Developer Console. The application consumes both its MCP-issued connect link and Square callback state once; do not add `/square/oauth/start` to the Easy Auth exclusions.
6. In Power Apps, import [connector/square-mcp.swagger.json](connector/square-mcp.swagger.json), replace its host/tenant/API values, enter the custom connector client ID and secret, and add the generated connector redirect URI to the connector client's Entra registration.

Set `WEBSITE_AUTH_PRM_DEFAULT_WITH_SCOPES` to the exact exposed scope, such as `api://<api-client-id>/mcp.tools`. This lets MCP-capable clients discover authorization requirements. Configure App Service Authentication to allow the custom connector application's client ID as an allowed application.

## Operational requirements

- Configure App Service Health Check to use `/healthz`.
- Send App Service application logs to a retained Log Analytics workspace or Application Insights; alert on failed OAuth refreshes and failed mutation audit events.
- Schedule `npm run refresh-square-tokens` daily with a managed-identity worker (for example, Azure Automation, a timer-triggered Function, or a Container Apps Job). The script refreshes connections due for renewal and returns a nonzero exit code on unexpected failures; alert on that signal.
- Restrict Key Vault and App Service network access with private endpoints or approved IP/network rules appropriate to the environment.
- Add automated tests for role enforcement, OAuth transaction consumption, Square-context resolution, and destructive-tool authorization before production release.
