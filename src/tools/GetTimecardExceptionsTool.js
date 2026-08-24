import { z } from 'zod';
import { McpTool } from './base/McpTool.js';
import { TimecardService } from '../services/TimecardService.js';

export class GetTimecardExceptionsTool extends McpTool {
    static toolName = 'get_timecard_exceptions';
    static description = 'Detects timecard issues (missed clock-outs, unclosed breaks, overlapping shifts, missing wages) for a pay period. Read-only - never auto-corrects.';
    static inputSchema = z.object({
        pay_period_start: z.string().describe('Workday range start date, YYYY-MM-DD.'),
        pay_period_end: z.string().describe('Workday range end date, YYYY-MM-DD.'),
        location_name: z.string().describe('Optional authorized location name to scope the search to.').optional(),
    });
    static outputSchema = z.object({
        timecardCount: z.number(),
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

        return { timecardCount: timecards.length, exceptions: TimecardService.detectExceptions(timecards) };
    }
}
