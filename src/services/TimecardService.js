// Pure domain logic for the payroll/tip reconciliation tool group, plus the Square Labor API calls
// scoped to one resolved SquareContext - static methods never touch Square, only instance methods do.
export class TimecardService {
    #squareContext;

    constructor(squareContext) {
        this.#squareContext = squareContext;
    }

    // Wraps labor.searchTimecards scoped to a workday date range (and optionally one location/status).
    async searchForPeriod({ locationId, startDate, endDate, status } = {}) {
        const filter = {
            workday: { dateRange: { startDate, endDate }, matchTimecardsBy: 'START_AT' },
        };
        if (locationId) {
            filter.locationIds = [locationId];
        }
        if (status) {
            filter.status = status;
        }

        const { timecards } = await this.#squareContext.client.labor.searchTimecards({ query: { filter }, limit: 200 });
        return timecards ?? [];
    }

    static #hasUnclosedBreak(timecard) {
        return (timecard.breaks ?? []).some((brk) => !brk.endAt);
    }

    static #overlapsAnother(timecard, all) {
        const start = new Date(timecard.startAt).getTime();
        const end = timecard.endAt ? new Date(timecard.endAt).getTime() : Infinity;
        return all.some((other) => {
            if (other.id === timecard.id || other.teamMemberId !== timecard.teamMemberId) {
                return false;
            }
            const otherStart = new Date(other.startAt).getTime();
            const otherEnd = other.endAt ? new Date(other.endAt).getTime() : Infinity;
            return start < otherEnd && otherStart < end;
        });
    }

    // Detection-only - never auto-corrects. Missed clock-outs, unclosed breaks, double-punches, wage misconfiguration.
    static detectExceptions(timecards) {
        const exceptions = [];
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

        for (const timecard of timecards) {
            if (timecard.status === 'OPEN' && new Date(timecard.startAt).getTime() < oneDayAgo) {
                exceptions.push({
                    timecardId: timecard.id,
                    teamMemberId: timecard.teamMemberId,
                    type: 'MISSED_CLOCK_OUT',
                    detail: 'Timecard is still OPEN from a past workday.',
                });
            }
            if (timecard.status === 'CLOSED' && TimecardService.#hasUnclosedBreak(timecard)) {
                exceptions.push({
                    timecardId: timecard.id,
                    teamMemberId: timecard.teamMemberId,
                    type: 'UNCLOSED_BREAK',
                    detail: 'A break on this closed timecard has no end time.',
                });
            }
            if (timecard.status === 'CLOSED' && !timecard.wage?.hourlyRate?.amount) {
                exceptions.push({
                    timecardId: timecard.id,
                    teamMemberId: timecard.teamMemberId,
                    type: 'MISSING_WAGE',
                    detail: 'Closed timecard has no hourly rate configured.',
                });
            }
            if (TimecardService.#overlapsAnother(timecard, timecards)) {
                exceptions.push({
                    timecardId: timecard.id,
                    teamMemberId: timecard.teamMemberId,
                    type: 'OVERLAPPING_SHIFT',
                    detail: 'This timecard overlaps another timecard for the same team member.',
                });
            }
        }

        return exceptions;
    }

    static #workdayOf(timecard) {
        return timecard.startAt.slice(0, 10);
    }

    static #hoursWorked(timecard) {
        const start = new Date(timecard.startAt).getTime();
        const end = timecard.endAt ? new Date(timecard.endAt).getTime() : start;
        return Math.max(0, (end - start) / (1000 * 60 * 60));
    }

    // Deterministic tip-split math - the language model never computes dollar amounts itself. Excludes
    // anything flagged by detectExceptions (surfaced as a warning, never silently dropped from the total).
    static allocateCashTips(timecards, dailyCashTotals, allocationMethod = 'equal_split') {
        const excludedIds = new Set(TimecardService.detectExceptions(timecards).map((exception) => exception.timecardId));

        const allocations = [];
        const excluded = [];
        const byDate = {};

        for (const entry of dailyCashTotals) {
            const { date, locationId, amount } = entry;
            const eligible = timecards.filter(
                (timecard) =>
                    timecard.wage?.tipEligible === true &&
                    (!locationId || timecard.locationId === locationId) &&
                    TimecardService.#workdayOf(timecard) === date
            );

            const usable = eligible.filter((timecard) => !excludedIds.has(timecard.id));
            eligible
                .filter((timecard) => excludedIds.has(timecard.id))
                .forEach((timecard) =>
                    excluded.push({
                        timecardId: timecard.id,
                        teamMemberId: timecard.teamMemberId,
                        date,
                        reason: 'Excluded due to a detected timecard exception.',
                    })
                );

            if (usable.length === 0) {
                byDate[date] = { totalCash: amount, allocatedCount: 0 };
                continue;
            }

            const weights = allocationMethod === 'hours_weighted' ? usable.map(TimecardService.#hoursWorked) : usable.map(() => 1);
            const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

            usable.forEach((timecard, index) => {
                const share = totalWeight > 0 ? (weights[index] / totalWeight) * amount : 0;
                allocations.push({
                    timecardId: timecard.id,
                    teamMemberId: timecard.teamMemberId,
                    date,
                    amount: Math.round(share * 100) / 100,
                });
            });

            byDate[date] = { totalCash: amount, allocatedCount: usable.length };
        }

        return { allocations, excluded, byDate };
    }
}
