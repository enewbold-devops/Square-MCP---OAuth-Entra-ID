import { z } from 'zod';
import { McpTool } from './base/McpTool.js';

const MAX_CATALOG_ITEMS = 1000;

export class GetCatalogReadinessTool extends McpTool {
    static toolName = 'get_catalog_readiness';
    static description = 'Read-only catalog-health summary for one authorized location: enabled items, archived items, missing variations, and missing images. Does not change catalog data.';
    static inputSchema = z.object({
        location_name: z.string().describe('Authorized Square location name.'),
    });
    static outputSchema = z.object({
        location: z.string(), enabledItemCount: z.number(), archivedItemCount: z.number(), itemsWithoutVariations: z.array(z.object({ id: z.string(), name: z.string() })), itemsWithoutImages: z.array(z.object({ id: z.string(), name: z.string() })),
    });
    static annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

    #squareContextResolver;

    constructor(squareContextResolver) {
        super();
        this.#squareContextResolver = squareContextResolver;
    }

    async #searchAll(squareContext, request) {
        const items = [];
        let cursor;
        do {
            const page = await squareContext.client.catalog.searchItems({ ...request, limit: MAX_CATALOG_ITEMS, cursor });
            items.push(...(page.items ?? []));
            cursor = page.cursor;
        } while (cursor && items.length < MAX_CATALOG_ITEMS);
        if (cursor) {
            throw new Error(`Catalog search exceeds the ${MAX_CATALOG_ITEMS}-item safety limit. Narrow the catalog query before continuing.`);
        }
        return items;
    }

    async handler(args, principal) {
        const squareContext = await this.#squareContextResolver.resolve(principal.principalId);
        const location = squareContext.requireAuthorizedLocation(args.location_name);
        const enabled = await this.#searchAll(squareContext, { enabledLocationIds: [location.id], archivedState: 'ARCHIVED_STATE_NOT_ARCHIVED' });
        const archived = await this.#searchAll(squareContext, { enabledLocationIds: [location.id], archivedState: 'ARCHIVED_STATE_ARCHIVED' });
        const identify = (item) => ({ id: item.id ?? 'unknown', name: item.itemData?.name ?? item.id ?? 'Unnamed item' });
        return {
            location: location.name ?? location.id,
            enabledItemCount: enabled.length,
            archivedItemCount: archived.length,
            itemsWithoutVariations: enabled.filter((item) => !(item.itemData?.variations?.length)).map(identify).slice(0, 100),
            itemsWithoutImages: enabled.filter((item) => !(item.itemData?.imageIds?.length)).map(identify).slice(0, 100),
        };
    }
}
