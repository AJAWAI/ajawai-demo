import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { getConfig } from "./config";
import { getGmailConnectUrl, hasGmailConnection, sendEmailViaGmail } from "./gmail";

const config = getConfig();

const sendEmailBodySchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1)
});

const gmailWebhookSchema = z
  .object({
    message: z
      .object({
        data: z.string().optional(),
        messageId: z.string().optional(),
        publishTime: z.string().optional()
      })
      .optional(),
    subscription: z.string().optional()
  })
  .passthrough();

const app = Fastify({
  logger: {
    level: "info"
  }
});

await app.register(cors, {
  origin: true
});

app.get("/health", async () => {
  return {
    ok: true,
    service: "ajawai-relay",
    time: new Date().toISOString()
  };
});

app.get("/gmail/status", async () => {
  const connected = hasGmailConnection(config);
  return {
    connected,
    mode: connected ? "live" : "stub",
    detail: connected
      ? "Relay configured with Gmail credentials."
      : "Gmail credentials missing. Relay runs in stub mode."
  };
});

app.get("/gmail/connect-url", async (_request, reply) => {
  const connectUrl = getGmailConnectUrl(config);
  if (!connectUrl) {
    return reply.status(503).send({
      ok: false,
      error:
        "OAuth URL unavailable. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI."
    });
  }
  return {
    ok: true,
    connect_url: connectUrl
  };
});

app.post("/send/email", async (request, reply) => {
  const parsed = sendEmailBodySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({
      ok: false,
      error: "Invalid request body",
      issues: parsed.error.issues
    });
  }

  try {
    const result = await sendEmailViaGmail(config, parsed.data);
    return {
      ok: true,
      ...result
    };
  } catch (error) {
    request.log.error({ err: error }, "send email failed");
    return reply.status(500).send({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown send error"
    });
  }
});

app.post("/webhook/gmail", async (request, reply) => {
  const parsed = gmailWebhookSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({
      ok: false,
      error: "Invalid webhook payload",
      issues: parsed.error.issues
    });
  }

  request.log.info(
    { payload: parsed.data },
    "gmail webhook received"
  );

  return reply.status(202).send({
    ok: true,
    received: true
  });
});

const start = async () => {
  try {
    await app.listen({
      host: config.HOST,
      port: config.PORT
    });
    app.log.info(`Relay listening on http://${config.HOST}:${config.PORT}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

await start();
