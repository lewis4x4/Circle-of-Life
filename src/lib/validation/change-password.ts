import { z } from "zod";

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, "Current password is required"),
    new_password: z.string().min(8, "Password must be at least 8 characters"),
    confirm_password: z.string().min(1, "Confirm your new password"),
  })
  .superRefine((data, ctx) => {
    if (data.new_password !== data.confirm_password) {
      ctx.addIssue({
        code: "custom",
        message: "New password and confirmation must match",
        path: ["confirm_password"],
      });
    }
    if (data.new_password === data.current_password) {
      ctx.addIssue({
        code: "custom",
        message: "New password must be different from your current password",
        path: ["new_password"],
      });
    }
  });

export type ChangePasswordBody = z.infer<typeof changePasswordSchema>;
