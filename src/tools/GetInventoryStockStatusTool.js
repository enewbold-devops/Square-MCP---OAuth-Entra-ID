import { z } from 'zod';
import { McpTool } from './base/McpTool.js';

const MAX_RESULTS_PER_STOCK_LEVEL = 500;

export class GetInventoryStockStatusTool extends McpTool {
    static toolName = 'get_inventory_stock_status';
    static description = 'Read-only discovery of Square catalog items with LOW or OUT stock levels at one authorized location. It reports Square’s current stock classification and does not adjust inventory.';
    static inputSchema = z.object({
        location_name: z.string().describe('Authorized Square location name.'),
        max_items_per_status: z.number().int().min(1).max(MAX_RESULTS_PER_STOCK_LEVEL).optional().describe('Maximum LOW and OUT items to return for each status; defaults to 100.'),
    });
    static outputSchema = z.object({
        location: z.string(),
        outOfStock: z.array(z.object({ id: z.string(), name: z.string(), variationCount: z.number() })),
        lowStock: z.array(z.object({ id: z.string(), name: z.string(), variationCount: z.number() })),
        truncationNote: z.string().nullable(),
    });
    static annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

    #squareContextResolver;

    constructor(squareContextResolver) {
        super();
        this.#squareContextResolver = squareContextResolver;
    }

    async #search(squareContext, locationId, stockLevel, limit) {
        const page = await squareContext.client.catalog.searchItems({
            enabledLocationIds: [locationId],
            stockLevels: [stockLevel],
            archivedState: 'ARCHIVED_STATE_NOT_ARCHIVED',
            limit,
        });
        return { items: page.items ?? [], truncated: Boolean(page.cursor) };
    }

    async handler(args, principal) {
        const squareContext = await this.#squareContextResolver.resolve(principal.principalId);
        const location = squareContext.requireAuthorizedLocation(args.location_name);
        const limit = args.max_items_per_status ?? 100;
        const [outOfStock, lowStock] = await Promise.all([
            this.#search(squareContext, location.id, 'OUT', limit),
            this.#search(squareContext, location.id, 'LOW', limit),
        ]);
        const toItem = (item) => ({ id: item.id ?? 'unknown', name: item.itemData?.name ?? item.id ?? 'Unnamed item', variationCount: item.itemData?.variations?.length ?? 0 });
        return {
            location: location.name ?? location.id,
            outOfStock: outOfStock.items.map(toItem),
            lowStock: lowStock.items.map(toItem),
            truncationNote: outOfStock.truncated || lowStock.truncated ? `Square returned more matching items than the requested ${limit} per status. Narrow the catalog query in a future tool enhancement before treating this as a complete list.` : null,
        };
    }
}
