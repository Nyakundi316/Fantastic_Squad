import { z } from "zod";
import { normalizePhone } from "@/lib/contact";

const trimmed = (max: number) => z.string().trim().max(max);

export const addressInputSchema = z.object({
  fullName: trimmed(120).min(2, "Enter the recipient's name."),
  phone: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const phone = normalizePhone(v);
      if (!phone) ctx.addIssue({ code: "custom", message: "Enter a valid phone number." });
      return phone ?? v;
    }),
  line1: trimmed(200).min(3, "Enter the street address."),
  line2: trimmed(200).optional().transform((v) => v || null),
  city: trimmed(80).min(2, "Enter the city or area."),
  state: trimmed(80).optional().transform((v) => v || null),
  postalCode: trimmed(20).optional().transform((v) => v || null),
  country: z.string().trim().length(2).default("NG"),
  isDefault: z.boolean().optional(),
});

export type AddressInput = z.infer<typeof addressInputSchema>;
