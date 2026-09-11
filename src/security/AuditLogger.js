// Emits compact, structured, secret-free audit records. App Service forwards stdout to its log
// pipeline, where Application Insights/Azure Monitor retention makes these events durable.
export function writeAuditEvent({ event, tool, principal, outcome, requestId, reason } = {}) {
    console.log(
        JSON.stringify({
            event,
            tool,
            outcome,
            actor: principal
                ? {
                      tenantId: principal.tenantId,
                      objectId: principal.objectId,
                  }
                : undefined,
            requestId,
            reason,
            timestamp: new Date().toISOString(),
        })
    );
}
