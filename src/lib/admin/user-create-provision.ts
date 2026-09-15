/**
 * Auth provisioning for POST /api/admin/users — keeps invite vs temp-password honest.
 */

import {
  adminCreateUser,
  adminFindAuthUserByEmail,
  adminInviteUser,
  adminSendPasswordResetEmail,
  adminSetUserSignInReadyWithTemporaryPassword,
  adminUpdateUserAccessMetadata,
} from "@/lib/supabase/admin-client";

export type UserCreateProvisionMethod =
  | "invite_email"
  | "temporary_password"
  | "password_reset_email";

export type UserCreateProvisionResult = {
  userId: string;
  invitation_sent: boolean;
  provision_method: UserCreateProvisionMethod;
  temporary_password?: string;
};

export class UserCreateProvisionError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function provisionAuthUserForAdminCreate(input: {
  email: string;
  app_role: string;
  organization_id: string;
  send_invite: boolean;
}): Promise<UserCreateProvisionResult> {
  const existing = await adminFindAuthUserByEmail(input.email);

  if (!existing) {
    if (input.send_invite) {
      const invited = await adminInviteUser(input.email, {
        app_role: input.app_role,
        organization_id: input.organization_id,
      });
      return {
        userId: invited.id,
        invitation_sent: true,
        provision_method: "invite_email",
      };
    }

    const created = await adminCreateUser(input.email, {
      app_role: input.app_role,
      organization_id: input.organization_id,
      email_confirm: true,
    });
    return {
      userId: created.user.id,
      invitation_sent: false,
      provision_method: "temporary_password",
      temporary_password: created.temporary_password,
    };
  }

  await adminUpdateUserAccessMetadata(existing.id, {
    app_role: input.app_role,
    organization_id: input.organization_id,
  });

  const emailConfirmed = Boolean(existing.email_confirmed_at);
  const hasSignedIn = Boolean(existing.last_sign_in_at);

  if (!input.send_invite) {
    const { temporary_password } = await adminSetUserSignInReadyWithTemporaryPassword(existing.id);
    return {
      userId: existing.id,
      invitation_sent: false,
      provision_method: "temporary_password",
      temporary_password,
    };
  }

  // send_invite: never claim an invite was sent unless we actually dispatched email.
  if (!emailConfirmed || !hasSignedIn) {
    const { temporary_password } = await adminSetUserSignInReadyWithTemporaryPassword(existing.id);
    return {
      userId: existing.id,
      invitation_sent: false,
      provision_method: "temporary_password",
      temporary_password,
    };
  }

  await adminSendPasswordResetEmail(input.email);
  return {
    userId: existing.id,
    invitation_sent: true,
    provision_method: "password_reset_email",
  };
}
