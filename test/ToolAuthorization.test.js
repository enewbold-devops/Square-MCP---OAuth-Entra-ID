import assert from 'node:assert/strict';
import test from 'node:test';

import { authorizeTool } from '../src/security/ToolAuthorization.js';

test('allows the matching application role and denies an unrelated role', () => {
    authorizeTool({ roles: ['SquareMcp.PayrollApprover'] }, 'commit_cash_tips');
    assert.throws(
        () => authorizeTool({ roles: ['SquareMcp.Reader'] }, 'commit_cash_tips'),
        /not authorized/
    );
});
