const Roles = Object.freeze({
    ADMIN: 'SquareMcp.Admin',
    READER: 'SquareMcp.Reader',
    SCHEDULER: 'SquareMcp.Scheduler',
    PAYROLL_APPROVER: 'SquareMcp.PayrollApprover',
    SQUARE_CONNECTOR: 'SquareMcp.SquareConnector',
});

const READ_ROLES = [Roles.READER, Roles.SCHEDULER, Roles.PAYROLL_APPROVER, Roles.SQUARE_CONNECTOR, Roles.ADMIN];

const TOOL_ROLE_POLICIES = Object.freeze({
    who_am_i: READ_ROLES,
    square_connect_account: [Roles.SQUARE_CONNECTOR, Roles.ADMIN],
    square_disconnect_account: [Roles.SQUARE_CONNECTOR, Roles.ADMIN],
    prepare_payroll_reconciliation: [Roles.PAYROLL_APPROVER, Roles.ADMIN],
    get_timecard_exceptions: [Roles.READER, Roles.PAYROLL_APPROVER, Roles.ADMIN],
    reconcile_cash_tips: [Roles.PAYROLL_APPROVER, Roles.ADMIN],
    commit_cash_tips: [Roles.PAYROLL_APPROVER, Roles.ADMIN],
    search_scheduled_shifts: [Roles.READER, Roles.SCHEDULER, Roles.ADMIN],
    get_schedule_constraints: [Roles.READER, Roles.SCHEDULER, Roles.ADMIN],
    create_draft_schedule: [Roles.SCHEDULER, Roles.ADMIN],
    update_draft_shift: [Roles.SCHEDULER, Roles.ADMIN],
    publish_schedule: [Roles.SCHEDULER, Roles.ADMIN],
});

export { Roles };

export function authorizeTool(principal, toolName) {
    const requiredRoles = TOOL_ROLE_POLICIES[toolName];
    if (!requiredRoles) {
        throw new Error(`No authorization policy is defined for tool "${toolName}".`);
    }

    const grantedRoles = new Set(principal.roles ?? []);
    if (!requiredRoles.some((role) => grantedRoles.has(role))) {
        throw new Error(`You are not authorized to use ${toolName}.`);
    }
}
