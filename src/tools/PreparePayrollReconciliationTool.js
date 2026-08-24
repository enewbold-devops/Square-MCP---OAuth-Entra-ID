import { z } from 'zod';
import { McpTool } from './base/McpTool.js';
import { TimecardService } from '../services/TimecardService.js';

export class PreparePayrollReconciliationTool extends McpTool {
    static toolName = 'prepare_payroll_reconciliation';
    static description = 'Read-only payroll prep summary for a pay period: timecard counts and detected exceptions. Does not submit or finalize payroll.';
    static inputSchema = z.object({
        pay_period_start: z.string().describe('Workday range start date, YYYY-MM-DD.'),
        pay_period_end: z.string().describe('Workday range end date, YYYY-MM-DD.'),
        location_name: z.string().describe('Optional authorized location name to scope the search to.').optional(),
    });
    static outputSchema = z.object({
        payPeriod: z.object({ start: z.string(), end: z.string() }),
        location: z.string(),
        timecardCount: z.number(),
        closedCount: z.number(),
        openCount: z.number(),
        exceptions: z.array(
            z.object({ timecardId: z.string(), teamMemberId: z.string(), type: z.string(), detail: z.string() })
        ),
    });
    static annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

    #squareContextResolver;

    constructor(squareContextResolver) {
        super();
        this.#squareContextResolver = squareContextResolver;
    }

    async handler(args, principal) {
        const squareContext = await this.#squareContextResolver.resolve(principal.principalId);
        const location = args.location_name ? squareContext.requireAuthorizedLocation(args.location_name) : null;

        const timecardService = new TimecardService(squareContext);
        const timecards = await timecardService.searchForPeriod({
            locationId: location?.id,
            startDate: args.pay_period_start,
            endDate: args.pay_period_end,
        });

        return {
            payPeriod: { start: args.pay_period_start, end: args.pay_period_end },
            location: location?.name ?? 'all authorized locations',
            timecardCount: timecards.length,
            closedCount: timecards.filter((timecard) => timecard.status === 'CLOSED').length,
            openCount: timecards.filter((timecard) => timecard.status === 'OPEN').length,
            exceptions: TimecardService.detectExceptions(timecards),
        };
    }
}
