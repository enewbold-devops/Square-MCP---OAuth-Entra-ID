import { createMcpExpressApp, mcpAuthMetadataRouter } from '@modelcontextprotocol/express';

import { AppConfig } from '../config/AppConfig.js';
import { KeyVaultService } from '../services/KeyVaultService.js';
import { SquareOAuthService } from '../services/SquareOAuthService.js';
import { EntraOAuthService } from '../services/EntraOAuthService.js';
import { BrokerTokenSigner } from '../services/BrokerTokenSigner.js';
import { McpTokenVerifier } from '../services/McpTokenVerifier.js';
import { OAuthStateSigner } from '../services/OAuthStateSigner.js';
import { PreviewTokenSigner } from '../services/PreviewTokenSigner.js';
import { SquareContextResolver } from '../services/SquareContextResolver.js';

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
import { GetLocationSalesIntelligenceTool } from '../tools/GetLocationSalesIntelligenceTool.js';
import { CompareLocationSalesTool } from '../tools/CompareLocationSalesTool.js';
import { GetCatalogReadinessTool } from '../tools/GetCatalogReadinessTool.js';
import { GetInventoryStockStatusTool } from '../tools/GetInventoryStockStatusTool.js';
import { GetLaborVsSalesTool } from '../tools/GetLaborVsSalesTool.js';
import { GetWorkforceCoverageTool } from '../tools/GetWorkforceCoverageTool.js';

import { McpEndpointController } from '../web/routes/McpEndpointController.js';
import { SquareOAuthController } from '../web/routes/SquareOAuthController.js';
import { OAuthBrokerController } from '../web/routes/OAuthBrokerController.js';

const SERVER_NAME = 'SquareMCP-FranchiseRestaurantOps';
const SERVER_VERSION = '2.0.0';
// One-time proof of domain ownership for ChatGPT's connector registration - the token itself
// carries no privileges, so hardcoding it here (rather than Key Vault) is fine.
const OPENAI_APPS_CHALLENGE_TOKEN = 'q-r49akVYddSSv594SmSj8mMj_v37EZNOr4VnON20KU';
const SERVER_INSTRUCTIONS =
    'Square operations MCP server for franchise restaurants: live payroll, timecard, scheduling, sales, catalog, inventory, and workforce intelligence scoped per connected franchise owner. Read square://ops/operating-principles and square://ops/approval-policy when planning consequential work; live merchant data is available only through authenticated tools.';

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
        const entraOAuthService = new EntraOAuthService(keyVaultService);
        const brokerTokenSigner = new BrokerTokenSigner(keyVaultService);
        const oauthStateSigner = new OAuthStateSigner(keyVaultService);
        const previewTokenSigner = new PreviewTokenSigner(keyVaultService);
        const squareContextResolver = new SquareContextResolver(keyVaultService, squareOAuthService);

        const oauthBrokerController = new OAuthBrokerController({ config: this.#config, entraOAuthService, brokerTokenSigner, keyVaultService });
        const tokenVerifier = new McpTokenVerifier(brokerTokenSigner, {
            issuer: oauthBrokerController.issuer,
            audience: oauthBrokerController.mcpResourceUrl,
        });

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
            new GetLocationSalesIntelligenceTool(squareContextResolver),
            new CompareLocationSalesTool(squareContextResolver),
            new GetCatalogReadinessTool(squareContextResolver),
            new GetInventoryStockStatusTool(squareContextResolver),
            new GetLaborVsSalesTool(squareContextResolver),
            new GetWorkforceCoverageTool(squareContextResolver),
        ];

        // 'host: 0.0.0.0' disables createMcpExpressApp's built-in localhost-only default -
        // allowedHosts (which includes WEBSITE_HOSTNAME in Azure) takes over instead.
        const app = createMcpExpressApp({
            host: '0.0.0.0',
            allowedHosts: this.#config.allowedHosts,
            allowedOrigins: this.#config.allowedHosts,
        });

        app.get('/.well-known/openai-apps-challenge', (_req, res) => {
            res.type('text/plain').send(OPENAI_APPS_CHALLENGE_TOKEN);
        });

        // RFC 8414/9728 discovery documents ChatGPT's MCP client validates before it will register this
        // server - code_challenge_methods_supported must include S256, which Entra's own discovery
        // document does not reliably advertise, hence fronting Entra with this broker.
        app.use(
            mcpAuthMetadataRouter({
                resourceServerUrl: new URL(oauthBrokerController.mcpResourceUrl),
                oauthMetadata: {
                    issuer: oauthBrokerController.issuer,
                    authorization_endpoint: `${oauthBrokerController.issuer}/oauth/authorize`,
                    token_endpoint: `${oauthBrokerController.issuer}/oauth/token`,
                    jwks_uri: `${oauthBrokerController.issuer}/.well-known/jwks.json`,
                    response_types_supported: ['code'],
                    grant_types_supported: ['authorization_code'],
                    code_challenge_methods_supported: ['S256'],
                    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
                    scopes_supported: ['mcp.read', 'mcp.write'],
                },
            })
        );

        oauthBrokerController.registerRoutes(app);
        new SquareOAuthController({ config: this.#config, oauthStateSigner, squareOAuthService, keyVaultService }).registerRoutes(app);
        new McpEndpointController({
            serverName: SERVER_NAME,
            serverVersion: SERVER_VERSION,
            serverInstructions: SERVER_INSTRUCTIONS,
            tools,
            tokenVerifier,
            resourceServerUrl: new URL(oauthBrokerController.mcpResourceUrl),
        }).registerRoutes(app);

        return app;
    }

    start() {
        return this.#app.listen(this.#config.port, () => {
            console.log(`azapp-nodejs-mcp listening on port ${this.#config.port}`);
        });
    }
}
