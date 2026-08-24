import { z } from 'zod';
import { McpTool } from './base/McpTool.js';
import { ScheduledShiftService } from '../services/ScheduledShiftService.js';

export class SearchScheduledShiftsTool extends McpTool {
    static toolName = 'search_scheduled_shifts';
    static description = 'Lists scheduled shifts (draft and/or published) for a date range. Read-only.';
    static inputSchema = z.object({
        pay_period_start: z.string().describe('Workday range start date, YYYY-MM-DD.'),
        pay_period_end: z.string().describe('Workday range end date, YYYY-MM-DD.'),
        location_name: z.string().describe('Optional authorized location name to scope the search to.').optional(),
        assignment_status: z.string().describe('Optional: "ASSIGNED" or "UNASSIGNED".').optional(),
        scheduled_shift_status: z.string().describe('Optional: "DRAFT" or "PUBLISHED".').optional(),
    });
    static outputSchema = z.object({
        shiftCount: z.number(),
        shifts: z.array(
            z.object({ id: z.string(), version: z.number(), draft: z.any().nullable(), published: z.any().nullable() })
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

        const scheduledShiftService = new ScheduledShiftService(squareContext);
        const shifts = await scheduledShiftService.searchForPeriod({
            locationId: location?.id,
            startDate: args.pay_period_start,
            endDate: args.pay_period_end,
            assignmentStatus: args.assignment_status || undefined,
            scheduledShiftStatus: args.scheduled_shift_status || undefined,
        });

        return {
            shiftCount: shifts.length,
            shifts: shifts.map((shift) => ({
                id: shift.id,
                version: shift.version,
                draft: shift.draftShiftDetails ?? null,
                published: shift.publishedShiftDetails ?? null,
            })),
        };
    }
}
