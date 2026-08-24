import { z } from 'zod';
import { McpTool } from './base/McpTool.js';
import { ScheduledShiftService } from '../services/ScheduledShiftService.js';

export class GetScheduleConstraintsTool extends McpTool {
    static toolName = 'get_schedule_constraints';
    static description = 'Read-only overtime-risk inputs for a pay period: workweek config, scheduled hours per team member, and the overtime hour threshold. Does not include employee availability or preferences - those are handled conversationally, not stored.';
    static inputSchema = z.object({
        pay_period_start: z.string().describe('Workday range start date, YYYY-MM-DD.'),
        pay_period_end: z.string().describe('Workday range end date, YYYY-MM-DD.'),
        location_name: z.string().describe('Optional authorized location name to scope the search to.').optional(),
    });
    static outputSchema = z.object({
        workweekConfig: z.any().nullable(),
        overtimeWeeklyHoursThreshold: z.number(),
        overtimeThresholdNote: z.string(),
        scheduledHoursByTeamMember: z.record(z.string(), z.number()),
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
        });
        const workweekConfig = await scheduledShiftService.getWorkweekConfig();

        return {
            workweekConfig,
            overtimeWeeklyHoursThreshold: ScheduledShiftService.OVERTIME_WEEKLY_HOURS_THRESHOLD,
            overtimeThresholdNote: 'US federal default (40 hrs/week) - not jurisdiction-aware.',
            scheduledHoursByTeamMember: ScheduledShiftService.summarizeHoursByTeamMember(shifts),
        };
    }
}
