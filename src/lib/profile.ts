import { z } from "zod";

export const profileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  title: z.string().trim().max(100).optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  avatarUrl: z
    .string()
    .trim()
    .url("Avatar must be a valid URL")
    .refine((v) => /^https?:\/\//i.test(v), "Avatar must be an http(s) URL")
    .optional()
    .or(z.literal("")),
});

export type ProfileInput = z.infer<typeof profileSchema>;
