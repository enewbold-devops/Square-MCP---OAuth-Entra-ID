// Derives the caller's stable enterprise identity from the AuthInfo the MCP transport attaches to
// each request (populated by the EasyAuthPrincipal middleware from Azure App Service Authentication's
// verified X-MS-CLIENT-PRINCIPAL* headers).
export function resolvePrincipal(ctx) {
    const extra = ctx?.http?.authInfo?.extra;
    const tenantId = extra?.tid;
    const objectId = extra?.oid;
    if (!tenantId || !objectId) {
        throw new Error('No authenticated principal on this request.');
    }
    return {
        principalId: `${tenantId}:${objectId}`,
        tenantId,
        objectId,
        displayName: extra?.displayName,
    };
}
