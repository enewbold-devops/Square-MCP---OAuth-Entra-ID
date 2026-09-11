import { z } from 'zod';

const locationAndPeriod = z.object({
    location_name: z.string().describe('Authorized Square location name.'),
    period_start_at: z.string().describe('RFC 3339 start timestamp in the location time zone.'),
    period_end_at: z.string().describe('RFC 3339 end timestamp in the location time zone.'),
});

export class OperationalPromptRegistry {
    static registerAll(mcpServer) {
        mcpServer.registerPrompt('daily_operator_brief', {
            title: 'Daily operator brief',
            description: 'Creates an evidence-based daily operating brief for one location.',
            argsSchema: locationAndPeriod,
        }, ({ location_name, period_start_at, period_end_at }) => ({
            messages: [{ role: 'user', content: { type: 'text', text: `Prepare a concise owner brief for ${location_name} from ${period_start_at} to ${period_end_at}. Read square://ops/metric-definitions and square://ops/operating-principles. Use get_location_sales_intelligence, get_labor_vs_sales, get_inventory_stock_status, and get_timecard_exceptions as relevant. Report observed wins, risks, likely operational drivers grounded in returned data, recommended next actions, and actions requiring explicit approval. State unavailable data rather than guessing.` } }],
        }));

        mcpServer.registerPrompt('weekly_franchise_review', {
            title: 'Weekly franchise review',
            description: 'Compares authorized locations for a specified operating interval.',
            argsSchema: z.object({
                period_start_at: z.string().describe('RFC 3339 start timestamp.'),
                period_end_at: z.string().describe('RFC 3339 end timestamp.'),
            }),
        }, ({ period_start_at, period_end_at }) => ({
            messages: [{ role: 'user', content: { type: 'text', text: `Review all authorized Square locations from ${period_start_at} to ${period_end_at}. Read square://ops/metric-definitions and square://ops/approval-policy. Use compare_location_sales first, then investigate material differences with location-level sales, labor, and inventory tools. Give the three most consequential findings, evidence, an owner-ready action plan, and any approval required. Do not claim a trend without a comparison period.` } }],
        }));

        mcpServer.registerPrompt('schedule_build_review', {
            title: 'Schedule build review',
            description: 'Develops a draft-only staffing recommendation using live schedule and sales evidence.',
            argsSchema: locationAndPeriod,
        }, ({ location_name, period_start_at, period_end_at }) => ({
            messages: [{ role: 'user', content: { type: 'text', text: `Prepare a draft-only staffing recommendation for ${location_name} from ${period_start_at} to ${period_end_at}. Read square://ops/approval-policy. Use search_scheduled_shifts, get_schedule_constraints, get_workforce_coverage, get_labor_vs_sales, and get_location_sales_intelligence. Identify coverage and overtime risks, propose draft changes, and do not publish a schedule unless the owner later gives explicit approval.` } }],
        }));

        mcpServer.registerPrompt('payroll_close_review', {
            title: 'Payroll close review',
            description: 'Reviews timecard and cash-tip exceptions without making payroll changes.',
            argsSchema: z.object({
                location_name: z.string().describe('Authorized Square location name.'),
                pay_period_start: z.string().describe('Workday start date, YYYY-MM-DD.'),
                pay_period_end: z.string().describe('Workday end date, YYYY-MM-DD.'),
            }),
        }, ({ location_name, pay_period_start, pay_period_end }) => ({
            messages: [{ role: 'user', content: { type: 'text', text: `Review payroll readiness for ${location_name}, ${pay_period_start} through ${pay_period_end}. Use prepare_payroll_reconciliation and get_timecard_exceptions. If cash-tip totals are supplied, use reconcile_cash_tips only to produce a preview. Never call commit_cash_tips without explicit approval, an approved preview token, and an identified approver.` } }],
        }));
    }
}
