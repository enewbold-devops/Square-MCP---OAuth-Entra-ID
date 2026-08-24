// Registers concrete McpTool instances onto an McpServer, adapting the no-input-schema case where
// the SDK calls the handler with just (ctx) instead of (args, ctx). ctx is forwarded to tool.run()
// so McpTool can recover the caller's authenticated principal from ctx.http.authInfo.
export class ToolRegistry {
    static registerAll(mcpServer, tools) {
        for (const tool of tools) {
            const ToolClass = tool.constructor;
            const hasInputSchema = ToolClass.inputSchema !== undefined;
            const callback = hasInputSchema ? (args, ctx) => tool.run(args, ctx) : (ctx) => tool.run({}, ctx);

            mcpServer.registerTool(
                ToolClass.toolName,
                {
                    description: ToolClass.description,
                    inputSchema: ToolClass.inputSchema,
                    outputSchema: ToolClass.outputSchema,
                    annotations: ToolClass.annotations,
                },
                callback
            );
        }
    }
}
