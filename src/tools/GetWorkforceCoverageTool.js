import { z } from 'zod';
import { McpTool } from './base/McpTool.js';
import { ScheduledShiftService } from '../services/ScheduledShiftService.js';

const MAX_JOBS = 1000;

export class GetWorkforceCoverageTool extends McpTool {
    static toolName = 'get_workforce_coverage';
    static description = 'Read-only schedule coverage summary by Square job for one authorized location. Identifies assigned and unassigned draft/published shifts; it does not infer employee availability or qualifications beyond Square job data.';
    static inputSchema = z.object({
        location_name: z.string().describe('Authorized Square location name.'),
        pay_period_start: z.string().describe('Workday range start date, YYYY-MM-DD.'),
        pay_period_end: z.string().describe('Workday range end date, YYYY-MM-DD.'),
    });
    static outputSchema = z.object({
        location: z.string(), totalActiveShifts: z.number(), assignedShiftCount: z.number(), unassignedShiftCount: z.number(), coverageByJob: z.array(z.object({ jobId: z.string().nullable(), jobTitle: z.string(), shiftCount: z.number(), assignedShiftCount: z.number(), unassignedShiftCount: z.number() })),
    });
    static annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

    #squareContextResolver;

    constructor(squareContextResolver) {
        super();
        this.#squareContextResolver = squareContextResolver;
    }

    async #listJobs(squareContext) {
        const jobs = [];
        let cursor;
        do {
            const page = await squareContext.client.team.listJobs({ cursor });
            jobs.push(...(page.jobs ?? []));
            cursor = page.cursor;
        } while (cursor && jobs.length < MAX_JOBS);
        if (cursor) {
            throw new Error(`Job search exceeds the ${MAX_JOBS}-job safety limit.`);
        }
        return jobs;
    }

    async handler(args, principal) {
        const squareContext = await this.#squareContextResolver.resolve(principal.principalId);
        const location = squareContext.requireAuthorizedLocation(args.location_name);
        const [shifts, jobs] = await Promise.all([
            new ScheduledShiftService(squareContext).searchForPeriod({ locationId: location.id, startDate: args.pay_period_start, endDate: args.pay_period_end }),
            this.#listJobs(squareContext),
        ]);
        const jobTitles = new Map(jobs.map((job) => [job.id, job.title ?? job.id ?? 'Unnamed job']));
        const coverage = new Map();
        for (const shift of shifts) {
            const details = shift.publishedShiftDetails ?? shift.draftShiftDetails;
            if (!details || details.isDeleted) {
                continue;
            }
            const jobId = details.jobId ?? null;
            const entry = coverage.get(jobId) ?? { jobId, jobTitle: jobId ? (jobTitles.get(jobId) ?? `Unknown job (${jobId})`) : 'No job assigned', shiftCount: 0, assignedShiftCount: 0, unassignedShiftCount: 0 };
            entry.shiftCount += 1;
            if (details.teamMemberId) {
                entry.assignedShiftCount += 1;
            } else {
                entry.unassignedShiftCount += 1;
            }
            coverage.set(jobId, entry);
        }
        const coverageByJob = [...coverage.values()].sort((left, right) => right.unassignedShiftCount - left.unassignedShiftCount || left.jobTitle.localeCompare(right.jobTitle));
        return {
            location: location.name ?? location.id,
            totalActiveShifts: coverageByJob.reduce((total, entry) => total + entry.shiftCount, 0),
            assignedShiftCount: coverageByJob.reduce((total, entry) => total + entry.assignedShiftCount, 0),
            unassignedShiftCount: coverageByJob.reduce((total, entry) => total + entry.unassignedShiftCount, 0),
            coverageByJob,
        };
    }
}
