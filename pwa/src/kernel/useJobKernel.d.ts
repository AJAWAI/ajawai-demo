import type { ToolResult } from "@ajawai/shared";
import { type Contact, type TimelineEntry } from "../storage/db";
interface SendEmailInput {
    to: string;
    subject: string;
    body: string;
}
export declare const useJobKernel: () => {
    relayBaseUrl: any;
    jobs: {
        id: string;
        title: string;
        status: "queued" | "running" | "waiting_approval" | "completed" | "failed";
        createdAt: string;
        updatedAt: string;
        steps: {
            id: string;
            jobId: string;
            name: string;
            status: "queued" | "running" | "waiting_approval" | "completed" | "failed";
            startedAt?: string | undefined;
            completedAt?: string | undefined;
            toolCall?: {
                id: string;
                jobId: string;
                name: "memory.save" | "memory.search" | "relay.send_email";
                input: Record<string, unknown>;
                createdAt: string;
            } | undefined;
            toolResult?: {
                callId: string;
                ok: boolean;
                createdAt: string;
                output?: Record<string, unknown> | undefined;
                error?: string | undefined;
            } | undefined;
            error?: string | undefined;
        }[];
    }[];
    approvals: {
        id: string;
        jobId: string;
        toolCall: {
            id: string;
            jobId: string;
            name: "memory.save" | "memory.search" | "relay.send_email";
            input: Record<string, unknown>;
            createdAt: string;
        };
        reason: string;
        status: "pending" | "approved" | "rejected";
        createdAt: string;
        resolvedAt?: string | undefined;
    }[];
    timeline: TimelineEntry[];
    contacts: Contact[];
    memoryResults: {
        id: string;
        key: string;
        value: string;
    }[];
    createSendEmailJob: (input: SendEmailInput) => Promise<void>;
    addContact: (contact: Omit<Contact, "id" | "createdAt">) => Promise<void>;
    saveMemory: (key: string, value: string) => Promise<ToolResult>;
    searchMemory: (query: string) => Promise<ToolResult>;
    approveRequest: (requestId: string) => Promise<void>;
    rejectRequest: (requestId: string) => Promise<void>;
    clearLocalData: () => Promise<void>;
};
export {};
