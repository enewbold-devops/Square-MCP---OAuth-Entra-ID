// Static resources deliberately contain operating guidance only. Merchant data remains in Square
// and is obtained through authenticated tools for each request.
const resources = [
    {
        name: 'metric_definitions',
        uri: 'square://ops/metric-definitions',
        title: 'Square operations metric definitions',
        text: JSON.stringify({
            sales: 'Sum of Square Order.total_money for completed orders in the requested RFC 3339 interval. It may include taxes, tips, and service charges according to the order.',
            averageTicket: 'Sales divided by completed-order count. It is zero when there are no completed orders.',
            laborCostPercent: 'Estimated closed-timecard wage cost divided by completed-order sales. It is an operational estimate, not a payroll calculation.',
            salesPerLaborHour: 'Completed-order sales divided by actual closed-timecard hours.',
            stockout: 'An item variation returned by Square Catalog Search with stock level OUT for the selected location.',
            lowStock: 'An item variation returned by Square Catalog Search with stock level LOW for the selected location.',
        }, null, 2),
    },
    {
        name: 'approval_policy',
        uri: 'square://ops/approval-policy',
        title: 'Square operations approval policy',
        text: JSON.stringify({
            readOperations: 'May run without additional owner approval.',
            scheduleDrafts: 'May create or update drafts after the user asks; drafts must be reviewed before publication.',
            schedulePublication: 'Requires explicit approver identity and the publish_schedule tool.',
            tipCommit: 'Requires a valid preview token, explicit approver identity, and unchanged timecard versions.',
            inventoryAndCatalog: 'This server provides read-only intelligence; it does not make inventory or catalog changes.',
        }, null, 2),
    },
    {
        name: 'operating_principles',
        uri: 'square://ops/operating-principles',
        title: 'Square franchise operating principles',
        text: JSON.stringify({
            principles: [
                'Use live Square data as evidence and state the queried time interval and location.',
                'Do not infer unavailable data, historical baselines, or employee availability.',
                'Recommend actions before proposing a consequential write.',
                'Call square_connect_account when a Square connection is missing.',
                'Treat values as operational indicators, not payroll, tax, or legal determinations.',
            ],
        }, null, 2),
    },
    {
        name: 'capabilities',
        uri: 'square://ops/capabilities',
        title: 'Square MCP operational capabilities',
        text: JSON.stringify({
            toolGroups: {
                labor: ['timecards', 'cash-tip previews and gated commits', 'draft scheduling and gated publication'],
                sales: ['completed-order performance', 'daypart sales', 'top selling items', 'authorized-location comparison'],
                catalog: ['location catalog readiness'],
                inventory: ['low-stock and stockout discovery'],
            },
            reauthorization: 'Existing Square connections must be reconnected after new OAuth read scopes are deployed before the new intelligence tools can access their data.',
            storage: 'The MCP server stores only per-owner OAuth credentials in Key Vault. Merchant operational data is queried from Square on each call and not persisted by this server.',
        }, null, 2),
    },
];

export class OperationalResourceRegistry {
    static registerAll(mcpServer) {
        for (const resource of resources) {
            mcpServer.registerResource(resource.name, resource.uri, { title: resource.title, mimeType: 'application/json' }, async (uri) => ({
                contents: [{ uri: uri.href, mimeType: 'application/json', text: resource.text }],
            }));
        }
    }
}
