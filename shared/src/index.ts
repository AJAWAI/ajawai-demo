import { z } from "zod";

export const toolNameSchema = z.enum([
  "memory.save",
  "memory.search",
  "relay.send_email"
]);

export const toolCallSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  name: toolNameSchema,
  input: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime()
});

export const toolResultSchema = z.object({
  callId: z.string().min(1),
  ok: z.boolean(),
  output: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
  createdAt: z.string().datetime()
});

export const jobStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_approval",
  "completed",
  "failed"
]);

export const jobStepStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_approval",
  "completed",
  "failed"
]);

export const jobStepSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  name: z.string().min(1),
  status: jobStepStatusSchema,
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  toolCall: toolCallSchema.optional(),
  toolResult: toolResultSchema.optional(),
  error: z.string().optional()
});

export const jobSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: jobStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  steps: z.array(jobStepSchema)
});

export const approvalRequestStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected"
]);

export const approvalRequestSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  toolCall: toolCallSchema,
  reason: z.string().min(1),
  status: approvalRequestStatusSchema,
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional()
});

export type ToolName = z.infer<typeof toolNameSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type ToolResult = z.infer<typeof toolResultSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type JobStepStatus = z.infer<typeof jobStepStatusSchema>;
export type JobStep = z.infer<typeof jobStepSchema>;
export type Job = z.infer<typeof jobSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
