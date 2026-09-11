// Adapts Azure App Service Authentication ("Easy Auth") into the same AuthInfo shape
// (`req.auth.extra.{tid,oid,displayName}`) that Principal.js/resolvePrincipal already expects -
// this is the only integration point between the platform-level Entra sign-in and the rest of the
// app, so SquareContextResolver, McpTool, and every tool need zero changes.
//
// When "Authentication" is enabled on the App Service resource with a Microsoft Entra ID identity
// provider and "Require authentication", the platform validates the sign-in and OAuth token before
// the request ever reaches this Node process, then forwards the caller's identity via the
// X-MS-CLIENT-PRINCIPAL* headers below - no in-code OAuth broker, PKCE handling, or JWT
// verification is needed here. This also removes the PKCE requirement that ChatGPT's MCP client
// enforced, which Microsoft Copilot Studio's connectors do not require.
const OID_CLAIM_TYPES = new Set(['oid', 'http://schemas.microsoft.com/identity/claims/objectidentifier']);
const TID_CLAIM_TYPES = new Set(['tid', 'http://schemas.microsoft.com/identity/claims/tenantid']);
const NAME_CLAIM_TYPES = new Set(['name', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name']);
const ROLE_CLAIM_TYPES = new Set(['roles', 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role']);

function findClaim(claims, types) {
    return claims.find((claim) => types.has(claim?.typ))?.val;
}

function findClaims(claims, types) {
    return claims.filter((claim) => types.has(claim?.typ) && typeof claim?.val === 'string').map((claim) => claim.val);
}

// Decodes the base64-encoded X-MS-CLIENT-PRINCIPAL header App Service injects on every authenticated
// request - a JSON object of shape { auth_typ, claims: [{ typ, val }], name_typ, role_typ }.
function parseClientPrincipalHeader(headerValue) {
    if (!headerValue) {
        return null;
    }
    try {
        const decoded = Buffer.from(headerValue, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);
        return Array.isArray(parsed?.claims) ? parsed.claims : null;
    } catch {
        return null;
    }
}

function principalFromHeaders(req) {
    const claims = parseClientPrincipalHeader(req.headers['x-ms-client-principal']) ?? [];

    const tenantId = findClaim(claims, TID_CLAIM_TYPES);
    // X-MS-CLIENT-PRINCIPAL-ID is App Service's own convenience header for the provider's user id
    // (the AAD object id) - preferred fallback when the claims array doesn't carry it directly.
    const objectId = findClaim(claims, OID_CLAIM_TYPES) ?? singleHeader(req.headers['x-ms-client-principal-id']);
    const displayName = findClaim(claims, NAME_CLAIM_TYPES) ?? singleHeader(req.headers['x-ms-client-principal-name']);
    const roles = findClaims(claims, ROLE_CLAIM_TYPES);

    if (!tenantId || !objectId) {
        return null;
    }
    return { tid: tenantId, oid: objectId, displayName, roles };
}

function singleHeader(value) {
    return Array.isArray(value) ? value[0] : value;
}

// Parses the "tenantId:objectId[:displayName]" dev-only override used to exercise the server
// locally, where App Service never injects the X-MS-CLIENT-PRINCIPAL* headers. Never used when
// running in App Service itself - see AppConfig#easyAuthDevPrincipal.
function devPrincipalFrom(devPrincipal, devRoles) {
    if (!devPrincipal) {
        return null;
    }
    const [tenantId, objectId, displayName] = devPrincipal.split(':');
    if (!tenantId || !objectId) {
        return null;
    }
    return { tid: tenantId, oid: objectId, displayName, roles: devRoles ?? [] };
}

// Express middleware factory: rejects requests App Service hasn't authenticated (or, locally,
// requests without the dev override configured), otherwise attaches req.auth in the same shape
// requireBearerAuth used to produce, so ToolRegistry/Principal.js are unaffected.
export function easyAuthPrincipal({ devPrincipal, devRoles, allowedTenantIds = [] } = {}) {
    return (req, res, next) => {
        const principal = principalFromHeaders(req) ?? devPrincipalFrom(devPrincipal, devRoles);

        if (!principal) {
            res.status(401).json({
                error: 'unauthenticated',
                error_description:
                    'No authenticated Easy Auth principal on this request. Configure Authentication on the App Service resource (Microsoft Entra ID provider, "Require authentication") so this endpoint receives X-MS-CLIENT-PRINCIPAL* headers.',
            });
            return;
        }

        if (allowedTenantIds.length > 0 && !allowedTenantIds.includes(principal.tid)) {
            res.status(403).json({ error: 'forbidden', error_description: 'The Entra tenant is not authorized for this MCP server.' });
            return;
        }

        req.auth = {
            token: undefined,
            clientId: 'easyauth',
            scopes: [],
            expiresAt: undefined,
            extra: {
                ...principal,
                requestId: singleHeader(req.headers['x-ms-request-id']) ?? singleHeader(req.headers['x-arr-log-id']),
            },
        };
        next();
    };
}
