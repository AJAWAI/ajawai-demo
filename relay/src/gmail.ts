import { google } from "googleapis";
import type { RelayConfig } from "./config";

export interface SendEmailPayload {
  to: string;
  subject: string;
  body: string;
}

export interface SendEmailResult {
  mode: "live" | "stub";
  accepted: boolean;
  id: string;
  detail: string;
}

const toBase64Url = (text: string): string => {
  return Buffer.from(text)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

const hasGmailCredentials = (config: RelayConfig): boolean => {
  return Boolean(
    config.GOOGLE_CLIENT_ID &&
      config.GOOGLE_CLIENT_SECRET &&
      config.GOOGLE_REFRESH_TOKEN &&
      config.GMAIL_SENDER
  );
};

export const sendEmailViaGmail = async (
  config: RelayConfig,
  payload: SendEmailPayload
): Promise<SendEmailResult> => {
  if (!hasGmailCredentials(config)) {
    return {
      mode: "stub",
      accepted: true,
      id: `stub-${crypto.randomUUID()}`,
      detail: "Gmail OAuth env vars missing; returned stub success for local demo."
    };
  }

  const oauth2Client = new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    refresh_token: config.GOOGLE_REFRESH_TOKEN
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const message = [
    `From: AJAWAI Demo <${config.GMAIL_SENDER}>`,
    `To: ${payload.to}`,
    `Subject: ${payload.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    payload.body
  ].join("\n");

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: toBase64Url(message)
    }
  });

  return {
    mode: "live",
    accepted: true,
    id: response.data.id ?? `gmail-${crypto.randomUUID()}`,
    detail: "Email sent via Gmail API."
  };
};
