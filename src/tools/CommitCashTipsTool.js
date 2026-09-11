import { z } from 'zod';
import { McpTool } from './base/McpTool.js';

function toMoneyAmount(dollars) {
    return BigInt(Math.round(dollars * 100));
}

export class CommitCashTipsTool extends McpTool {
    static MAX_TIP_COMMITS_PER_CALL = 50;
    static toolName = 'commit_cash_tips';
    static description = 'Writes an owner-approved cash-tip allocation (from a prior reconcile_cash_tips preview) back to Square timecards. Requires a valid, unexpired preview_token.';
    static inputSchema = z.object({
        preview_token: z.string().describe('The previewToken returned by reconcile_cash_tips.'),
        approved_by: z.string().describe('Name or identifier of the person approving this payroll action.'),
        approved_timecard_ids_json: z
            .string()
            .describe('Optional JSON array of timecard IDs to commit (subset of the preview). Omit to commit all previewed allocations.')
            .optional(),
    });
    static outputSchema = z.object({
        approvedBy: z.string().optional(),
        committedCount: z.number(),
        results: z.array(z.object({ timecardId: z.string(), success: z.boolean(), error: z.string().optional() })),
    });
    static annotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

    #squareContextResolver;
    #previewTokenSigner;

    constructor(squareContextResolver, previewTokenSigner) {
        super();
        this.#squareContextResolver = squareContextResolver;
        this.#previewTokenSigner = previewTokenSigner;
    }

    async handler(args, principal) {
        const preview = await this.#previewTokenSigner.verify(args.preview_token);
        if (!preview) {
            throw new Error('preview_token is missing, invalid, or expired. Run reconcile_cash_tips again before committing.');
        }

        const squareContext = await this.#squareContextResolver.resolve(principal.principalId);
        if (preview.principalId !== principal.principalId || preview.merchantId !== squareContext.merchantId) {
            throw new Error('preview_token belongs to a different account. Run reconcile_cash_tips again.');
        }

        let approvedIds = null;
        if (args.approved_timecard_ids_json) {
            try {
                approvedIds = new Set(JSON.parse(args.approved_timecard_ids_json));
            } catch {
                throw new Error('approved_timecard_ids_json must be a JSON array of timecard IDs.');
            }
        }

        const toCommit = approvedIds
            ? preview.allocations.filter((allocation) => approvedIds.has(allocation.timecardId))
            : preview.allocations;
        if (toCommit.length === 0) {
            throw new Error('No allocations to commit - nothing in approved_timecard_ids_json matched the preview.');
        }
        if (toCommit.length > CommitCashTipsTool.MAX_TIP_COMMITS_PER_CALL) {
            throw new Error(`A cash-tip commit can update at most ${CommitCashTipsTool.MAX_TIP_COMMITS_PER_CALL} timecards. Approve a smaller subset.`);
        }

        const results = [];
        for (const allocation of toCommit) {
            try {
                // Re-read immediately before writing: the preview's data may be stale by approval time,
                // and Timecard.version is required for optimistic concurrency on the update.
                const { timecard: current } = await squareContext.client.labor.retrieveTimecard({ id: allocation.timecardId });
                if (current.locationId !== preview.locationId) {
                    throw new Error('Timecard location does not match the approved preview.');
                }
                if (current.version !== preview.timecardVersions?.[allocation.timecardId]) {
                    throw new Error('Timecard has changed since the preview. Run reconcile_cash_tips again before committing.');
                }
                const { id: _currentId, ...timecardFields } = current;
                await squareContext.client.labor.updateTimecard({
                    id: allocation.timecardId,
                    timecard: {
                        ...timecardFields,
                        declaredCashTipMoney: { amount: toMoneyAmount(allocation.amount), currency: 'USD' },
                    },
                });
                results.push({ timecardId: allocation.timecardId, success: true });
            } catch (error) {
                results.push({ timecardId: allocation.timecardId, success: false, error: error.message });
            }
        }

        return {
            approvedBy: args.approved_by,
            committedCount: results.filter((result) => result.success).length,
            results,
        };
    }
}
