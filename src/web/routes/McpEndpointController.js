import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { ToolRegistry } from '../../tools/base/ToolRegistry.js';

// Stateless Streamable HTTP endpoint: a fresh transport per request, connected to the shared McpServer
// instance (the SDK's own documented pattern for stateless hosting). Gated by the Easy Auth principal
// middleware, which reads the identity Azure App Service Authentication already verified and attaches
// it to req.auth - the transport forwards it through as ctx.http.authInfo for every tool call.
export class McpEndpointController {
    #mcpServer;
    #authMiddleware;

    constructor({ serverName, serverVersion, serverInstructions, tools, authMiddleware }) {
        this.#mcpServer = new McpServer({ name: serverName, version: serverVersion, instructions: serverInstructions });
        this.#authMiddleware = authMiddleware;
        ToolRegistry.registerAll(this.#mcpServer, tools);
    }

    registerRoutes(app) {
        app.post('/mcp', this.#authMiddleware, (req, res) => this.#handle(req, res));
    }

    async #handle(req, res) {
        try {
            const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
            await this.#mcpServer.connect(transport);
            await transport.handleRequest(req, res, req.body);
        } catch (error) {
            console.error('MCP request handling failed:', error.message);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Internal server error.' });
            }
        }
    }
}
