import { z } from 'zod';
import { McpTool } from './base/McpTool.js';
import { TimecardService } from '../services/TimecardService.js';
import { OrderIntelligenceService } from '../services/OrderIntelligenceService.js';

function durationHours(startAt, endAt) {
    if (!startAt || !endAt) {
        return 0;
    }
    return Math.max(0, (new Date(endAt).getTime() - new Date(startAt).getTime()) / (60 * 60 * 1000));
}

function timecardHours(timecard) {
    const unpaidBreakHours = (timecard.breaks ?? []).filter((brk) => brk.isPaid === false).reduce((total, brk) => total + durationHours(brk.startAt, brk.endAt), 0);
    return Math.max(0, durationHours(timecard.startAt, timecard.endAt) - unpaidBreakHours);
}

function estimateWageCostCents(timecard) {
    const hourlyRateCents = Number(timecard.wage?.hourlyRate?.amount ?? 0);
    return Math.round(timecardHours(timecard) * hourlyRateCents);
}

export class GetLaborVsSalesTool extends McpTool {
    static toolName = 'get_labor_vs_sales';
    static description = 'Read-only operational estimate of actual closed-timecard hours and wages against completed-order sales for one authorized location. It is not a payroll or accounting calculation.';
    static inputSchema = z.object({
        location_name: z.string().describe('Authorized Square location name.'),
        pay_period_start: z.string().describe('Workday start date, YYYY-MM-DD, for timecards.'),
        pay_period_end: z.string().describe('Workday end date, YYYY-MM-DD, for timecards.'),
        period_start_at: z.string().describe('Matching RFC 3339 order-search start timestamp, including time zone offset.'),
        period_end_at: z.string().describe('Matching RFC 3339 order-search end timestamp, including time zone offset.'),
    });
    static outputSchema = z.object({
        location: z.string(), currency: z.string(), completedOrderCount: z.number(), totalSalesCents: z.number(), actualLaborHours: z.number(), estimatedWageCostCents: z.number(), laborCostPercentOfSales: z.number().nullable(), salesPerLaborHourCents: z.number().nullable(), timecardsWithoutHourlyRate: z.number(),
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
        const [timecards, orders] = await Promise.all([
            new TimecardService(squareContext).searchForPeriod({ locationId: location.id, startDate: args.pay_period_start, endDate: args.pay_period_end, status: 'CLOSED' }),
            new OrderIntelligenceService(squareContext).searchCompleted({ locationIds: [location.id], startAt: args.period_start_at, endAt: args.period_end_at }),
        ]);
        const sales = OrderIntelligenceService.summarize(orders);
        const actualLaborHours = timecards.reduce((total, timecard) => total + timecardHours(timecard), 0);
        const estimatedWageCostCents = timecards.reduce((total, timecard) => total + estimateWageCostCents(timecard), 0);
        const timecardsWithoutHourlyRate = timecards.filter((timecard) => !timecard.wage?.hourlyRate?.amount).length;
        return {
            location: location.name ?? location.id,
            currency: sales.currency,
            completedOrderCount: sales.orderCount,
            totalSalesCents: sales.totalSalesCents,
            actualLaborHours: Math.round(actualLaborHours * 100) / 100,
            estimatedWageCostCents,
            laborCostPercentOfSales: sales.totalSalesCents ? Math.round((estimatedWageCostCents / sales.totalSalesCents) * 10000) / 100 : null,
            salesPerLaborHourCents: actualLaborHours ? Math.round(sales.totalSalesCents / actualLaborHours) : null,
            timecardsWithoutHourlyRate,
        };
    }
}
