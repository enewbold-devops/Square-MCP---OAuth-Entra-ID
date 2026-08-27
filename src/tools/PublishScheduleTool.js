import { z } from 'zod';
import { McpTool } from './base/McpTool.js';
import { ScheduledShiftService } from '../services/ScheduledShiftService.js';

export class PublishScheduleTool extends McpTool {
    static toolName = 'publish_schedule';
    static description = 'Publishes draft scheduled shifts, making them visible to staff and triggering notifications. Requires explicit shift IDs and owner approval - this is the consequential step in scheduling.';
    static inputSchema = z.object({
        scheduled_shift_ids_json: z.string().describe('JSON array of scheduled shift IDs to publish.'),
        approval_note: z.string().describe('Optional human approval note for the audit record.').optional(),
        notification_audience: z.string().describe('Optional: "ALL", "AFFECTED" (default), or "NONE".').optional(),
    });
    static outputSchema = z.object({
        approvedBy: z.string(),
        publishedCount: z.number(),
        results: z.array(z.object({ scheduledShiftId: z.string(), success: z.boolean(), errors: z.any().nullable() })),
    });
    static annotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

    #squareContextResolver;

    constructor(squareContextResolver) {
        super();
        this.#squareContextResolver = squareContextResolver;
    }

    async handler(args, principal) {
        const squareContext = await this.#squareContextResolver.resolve(principal.principalId);

        let shiftIds;
        try {
            shiftIds = JSON.parse(args.scheduled_shift_ids_json);
        } catch {
            throw new Error('scheduled_shift_ids_json must be a JSON array of scheduled shift IDs.');
        }
        if (!Array.isArray(shiftIds) || shiftIds.length === 0) {
            throw new Error('scheduled_shift_ids_json must contain at least one scheduled shift ID.');
        }

        // Re-read fresh immediately before publishing - never reuse a version from an earlier search/read.
        const current = [];
        for (const id of shiftIds) {
            const { scheduledShift } = await squareContext.client.labor.retrieveScheduledShift({ id });
            const details = scheduledShift.draftShiftDetails ?? scheduledShift.publishedShiftDetails;
            squareContext.requireAuthorizedLocation(details?.locationId);
            current.push(scheduledShift);
        }

        ScheduledShiftService.validateTwoWeekWindow(current);

        const scheduledShifts = {};
        for (const shift of current) {
            scheduledShifts[shift.id] = { version: shift.version };
        }

        const { responses } = await squareContext.client.labor.bulkPublishScheduledShifts({
            scheduledShifts,
            scheduledShiftNotificationAudience: args.notification_audience || 'AFFECTED',
        });

        const results = Object.entries(responses ?? {}).map(([id, response]) => ({
            scheduledShiftId: id,
            success: !response.errors,
            errors: response.errors ?? null,
        }));

        return {
            approvedBy: principal.displayName || principal.objectId,
            publishedCount: results.filter((result) => result.success).length,
            results,
        };
    }
}
