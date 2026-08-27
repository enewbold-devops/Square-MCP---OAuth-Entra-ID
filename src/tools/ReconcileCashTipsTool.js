import { z } from 'zod';
import { McpTool } from './base/McpTool.js';
import { TimecardService } from '../services/TimecardService.js';

export class ReconcileCashTipsTool extends McpTool {
    static toolName = 'reconcile_cash_tips';
    static description = 'Computes a proposed cash-tip split for a pay period from owner-supplied daily totals. Preview only - makes no changes in Square. Requires owner approval via commit_cash_tips.';
    static inputSchema = z.object({
        pay_period_start: z.string().describe('Workday range start date, YYYY-MM-DD.'),
        pay_period_end: z.string().describe('Workday range end date, YYYY-MM-DD.'),
        location_name: z.string().describe('Authorized location name this cash-tip total applies to.'),
        daily_cash_totals_json: z.string().describe('JSON array of {"date":"YYYY-MM-DD","amount":number} daily cash tip totals.'),
        allocation_method: z.string().describe('"equal_split" (default) or "hours_weighted".').optional(),
    });
    static outputSchema = z.object({
        allocations: z.array(
            z.object({ timecardId: z.string(), teamMemberId: z.string(), date: z.string(), amount: z.number() })
        ),
        excluded: z.array(
            z.object({ timecardId: z.string(), teamMemberId: z.string(), date: z.string(), reason: z.string() })
        ),
        byDate: z.record(z.string(), z.object({ totalCash: z.number(), allocatedCount: z.number() })),
        previewToken: z.string(),
    });
    static annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

    #squareContextResolver;
    #previewTokenSigner;

    constructor(squareContextResolver, previewTokenSigner) {
        super();
        this.#squareContextResolver = squareContextResolver;
        this.#previewTokenSigner = previewTokenSigner;
    }

    async handler(args, principal) {
        const squareContext = await this.#squareContextResolver.resolve(principal.principalId);
        const location = squareContext.requireAuthorizedLocation(args.location_name);

        let dailyCashTotals;
        try {
            dailyCashTotals = JSON.parse(args.daily_cash_totals_json);
        } catch {
            throw new Error('daily_cash_totals_json must be a JSON array of {"date":"YYYY-MM-DD","amount":number}.');
        }

        const timecardService = new TimecardService(squareContext);
        const timecards = await timecardService.searchForPeriod({
            locationId: location.id,
            startDate: args.pay_period_start,
            endDate: args.pay_period_end,
            status: 'CLOSED',
        });

        // The preview token embeds the exact allocations computed here - commit_cash_tips can only ever
        // write back what was signed, never an amount supplied fresh by the model.
        const entriesWithLocation = dailyCashTotals.map((entry) => ({ ...entry, locationId: location.id }));
        const result = TimecardService.allocateCashTips(timecards, entriesWithLocation, args.allocation_method || 'equal_split');

        const previewToken = await this.#previewTokenSigner.sign({
            principalId: principal.principalId,
            merchantId: squareContext.merchantId,
            locationId: location.id,
            payPeriodStart: args.pay_period_start,
            payPeriodEnd: args.pay_period_end,
            allocations: result.allocations,
        });

        return { ...result, previewToken };
    }
}
