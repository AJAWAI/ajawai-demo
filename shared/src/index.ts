import { z } from "zod";

export const toolNameSchema = z.enum([
  "memory.save",
  "memory.search",
  "relay.send_email",
  "gmail.connect"
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

export const projectStatusSchema = z.enum([
  "planning",
  "active",
  "on_hold",
  "completed"
]);

export const taskStatusSchema = z.enum([
  "todo",
  "in_progress",
  "blocked",
  "done"
]);

export const taskPrioritySchema = z.enum([
  "low",
  "medium",
  "high"
]);

export const approvalStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected"
]);

export const profileSchema = z.object({
  id: z.string().min(1),
  user_id: z.string().min(1),
  full_name: z.string().default(""),
  company: z.string().default(""),
  role: z.string().default("President"),
  timezone: z.string().default("UTC"),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

export const projectSchema = z.object({
  id: z.string().min(1),
  owner_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  status: projectStatusSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

export const taskSchema = z.object({
  id: z.string().min(1),
  project_id: z.string().nullable(),
  title: z.string().min(1),
  description: z.string().default(""),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  requires_approval: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

export const contactSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  company: z.string().default(""),
  email: z.string().email(),
  phone: z.string().default(""),
  notes: z.string().default(""),
  project_id: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

export const noteSchema = z.object({
  id: z.string().min(1),
  user_id: z.string().min(1),
  title: z.string().min(1),
  content: z.string().min(1),
  project_id: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

export const approvalSchema = z.object({
  id: z.string().min(1),
  action_type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  status: approvalStatusSchema,
  created_at: z.string().datetime(),
  approved_at: z.string().datetime().nullable(),
  updated_at: z.string().datetime()
});

export const timelineSchema = z.object({
  id: z.string().min(1),
  event_type: z.string().min(1),
  description: z.string().min(1),
  project_id: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

export const phiIntentSchema = z.enum([
  "conversational",
  "translation_request",
  "status_query",
  "memory_save",
  "memory_recall",
  "task_request",
  "project_request",
  "note_request",
  "contact_request",
  "approval_request",
  "integration_request",
  "external_action_request",
  "general"
]);

export const phiResponseSchema = z.object({
  intent: phiIntentSchema,
  summary: z.string().min(1),
  response: z.string().min(1),
  requires_approval: z.boolean().default(false),
  project_name: z.string().optional(),
  task_title: z.string().optional(),
  note_title: z.string().optional(),
  note_content: z.string().optional(),
  contact_name: z.string().optional(),
  contact_email: z.string().optional(),
  action: z.string().optional(),
  email_to: z.array(z.string().email()).optional(),
  email_subject: z.string().optional(),
  email_body: z.string().optional(),
  needs_web_search: z.boolean().optional(),
  web_search_query: z.string().optional(),
  translation_target_language: z.string().optional(),
  translation_phrases: z.array(z.string()).optional(),
  memory_query: z.string().optional(),
  memory_key: z.string().optional(),
  memory_value: z.string().optional()
});

export type ToolName = z.infer<typeof toolNameSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type ToolResult = z.infer<typeof toolResultSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type JobStepStatus = z.infer<typeof jobStepStatusSchema>;
export type JobStep = z.infer<typeof jobStepSchema>;
export type Job = z.infer<typeof jobSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Contact = z.infer<typeof contactSchema>;
export type Note = z.infer<typeof noteSchema>;
export type Approval = z.infer<typeof approvalSchema>;
export type Timeline = z.infer<typeof timelineSchema>;
export type PhiIntent = z.infer<typeof phiIntentSchema>;
export type PhiResponse = z.infer<typeof phiResponseSchema>;
