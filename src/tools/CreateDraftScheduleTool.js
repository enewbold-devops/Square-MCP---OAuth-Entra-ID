import { z } from 'zod';
import { McpTool } from './base/McpTool.js';
import { ScheduledShiftService } from '../services/ScheduledShiftService.js';

export class CreateDraftScheduleTool extends McpTool {
    static toolName = 'create_draft_schedule';
    static description = 'Creates draft scheduled shifts (not visible to staff until published via publish_schedule). Validates location authorization and checks for overlaps with existing shifts per team member.';
    static inputSchema = z.object({
        shifts_json: z
            .string()
            .describe(
                'JSON array of {"location_name":string,"job_id":string,"team_member_id":string|null,"start_at":string,"end_at":string,"notes":string|null}.'
            ),
    });
    static outputSchema = z.object({
        createdCount: z.number(),
        results: z.array(
            z.object({
                success: z.boolean(),
                request: z.any().optional(),
                error: z.string().optional(),
                scheduledShiftId: z.string().optional(),
            })
        ),
    });
    static annotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

    #squareContextResolver;

    constructor(squareContextResolver) {
        super();
        this.#squareContextResolver = squareContextResolver;
    }

    async handler(args, principal) {
        const squareContext = await this.#squareContextResolver.resolve(principal.principalId);

        let shiftRequests;
        try {
            shiftRequests = JSON.parse(args.shifts_json);
        } catch {
            throw new Error(
                'shifts_json must be a JSON array of {"location_name":string,"job_id":string,"team_member_id":string|null,"start_at":string,"end_at":string,"notes":string|null}.'
            );
        }

        const scheduledShiftService = new ScheduledShiftService(squareContext);
        const results = [];
        for (const request of shiftRequests) {
            try {
                // Authorization and overlap checks are enforced here - never trusted from the model's input.
                const location = squareContext.requireAuthorizedLocation(request.location_name);

                const existing = await scheduledShiftService.searchForPeriod({
                    locationId: location.id,
                    teamMemberId: request.team_member_id || undefined,
                    startDate: request.start_at.slice(0, 10),
                    endDate: (request.end_at || request.start_at).slice(0, 10),
                });
                const overlaps = ScheduledShiftService.findOverlaps(existing, {
                    teamMemberId: request.team_member_id,
                    startAt: request.start_at,
                    endAt: request.end_at,
                });
                if (overlaps.length > 0) {
                    results.push({
                        success: false,
                        request,
                        error: `Overlaps ${overlaps.length} existing shift(s) for this team member.`,
                    });
                    continue;
                }

                const { scheduledShift } = await squareContext.client.labor.createScheduledShift({
                    scheduledShift: {
                        draftShiftDetails: {
                            locationId: location.id,
                            jobId: request.job_id,
                            teamMemberId: request.team_member_id || undefined,
                            startAt: request.start_at,
                            endAt: request.end_at,
                            notes: request.notes,
                        },
                    },
                });
                results.push({ success: true, scheduledShiftId: scheduledShift.id });
            } catch (error) {
                results.push({ success: false, request, error: error.message });
            }
        }

        return { createdCount: results.filter((result) => result.success).length, results };
    }
}
