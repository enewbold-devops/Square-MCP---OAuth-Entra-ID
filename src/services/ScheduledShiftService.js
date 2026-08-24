// Pure domain logic for the scheduling agent tool group, plus the Square Labor API calls scoped to
// one resolved SquareContext - mirrors TimecardService's shape but operates on ScheduledShift's
// nested draft/published details rather than a flat Timecard.
export class ScheduledShiftService {
    // US federal default only - not jurisdiction-aware.
    static OVERTIME_WEEKLY_HOURS_THRESHOLD = 40;

    #squareContext;

    constructor(squareContext) {
        this.#squareContext = squareContext;
    }

    // Wraps labor.searchScheduledShifts scoped to a workday date range (and optionally location/team member/status).
    async searchForPeriod({ locationId, teamMemberId, startDate, endDate, assignmentStatus, scheduledShiftStatus } = {}) {
        const filter = {
            workday: { dateRange: { startDate, endDate }, matchScheduledShiftsBy: 'START_AT' },
        };
        if (locationId) {
            filter.locationIds = [locationId];
        }
        if (teamMemberId) {
            filter.teamMemberIds = [teamMemberId];
        }
        if (assignmentStatus) {
            filter.assignmentStatus = assignmentStatus;
        }
        if (scheduledShiftStatus) {
            filter.scheduledShiftStatuses = [scheduledShiftStatus];
        }

        const { scheduledShifts } = await this.#squareContext.client.labor.searchScheduledShifts({ query: { filter }, limit: 200 });
        return scheduledShifts ?? [];
    }

    // Assumes one workweek config per business - not verified against a seller with multiple locations.
    async getWorkweekConfig() {
        const page = await this.#squareContext.client.labor.workweekConfigs.list();
        return page.data[0] ?? null;
    }

    static #activeDetails(shift) {
        return shift.publishedShiftDetails ?? shift.draftShiftDetails;
    }

    static #toInterval(details) {
        const start = new Date(details.startAt).getTime();
        const end = details.endAt ? new Date(details.endAt).getTime() : Infinity;
        return { start, end };
    }

    // Compares a candidate {id?, teamMemberId, startAt, endAt} against existing ScheduledShift records
    // for the same team member. Ignores deleted shifts and shifts with no team member.
    static findOverlaps(existingShifts, candidate) {
        if (!candidate.teamMemberId) {
            return [];
        }
        const candidateInterval = ScheduledShiftService.#toInterval(candidate);

        return existingShifts.filter((shift) => {
            if (candidate.id && shift.id === candidate.id) {
                return false;
            }
            const details = ScheduledShiftService.#activeDetails(shift);
            if (!details || details.isDeleted || details.teamMemberId !== candidate.teamMemberId) {
                return false;
            }
            const existing = ScheduledShiftService.#toInterval(details);
            return candidateInterval.start < existing.end && existing.start < candidateInterval.end;
        });
    }

    // Guards Square's own bulk-publish constraint before calling it, to avoid a server-side rejection.
    static validateTwoWeekWindow(shifts) {
        const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
        const starts = shifts.map((shift) => ScheduledShiftService.#toInterval(ScheduledShiftService.#activeDetails(shift)).start);
        const ends = shifts.map((shift) => {
            const interval = ScheduledShiftService.#toInterval(ScheduledShiftService.#activeDetails(shift));
            return interval.end === Infinity ? interval.start : interval.end;
        });
        const span = Math.max(...ends) - Math.min(...starts);
        if (span > TWO_WEEKS_MS) {
            throw new Error('Shifts in a single publish batch must fall within a two-week period (Square API constraint).');
        }
    }

    // Sums scheduled hours per team member across a shift set (draft or published, whichever is active).
    static summarizeHoursByTeamMember(shifts) {
        const totals = {};
        for (const shift of shifts) {
            const details = ScheduledShiftService.#activeDetails(shift);
            if (!details?.teamMemberId || details.isDeleted) {
                continue;
            }
            const interval = ScheduledShiftService.#toInterval(details);
            if (interval.end === Infinity) {
                continue;
            }
            const hours = (interval.end - interval.start) / (1000 * 60 * 60);
            totals[details.teamMemberId] = (totals[details.teamMemberId] ?? 0) + hours;
        }
        return totals;
    }
}
