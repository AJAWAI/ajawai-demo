import { z } from "zod";
export declare const toolNameSchema: z.ZodEnum<{
    "memory.save": "memory.save";
    "memory.search": "memory.search";
    "relay.send_email": "relay.send_email";
}>;
export declare const toolCallSchema: z.ZodObject<{
    id: z.ZodString;
    jobId: z.ZodString;
    name: z.ZodEnum<{
        "memory.save": "memory.save";
        "memory.search": "memory.search";
        "relay.send_email": "relay.send_email";
    }>;
    input: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    createdAt: z.ZodString;
}, z.core.$strip>;
export declare const toolResultSchema: z.ZodObject<{
    callId: z.ZodString;
    ok: z.ZodBoolean;
    output: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    error: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodString;
}, z.core.$strip>;
export declare const jobStatusSchema: z.ZodEnum<{
    queued: "queued";
    running: "running";
    waiting_approval: "waiting_approval";
    completed: "completed";
    failed: "failed";
}>;
export declare const jobStepStatusSchema: z.ZodEnum<{
    queued: "queued";
    running: "running";
    waiting_approval: "waiting_approval";
    completed: "completed";
    failed: "failed";
}>;
export declare const jobStepSchema: z.ZodObject<{
    id: z.ZodString;
    jobId: z.ZodString;
    name: z.ZodString;
    status: z.ZodEnum<{
        queued: "queued";
        running: "running";
        waiting_approval: "waiting_approval";
        completed: "completed";
        failed: "failed";
    }>;
    startedAt: z.ZodOptional<z.ZodString>;
    completedAt: z.ZodOptional<z.ZodString>;
    toolCall: z.ZodOptional<z.ZodObject<{
        id: z.ZodString;
        jobId: z.ZodString;
        name: z.ZodEnum<{
            "memory.save": "memory.save";
            "memory.search": "memory.search";
            "relay.send_email": "relay.send_email";
        }>;
        input: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        createdAt: z.ZodString;
    }, z.core.$strip>>;
    toolResult: z.ZodOptional<z.ZodObject<{
        callId: z.ZodString;
        ok: z.ZodBoolean;
        output: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        error: z.ZodOptional<z.ZodString>;
        createdAt: z.ZodString;
    }, z.core.$strip>>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const jobSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    status: z.ZodEnum<{
        queued: "queued";
        running: "running";
        waiting_approval: "waiting_approval";
        completed: "completed";
        failed: "failed";
    }>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    steps: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        jobId: z.ZodString;
        name: z.ZodString;
        status: z.ZodEnum<{
            queued: "queued";
            running: "running";
            waiting_approval: "waiting_approval";
            completed: "completed";
            failed: "failed";
        }>;
        startedAt: z.ZodOptional<z.ZodString>;
        completedAt: z.ZodOptional<z.ZodString>;
        toolCall: z.ZodOptional<z.ZodObject<{
            id: z.ZodString;
            jobId: z.ZodString;
            name: z.ZodEnum<{
                "memory.save": "memory.save";
                "memory.search": "memory.search";
                "relay.send_email": "relay.send_email";
            }>;
            input: z.ZodRecord<z.ZodString, z.ZodUnknown>;
            createdAt: z.ZodString;
        }, z.core.$strip>>;
        toolResult: z.ZodOptional<z.ZodObject<{
            callId: z.ZodString;
            ok: z.ZodBoolean;
            output: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            error: z.ZodOptional<z.ZodString>;
            createdAt: z.ZodString;
        }, z.core.$strip>>;
        error: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const approvalRequestStatusSchema: z.ZodEnum<{
    pending: "pending";
    approved: "approved";
    rejected: "rejected";
}>;
export declare const approvalRequestSchema: z.ZodObject<{
    id: z.ZodString;
    jobId: z.ZodString;
    toolCall: z.ZodObject<{
        id: z.ZodString;
        jobId: z.ZodString;
        name: z.ZodEnum<{
            "memory.save": "memory.save";
            "memory.search": "memory.search";
            "relay.send_email": "relay.send_email";
        }>;
        input: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        createdAt: z.ZodString;
    }, z.core.$strip>;
    reason: z.ZodString;
    status: z.ZodEnum<{
        pending: "pending";
        approved: "approved";
        rejected: "rejected";
    }>;
    createdAt: z.ZodString;
    resolvedAt: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ToolName = z.infer<typeof toolNameSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type ToolResult = z.infer<typeof toolResultSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type JobStepStatus = z.infer<typeof jobStepStatusSchema>;
export type JobStep = z.infer<typeof jobStepSchema>;
export type Job = z.infer<typeof jobSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
