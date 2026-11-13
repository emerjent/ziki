import { z } from "zod";

/**
 * What the credential vault accepts (docs/marketing-notes-and-vault.md).
 * Strict, so an unexpected field is refused instead of silently stored.
 */

export const CREDENTIAL_KINDS = ["wordpress_app_password", "api_token", "other"] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

const httpsUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => /^https:\/\/\S+$/i.test(value), "Enter a full https link.");

/** Patterns of things that must never be put in the vault: they open far more than one site. */
const FORBIDDEN_SECRETS: Array<{ test: RegExp; message: string }> = [
  {
    test: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    message: "That looks like a private key. Ziki never stores private keys. Create a limited token or app password instead.",
  },
  {
    // 12 or 24 lowercase words and nothing else: a wallet recovery phrase.
    test: /^(?:[a-z]{3,8}\s+){11}(?:[a-z]{3,8}\s*)$|^(?:[a-z]{3,8}\s+){23}(?:[a-z]{3,8}\s*)$/,
    message: "That looks like a wallet recovery phrase. Ziki never stores those.",
  },
];

export const createCredentialSchema = z
  .object({
    kind: z.enum(CREDENTIAL_KINDS, { error: "Choose what kind of credential this is." }),
    label: z.string().trim().min(1, "Give it a name.").max(80, "Keep the name to 80 characters or fewer."),
    serviceUrl: httpsUrl.optional(),
    secret: z
      .string()
      .min(8, "That is too short to be a token or app password.")
      .max(4096, "That is too long to be a token or app password.")
      .superRefine((value, ctx) => {
        for (const rule of FORBIDDEN_SECRETS) {
          if (rule.test.test(value.trim())) ctx.addIssue({ code: "custom", message: rule.message });
        }
      }),
  })
  .strict();

export type CreateCredentialInput = z.infer<typeof createCredentialSchema>;

export const grantCredentialSchema = z
  .object({
    bugId: z.string().trim().min(1).max(191),
    /** How long the agent may use it. Short by default. */
    hours: z.number().int().min(1).max(24 * 14).default(24),
  })
  .strict();

export const leaseCredentialSchema = z
  .object({
    bugId: z.string().trim().min(1, "bugId is required.").max(191),
  })
  .strict();
