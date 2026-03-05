import type { ToolCall, ToolResult } from "@ajawai/shared";
export interface ToolRegistry {
    runTool: (call: ToolCall) => Promise<ToolResult>;
}
export declare const createToolRegistry: (relayBaseUrl: string) => ToolRegistry;
