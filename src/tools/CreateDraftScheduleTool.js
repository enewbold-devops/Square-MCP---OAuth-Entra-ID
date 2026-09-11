import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { McpTool } from './base/McpTool.js';
import { ScheduledShiftService } from '../services/ScheduledShiftService.js';

export class CreateDraftScheduleTool extends McpTool {
    static MAX_DRAFT_SHIFTS_PER_CALL = 25;
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
        if (!Array.isArray(shiftRequests) || shiftRequests.length === 0) {
            throw new Error('shifts_json must contain at least one shift request.');
        }
        if (shiftRequests.length > CreateDraftScheduleTool.MAX_DRAFT_SHIFTS_PER_CALL) {
            throw new Error(`A draft-schedule request can contain at most ${CreateDraftScheduleTool.MAX_DRAFT_SHIFTS_PER_CALL} shifts. Split this request into batches.`);
        }

        const scheduledShiftService = new ScheduledShiftService(squareContext);
        const results = [];
        for (const request of shiftRequests) {
            try {
                if (!request || typeof request !== 'object') {
                    throw new Error('Each shift request must be an object.');
                }
                if (!request.location_name || !request.job_id || !request.start_at || !request.end_at) {
                    throw new Error('Each shift requires location_name, job_id, start_at, and end_at.');
                }
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
                    idempotencyKey: randomUUID(),
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
