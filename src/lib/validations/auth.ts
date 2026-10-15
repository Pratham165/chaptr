import { z } from "zod";

/**
 * Bcrypt silently truncates/ignores bytes past 72.
 * Password validation rules:
 * - Login: non-empty, maximum 72 BYTES (does not enforce minimum 10 to avoid locking out existing users)
 * - Registration: minimum 10 characters, maximum 72 BYTES
 */
export const loginPasswordSchema = z
  .string()
  .min(1, "Password is required")
  .refine(
    (pwd) => Buffer.byteLength(pwd, "utf-8") <= 72,
    "Password cannot exceed 72 bytes"
  );

export const registerPasswordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters long")
  .refine(
    (pwd) => Buffer.byteLength(pwd, "utf-8") <= 72,
    "Password cannot exceed 72 bytes"
  );

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email address"),
  password: loginPasswordSchema,
});

export const registerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters long")
      .max(60, "Name cannot exceed 60 characters"),
    email: z.string().trim().toLowerCase().email("Invalid email address"),
    password: registerPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
