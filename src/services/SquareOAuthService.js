import { SquareClient, SquareEnvironment } from 'square';

// Scopes for the payroll/tip reconciliation + scheduling MCP tool groups - confirmed against Square's
// live OAuth Permissions Reference per-endpoint: SearchTimecards/RetrieveTimecard/SearchScheduledShifts/
// RetrieveScheduledShift need TIMECARDS_READ; CreateScheduledShift/UpdateScheduledShift/
// BulkPublishScheduledShifts need TIMECARDS_WRITE; UpdateTimecard (commit_cash_tips) and
// ListWorkweekConfigs (get_schedule_constraints) need TIMECARDS_SETTINGS_READ/_WRITE, not TIMECARDS_WRITE.
export class SquareOAuthService {
    static SQUARE_OAUTH_SCOPES = [
        'MERCHANT_PROFILE_READ',
        'EMPLOYEES_READ',
        'TIMECARDS_READ',
        'TIMECARDS_WRITE',
        'TIMECARDS_SETTINGS_READ',
        'TIMECARDS_SETTINGS_WRITE',
        'ORDERS_READ',
        'ITEMS_READ',
        'INVENTORY_READ',
    ];

    #keyVaultService;
    #environmentName = null;
    #applicationId = null;
    #applicationSecret = null;

    constructor(keyVaultService) {
        this.#keyVaultService = keyVaultService;
    }

    async #getEnvironmentName() {
        if (!this.#environmentName) {
            this.#environmentName = await this.#keyVaultService.getSecret('Square-Environment');
        }
        return this.#environmentName;
    }

    async getEnvironment() {
        const name = await this.#getEnvironmentName();
        return name === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox;
    }

    // Square's authorize endpoint differs by environment, unlike the shared API host used for data-plane/OAuth-token calls.
    async getOAuthAuthorizeBaseUrl() {
        const name = await this.#getEnvironmentName();
        return name === 'production'
            ? 'https://connect.squareup.com/oauth2/authorize'
            : 'https://connect.squareupsandbox.com/oauth2/authorize';
    }

    // App credentials for the OAuth token exchange/refresh endpoints - not the per-caller seller access token.
    async getApplicationCredentials() {
        if (!this.#applicationId) {
            this.#applicationId = await this.#keyVaultService.getSecret('Square-AppId');
        }
        if (!this.#applicationSecret) {
            this.#applicationSecret = await this.#keyVaultService.getSecret('Square-AppSecret');
        }
        return { applicationId: this.#applicationId, applicationSecret: this.#applicationSecret };
    }

    // Builds a Square SDK client scoped to one caller's access token (never a shared/app-level token).
    async createClient(accessToken) {
        return new SquareClient({ token: accessToken, environment: await this.getEnvironment() });
    }

    async createOAuthClient() {
        return new SquareClient({ token: '', environment: await this.getEnvironment() });
    }

    async obtainToken({ code, redirectUri }) {
        const client = await this.createOAuthClient();
        const { applicationId, applicationSecret } = await this.getApplicationCredentials();
        return client.oAuth.obtainToken({
            clientId: applicationId,
            clientSecret: applicationSecret,
            code,
            grantType: 'authorization_code',
            redirectUri,
        });
    }

    async refreshToken(refreshToken) {
        const client = await this.createOAuthClient();
        const { applicationId, applicationSecret } = await this.getApplicationCredentials();
        return client.oAuth.obtainToken({
            clientId: applicationId,
            clientSecret: applicationSecret,
            refreshToken,
            grantType: 'refresh_token',
        });
    }
}
