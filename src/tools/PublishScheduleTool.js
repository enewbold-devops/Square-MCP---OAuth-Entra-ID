import { z } from 'zod';
import { McpTool } from './base/McpTool.js';
import { ScheduledShiftService } from '../services/ScheduledShiftService.js';

export class PublishScheduleTool extends McpTool {
    static MAX_PUBLISH_BATCH_SIZE = 100;
    static toolName = 'publish_schedule';
    static description = 'Publishes draft scheduled shifts, making them visible to staff and triggering notifications. Requires explicit shift IDs and owner approval - this is the consequential step in scheduling.';
    static inputSchema = z.object({
        scheduled_shift_ids_json: z.string().describe('JSON array of scheduled shift IDs to publish.'),
        approved_by: z.string().describe('Name or identifier of the person approving this publish.'),
        notification_audience: z.string().describe('Optional: "ALL", "AFFECTED" (default), or "NONE".').optional(),
    });
    static outputSchema = z.object({
        approvedBy: z.string(),
        publishedCount: z.number(),
        results: z.array(z.object({ scheduledShiftId: z.string(), success: z.boolean(), errors: z.any().nullable() })),
    });
    static annotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

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
        if (shiftIds.length > PublishScheduleTool.MAX_PUBLISH_BATCH_SIZE) {
            throw new Error(`A publish request can contain at most ${PublishScheduleTool.MAX_PUBLISH_BATCH_SIZE} shifts. Split this request into batches.`);
        }
        if (!shiftIds.every((id) => typeof id === 'string' && id.length > 0)) {
            throw new Error('scheduled_shift_ids_json must contain only non-empty shift ID strings.');
        }
        if (new Set(shiftIds).size !== shiftIds.length) {
            throw new Error('scheduled_shift_ids_json must not contain duplicate shift IDs.');
        }
        const audience = args.notification_audience || 'AFFECTED';
        if (!['ALL', 'AFFECTED', 'NONE'].includes(audience)) {
            throw new Error('notification_audience must be ALL, AFFECTED, or NONE.');
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
            scheduledShiftNotificationAudience: audience,
        });

        const results = Object.entries(responses ?? {}).map(([id, response]) => ({
            scheduledShiftId: id,
            success: !response.errors,
            errors: response.errors ?? null,
        }));

        return {
            approvedBy: args.approved_by,
            publishedCount: results.filter((result) => result.success).length,
            results,
        };
    }
}
