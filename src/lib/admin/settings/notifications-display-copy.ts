/**
 * Quiet Operator copy for notification route settings.
 * Missing channels or role targets name real gaps — never silent em dashes.
 */

export const NOTIFICATIONS_NO_CHANNELS_COPY = "No channels posted";
export const NOTIFICATIONS_NO_ROLE_TARGETS_COPY = "No roles posted";

/** Channels on a notification route when unset, empty, or posted. */
export function formatNotificationsChannelsDisplay(
  channels: string[] | null | undefined,
): string {
  if (channels == null || channels.length === 0) {
    return NOTIFICATIONS_NO_CHANNELS_COPY;
  }
  return channels.join(", ");
}

/** Staff role targets on a notification route when unset, empty, or posted. */
export function formatNotificationsRoleTargetsDisplay(
  staffRoleTargets: string[] | null | undefined,
): string {
  if (staffRoleTargets == null || staffRoleTargets.length === 0) {
    return NOTIFICATIONS_NO_ROLE_TARGETS_COPY;
  }
  return staffRoleTargets.join(", ");
}
