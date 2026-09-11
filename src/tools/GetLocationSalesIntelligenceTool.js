import { z } from 'zod';
import { McpTool } from './base/McpTool.js';
import { OrderIntelligenceService } from '../services/OrderIntelligenceService.js';

export class GetLocationSalesIntelligenceTool extends McpTool {
    static toolName = 'get_location_sales_intelligence';
    static description = 'Read-only sales, daypart, and top-item intelligence for one authorized location and RFC 3339 period. Uses completed Square orders only; it does not create forecasts.';
    static inputSchema = z.object({
        location_name: z.string().describe('Authorized Square location name.'),
        period_start_at: z.string().describe('RFC 3339 start timestamp, including time zone offset.'),
        period_end_at: z.string().describe('RFC 3339 end timestamp, including time zone offset.'),
        top_item_limit: z.number().int().min(1).max(25).optional().describe('Number of top items to return; defaults to 10.'),
    });
    static outputSchema = z.object({
        location: z.string(),
        period: z.object({ startAt: z.string(), endAt: z.string() }),
        summary: z.object({
            orderCount: z.number(), currency: z.string(), totalSalesCents: z.number(), totalDiscountCents: z.number(), totalTaxCents: z.number(), totalTipCents: z.number(), averageTicketCents: z.number(),
        }),
        salesByHour: z.array(z.object({ hour: z.number(), orderCount: z.number(), totalSalesCents: z.number() })),
        topItems: z.array(z.object({ catalogObjectId: z.string().nullable(), name: z.string(), quantity: z.number(), grossSalesCents: z.number() })),
    });
    static annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

    #squareContextResolver;

    constructor(squareContextResolver) {
        super();
        this.#squareContextResolver = squareContextResolver;
    }

    async handler(args, principal) {
        const squareContext = await this.#squareContextResolver.resolve(principal.principalId);
        const location = squareContext.requireAuthorizedLocation(args.location_name);
        const orderService = new OrderIntelligenceService(squareContext);
        const orders = await orderService.searchCompleted({ locationIds: [location.id], startAt: args.period_start_at, endAt: args.period_end_at });
        return {
            location: location.name ?? location.id,
            period: { startAt: args.period_start_at, endAt: args.period_end_at },
            summary: OrderIntelligenceService.summarize(orders),
            salesByHour: OrderIntelligenceService.summarizeByHour(orders, location.timezone ?? 'UTC'),
            topItems: OrderIntelligenceService.topItems(orders, args.top_item_limit ?? 10),
        };
    }
}
