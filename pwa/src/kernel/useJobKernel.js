import { useCallback, useEffect, useMemo, useState } from "react";
import { createToolRegistry } from "./toolRegistry";
import { db } from "../storage/db";
const now = () => new Date().toISOString();
const relayBaseUrl = import.meta.env.VITE_RELAY_BASE_URL ?? "http://localhost:8787";
const createToolCall = (jobId, name, input) => {
    return {
        id: crypto.randomUUID(),
        jobId,
        name,
        input,
        createdAt: now()
    };
};
export const useJobKernel = () => {
    const [jobs, setJobs] = useState([]);
    const [approvals, setApprovals] = useState([]);
    const [timeline, setTimeline] = useState([]);
    const [contacts, setContacts] = useState([]);
    const [memoryResults, setMemoryResults] = useState([]);
    const toolRegistry = useMemo(() => createToolRegistry(relayBaseUrl), []);
    const appendTimeline = useCallback(async (entry) => {
        await db.timeline.put(entry);
        const rows = await db.timeline.orderBy("createdAt").reverse().toArray();
        setTimeline(rows);
    }, []);
    const refreshContacts = useCallback(async () => {
        const rows = await db.contacts.orderBy("createdAt").reverse().toArray();
        setContacts(rows);
    }, []);
    const refreshTimeline = useCallback(async () => {
        const rows = await db.timeline.orderBy("createdAt").reverse().toArray();
        setTimeline(rows);
    }, []);
    useEffect(() => {
        void refreshContacts();
        void refreshTimeline();
    }, [refreshContacts, refreshTimeline]);
    const createSendEmailJob = useCallback(async (input) => {
        const jobId = crypto.randomUUID();
        const toolCall = createToolCall(jobId, "relay.send_email", {
            ...input
        });
        const stepCollectInput = {
            id: crypto.randomUUID(),
            jobId,
            name: "collect_input",
            status: "completed",
            startedAt: now(),
            completedAt: now()
        };
        const stepSendEmail = {
            id: crypto.randomUUID(),
            jobId,
            name: "send_email",
            status: "waiting_approval",
            toolCall,
            startedAt: now()
        };
        const job = {
            id: jobId,
            title: `Send email to ${input.to}`,
            status: "waiting_approval",
            createdAt: now(),
            updatedAt: now(),
            steps: [stepCollectInput, stepSendEmail]
        };
        const approvalRequest = {
            id: crypto.randomUUID(),
            jobId,
            toolCall,
            reason: "Sending email requires explicit user approval.",
            status: "pending",
            createdAt: now()
        };
        setJobs((previous) => [job, ...previous]);
        setApprovals((previous) => [approvalRequest, ...previous]);
        await appendTimeline({
            id: crypto.randomUUID(),
            jobId,
            kind: "approval",
            message: `Approval requested for send_email (${input.to})`,
            createdAt: now()
        });
    }, [appendTimeline]);
    const addContact = useCallback(async (contact) => {
        await db.contacts.put({
            id: crypto.randomUUID(),
            createdAt: now(),
            ...contact
        });
        await refreshContacts();
        await appendTimeline({
            id: crypto.randomUUID(),
            kind: "info",
            message: `Contact saved: ${contact.name}`,
            createdAt: now()
        });
    }, [appendTimeline, refreshContacts]);
    const saveMemory = useCallback(async (key, value) => {
        const call = createToolCall("memory-job", "memory.save", { key, value });
        const result = await toolRegistry.runTool(call);
        await appendTimeline({
            id: crypto.randomUUID(),
            kind: result.ok ? "tool" : "error",
            message: result.ok
                ? `Memory saved (${key})`
                : `Memory save failed: ${result.error ?? "unknown error"}`,
            createdAt: now()
        });
        return result;
    }, [appendTimeline, toolRegistry]);
    const searchMemory = useCallback(async (query) => {
        const call = createToolCall("memory-job", "memory.search", { query });
        const result = await toolRegistry.runTool(call);
        if (result.ok) {
            const matches = result.output?.matches ?? [];
            setMemoryResults(matches);
        }
        else {
            setMemoryResults([]);
        }
        await appendTimeline({
            id: crypto.randomUUID(),
            kind: result.ok ? "tool" : "error",
            message: result.ok
                ? `Memory searched (${query})`
                : `Memory search failed: ${result.error ?? "unknown error"}`,
            createdAt: now()
        });
        return result;
    }, [appendTimeline, toolRegistry]);
    const approveRequest = useCallback(async (requestId) => {
        const request = approvals.find((item) => item.id === requestId && item.status === "pending");
        if (!request) {
            return;
        }
        setApprovals((previous) => previous.map((item) => item.id === requestId
            ? { ...item, status: "approved", resolvedAt: now() }
            : item));
        setJobs((previous) => previous.map((job) => {
            if (job.id !== request.jobId) {
                return job;
            }
            return {
                ...job,
                status: "running",
                updatedAt: now(),
                steps: job.steps.map((step) => {
                    if (step.toolCall?.id !== request.toolCall.id) {
                        return step;
                    }
                    return {
                        ...step,
                        status: "running",
                        startedAt: now()
                    };
                })
            };
        }));
        await appendTimeline({
            id: crypto.randomUUID(),
            jobId: request.jobId,
            kind: "approval",
            message: `Approval granted for ${request.toolCall.name}`,
            createdAt: now()
        });
        const result = await toolRegistry.runTool(request.toolCall);
        const finalStepStatus = result.ok ? "completed" : "failed";
        const finalJobStatus = result.ok ? "completed" : "failed";
        setJobs((previous) => previous.map((job) => {
            if (job.id !== request.jobId) {
                return job;
            }
            const updatedSteps = job.steps.map((step) => {
                if (step.toolCall?.id !== request.toolCall.id) {
                    return step;
                }
                return {
                    ...step,
                    status: finalStepStatus,
                    completedAt: now(),
                    toolResult: result,
                    error: result.error
                };
            });
            return {
                ...job,
                status: finalJobStatus,
                updatedAt: now(),
                steps: updatedSteps
            };
        }));
        await appendTimeline({
            id: crypto.randomUUID(),
            jobId: request.jobId,
            kind: result.ok ? "tool" : "error",
            message: result.ok
                ? `Tool executed: ${request.toolCall.name}`
                : `Tool failed: ${request.toolCall.name} (${result.error ?? "unknown"})`,
            createdAt: now()
        });
    }, [appendTimeline, approvals, toolRegistry]);
    const rejectRequest = useCallback(async (requestId) => {
        const request = approvals.find((item) => item.id === requestId && item.status === "pending");
        if (!request) {
            return;
        }
        setApprovals((previous) => previous.map((item) => item.id === requestId
            ? { ...item, status: "rejected", resolvedAt: now() }
            : item));
        setJobs((previous) => previous.map((job) => {
            if (job.id !== request.jobId) {
                return job;
            }
            return {
                ...job,
                status: "failed",
                updatedAt: now(),
                steps: job.steps.map((step) => {
                    if (step.toolCall?.id !== request.toolCall.id) {
                        return step;
                    }
                    return {
                        ...step,
                        status: "failed",
                        completedAt: now(),
                        error: "User rejected approval request."
                    };
                })
            };
        }));
        await appendTimeline({
            id: crypto.randomUUID(),
            jobId: request.jobId,
            kind: "approval",
            message: `Approval rejected for ${request.toolCall.name}`,
            createdAt: now()
        });
    }, [appendTimeline, approvals]);
    const clearLocalData = useCallback(async () => {
        await db.contacts.clear();
        await db.timeline.clear();
        await db.memory.clear();
        setTimeline([]);
        setContacts([]);
        setMemoryResults([]);
    }, []);
    return {
        relayBaseUrl,
        jobs,
        approvals,
        timeline,
        contacts,
        memoryResults,
        createSendEmailJob,
        addContact,
        saveMemory,
        searchMemory,
        approveRequest,
        rejectRequest,
        clearLocalData
    };
};
