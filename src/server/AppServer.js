import { createMcpExpressApp } from '@modelcontextprotocol/express';

import { AppConfig } from '../config/AppConfig.js';
import { KeyVaultService } from '../services/KeyVaultService.js';
import { SquareOAuthService } from '../services/SquareOAuthService.js';
import { OAuthStateSigner } from '../services/OAuthStateSigner.js';
import { PreviewTokenSigner } from '../services/PreviewTokenSigner.js';
import { SquareContextResolver } from '../services/SquareContextResolver.js';
import { easyAuthPrincipal } from '../web/middleware/EasyAuthPrincipal.js';

import { WhoAmITool } from '../tools/WhoAmITool.js';
import { SquareConnectAccountTool } from '../tools/SquareConnectAccountTool.js';
import { PreparePayrollReconciliationTool } from '../tools/PreparePayrollReconciliationTool.js';
import { GetTimecardExceptionsTool } from '../tools/GetTimecardExceptionsTool.js';
import { ReconcileCashTipsTool } from '../tools/ReconcileCashTipsTool.js';
import { CommitCashTipsTool } from '../tools/CommitCashTipsTool.js';
import { SearchScheduledShiftsTool } from '../tools/SearchScheduledShiftsTool.js';
import { GetScheduleConstraintsTool } from '../tools/GetScheduleConstraintsTool.js';
import { CreateDraftScheduleTool } from '../tools/CreateDraftScheduleTool.js';
import { UpdateDraftShiftTool } from '../tools/UpdateDraftShiftTool.js';
import { PublishScheduleTool } from '../tools/PublishScheduleTool.js';

import { McpEndpointController } from '../web/routes/McpEndpointController.js';
import { SquareOAuthController } from '../web/routes/SquareOAuthController.js';

const SERVER_NAME = 'SquareMCP-FranchiseRestaurantOps';
const SERVER_VERSION = '3.0.0';
const SERVER_INSTRUCTIONS =
    'Square operations MCP server for franchise restaurants: payroll, tip reconciliation, timecards, scheduling, and workforce tools, scoped per connected franchise owner.';

// Composition root: wires every service/tool once at startup and exposes the Express app.
export class AppServer {
    #config;
    #app;

    constructor(config = new AppConfig()) {
        this.#config = config;
        this.#app = this.#buildApp();
    }

    #buildApp() {
        const keyVaultService = new KeyVaultService(this.#config.keyVaultUri);
        const squareOAuthService = new SquareOAuthService(keyVaultService);
        const oauthStateSigner = new OAuthStateSigner(keyVaultService);
        const previewTokenSigner = new PreviewTokenSigner(keyVaultService);
        const squareContextResolver = new SquareContextResolver(keyVaultService, squareOAuthService);

        // Enterprise identity is proven by Azure App Service Authentication (Easy Auth), configured
        // on the App Service resource itself (Microsoft Entra ID provider, "Require authentication") -
        // no in-code OAuth broker/PKCE handling/JWT verification is needed here. This also drops the
        // PKCE requirement ChatGPT's MCP client enforced, unblocking Microsoft Copilot Studio Agents,
        // which authenticate through the platform and don't need PKCE discovery metadata.
        const authMiddleware = easyAuthPrincipal({ devPrincipal: this.#config.easyAuthDevPrincipal });

        const tools = [
            new WhoAmITool(squareContextResolver),
            new SquareConnectAccountTool(squareContextResolver, oauthStateSigner, this.#config),
            new PreparePayrollReconciliationTool(squareContextResolver),
            new GetTimecardExceptionsTool(squareContextResolver),
            new ReconcileCashTipsTool(squareContextResolver, previewTokenSigner),
            new CommitCashTipsTool(squareContextResolver, previewTokenSigner),
            new SearchScheduledShiftsTool(squareContextResolver),
            new GetScheduleConstraintsTool(squareContextResolver),
            new CreateDraftScheduleTool(squareContextResolver),
            new UpdateDraftShiftTool(squareContextResolver),
            new PublishScheduleTool(squareContextResolver),
        ];

        // 'host: 0.0.0.0' disables createMcpExpressApp's built-in localhost-only default -
        // allowedHosts (which includes WEBSITE_HOSTNAME in Azure) takes over instead.
        const app = createMcpExpressApp({
            host: '0.0.0.0',
            allowedHosts: this.#config.allowedHosts,
            allowedOrigins: this.#config.allowedHosts,
        });

        new SquareOAuthController({ config: this.#config, oauthStateSigner, squareOAuthService, keyVaultService }).registerRoutes(app);
        new McpEndpointController({
            serverName: SERVER_NAME,
            serverVersion: SERVER_VERSION,
            serverInstructions: SERVER_INSTRUCTIONS,
            tools,
            authMiddleware,
        }).registerRoutes(app);

        return app;
    }

    start() {
        return this.#app.listen(this.#config.port, () => {
            console.log(`azapp-nodejs-mcp listening on port ${this.#config.port}`);
        });
    }
}
