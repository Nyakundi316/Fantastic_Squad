import { z } from "zod";

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  CURRENCY: z.string().length(3).default("NGN"),

  SMS_PROVIDER: z.enum(["console", "termii", "twilio"]).default("console"),
  TERMII_API_KEY: optionalString,
  TERMII_SENDER_ID: z.string().default("FZone"),
  TWILIO_ACCOUNT_SID: optionalString,
  TWILIO_AUTH_TOKEN: optionalString,
  TWILIO_FROM: optionalString,

  EMAIL_PROVIDER: z.enum(["console", "resend"]).default("console"),
  RESEND_API_KEY: optionalString,
  EMAIL_FROM: z.string().default("FANTASTICZONE <hello@fantasticzone.ng>"),

  // console | cloud (WhatsApp Cloud API). Business-initiated messages must use Meta-approved
  // templates named like our template keys; "text" mode only works inside a 24h customer window.
  WHATSAPP_PROVIDER: z.enum(["console", "cloud"]).default("console"),
  WHATSAPP_MODE: z.enum(["template", "text"]).default("template"),
  WHATSAPP_TOKEN: optionalString,
  WHATSAPP_PHONE_NUMBER_ID: optionalString,
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().default("en"),

  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>".
  CRON_SECRET: optionalString,

  // Card payments. Without a secret key the app falls back to bank transfer + manual mark-paid.
  PAYSTACK_SECRET_KEY: optionalString,
  PAYSTACK_BASE_URL: z.string().url().default("https://api.paystack.co"),

  // Shown on unpaid invoices as the bank transfer option.
  BANK_NAME: optionalString,
  BANK_ACCOUNT_NAME: optionalString,
  BANK_ACCOUNT_NUMBER: optionalString,

  OTP_DEV_CODE: optionalString.pipe(z.string().regex(/^\d{6}$/).optional()),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let parsed: ServerEnv | undefined;

/** Validated server env. Parsed on first use so `next build` works without secrets. */
export function env(): ServerEnv {
  parsed ??= serverEnvSchema.parse(process.env);
  return parsed;
}
