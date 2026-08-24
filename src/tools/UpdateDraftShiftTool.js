import { z } from 'zod';
import { McpTool } from './base/McpTool.js';

export class UpdateDraftShiftTool extends McpTool {
    static toolName = 'update_draft_shift';
    static description = 'Updates (or deletes, via is_deleted) a draft scheduled shift. Only affects the draft - use publish_schedule to make changes visible to staff.';
    static inputSchema = z.object({
        scheduled_shift_id: z.string().describe('The ID of the scheduled shift to update.'),
        job_id: z.string().describe('Optional new job ID.').optional(),
        team_member_id: z.string().describe('Optional new team member ID (empty string to unassign).').optional(),
        start_at: z.string().describe('Optional new start time, RFC 3339.').optional(),
        end_at: z.string().describe('Optional new end time, RFC 3339.').optional(),
        notes: z.string().describe('Optional new notes.').optional(),
        is_deleted: z.boolean().describe('Optional: true to delete this draft shift.').optional(),
    });
    static outputSchema = z.object({
        scheduledShiftId: z.string(),
        version: z.number(),
        deleted: z.boolean(),
    });
    static annotations = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };

    #squareContextResolver;

    constructor(squareContextResolver) {
        super();
        this.#squareContextResolver = squareContextResolver;
    }

    async handler(args, principal) {
        const squareContext = await this.#squareContextResolver.resolve(principal.principalId);

        // Re-read immediately before writing: Square requires the current version for optimistic concurrency.
        const { scheduledShift: current } = await squareContext.client.labor.retrieveScheduledShift({
            id: args.scheduled_shift_id,
        });
        const draft = { ...current.draftShiftDetails };

        if (args.job_id) {
            draft.jobId = args.job_id;
        }
        if (args.team_member_id !== undefined) {
            draft.teamMemberId = args.team_member_id || null;
        }
        if (args.start_at) {
            draft.startAt = args.start_at;
        }
        if (args.end_at) {
            draft.endAt = args.end_at;
        }
        if (args.notes !== undefined) {
            draft.notes = args.notes || null;
        }
        if (args.is_deleted !== undefined) {
            // Square models deletion as an update flag - there is no separate delete-scheduled-shift endpoint.
            draft.isDeleted = args.is_deleted === true;
        }

        const { scheduledShift: updated } = await squareContext.client.labor.updateScheduledShift({
            id: args.scheduled_shift_id,
            scheduledShift: { draftShiftDetails: draft, version: current.version },
        });

        return {
            scheduledShiftId: updated.id,
            version: updated.version,
            deleted: !!draft.isDeleted,
        };
    }
}
