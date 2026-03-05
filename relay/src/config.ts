import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default("0.0.0.0"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
  GMAIL_SENDER: z.string().email().optional()
});

export type RelayConfig = z.infer<typeof envSchema>;

export const getConfig = (): RelayConfig => {
  return envSchema.parse(process.env);
};
