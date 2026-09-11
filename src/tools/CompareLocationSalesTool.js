import { z } from 'zod';
import { McpTool } from './base/McpTool.js';
import { OrderIntelligenceService } from '../services/OrderIntelligenceService.js';

export class CompareLocationSalesTool extends McpTool {
    static toolName = 'compare_location_sales';
    static description = 'Read-only comparison of completed-order sales across all locations authorized for the connected Square merchant. Limited to Square’s maximum of 10 locations per search.';
    static inputSchema = z.object({
        period_start_at: z.string().describe('RFC 3339 start timestamp, including time zone offset.'),
        period_end_at: z.string().describe('RFC 3339 end timestamp, including time zone offset.'),
    });
    static outputSchema = z.object({
        period: z.object({ startAt: z.string(), endAt: z.string() }),
        locations: z.array(z.object({ locationId: z.string(), locationName: z.string(), orderCount: z.number(), currency: z.string(), totalSalesCents: z.number(), totalDiscountCents: z.number(), averageTicketCents: z.number() })),
    });
    static annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

    #squareContextResolver;

    constructor(squareContextResolver) {
        super();
        this.#squareContextResolver = squareContextResolver;
    }

    async handler(args, principal) {
        const squareContext = await this.#squareContextResolver.resolve(principal.principalId);
        const locations = squareContext.authorizedLocations;
        if (locations.length > 10) {
            throw new Error('Cross-location comparison supports at most 10 authorized locations per call. Add a location-selection input before comparing a larger merchant.');
        }
        const orderService = new OrderIntelligenceService(squareContext);
        const orders = await orderService.searchCompleted({
            locationIds: locations.map((location) => location.id),
            startAt: args.period_start_at,
            endAt: args.period_end_at,
        });
        return {
            period: { startAt: args.period_start_at, endAt: args.period_end_at },
            locations: locations.map((location) => {
                const summary = OrderIntelligenceService.summarize(orders.filter((order) => order.locationId === location.id));
                return {
                    locationId: location.id,
                    locationName: location.name ?? location.id,
                    orderCount: summary.orderCount,
                    currency: summary.currency,
                    totalSalesCents: summary.totalSalesCents,
                    totalDiscountCents: summary.totalDiscountCents,
                    averageTicketCents: summary.averageTicketCents,
                };
            }).sort((left, right) => right.totalSalesCents - left.totalSalesCents),
        };
    }
}
