import type { ToolCall, ToolResult } from "@ajawai/shared";
import { db } from "../storage/db";

const now = () => new Date().toISOString();

const asString = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
};

export interface ToolRegistry {
  runTool: (call: ToolCall) => Promise<ToolResult>;
}

export const createToolRegistry = (relayBaseUrl: string): ToolRegistry => {
  return {
    runTool: async (call) => {
      try {
        if (call.name === "memory.save") {
          const key = asString(call.input.key, "key");
          const value = asString(call.input.value, "value");
          await db.memory.put({
            id: crypto.randomUUID(),
            key,
            value,
            createdAt: now()
          });

          return {
            callId: call.id,
            ok: true,
            output: { saved: true, key },
            createdAt: now()
          };
        }

        if (call.name === "memory.search") {
          const query = asString(call.input.query, "query").toLowerCase();
          const rows = await db.memory.orderBy("createdAt").reverse().toArray();
          const matches = rows
            .filter((row) => {
              return (
                row.key.toLowerCase().includes(query) ||
                row.value.toLowerCase().includes(query)
              );
            })
            .slice(0, 10);

          return {
            callId: call.id,
            ok: true,
            output: { matches },
            createdAt: now()
          };
        }

        if (call.name === "relay.send_email") {
          const response = await fetch(`${relayBaseUrl}/send/email`, {
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: JSON.stringify(call.input)
          });

          if (!response.ok) {
            const text = await response.text();
            throw new Error(`Relay error (${response.status}): ${text}`);
          }

          const payload = (await response.json()) as Record<string, unknown>;
          return {
            callId: call.id,
            ok: true,
            output: payload,
            createdAt: now()
          };
        }

        throw new Error(`Unsupported tool: ${call.name as string}`);
      } catch (error) {
        return {
          callId: call.id,
          ok: false,
          error: error instanceof Error ? error.message : "Unknown tool error",
          createdAt: now()
        };
      }
    }
  };
};
