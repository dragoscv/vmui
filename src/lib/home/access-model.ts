// Client-safe half of the family access model: roles, room levels and the
// plain view handed to components. Server-side checks live in ./access.ts.
import type { RoomId } from "./catalog";

export const FAMILY_ROLES = ["owner", "adult", "child", "guest"] as const;
export type FamilyRole = (typeof FAMILY_ROLES)[number];
export const ROOM_LEVELS = ["view", "control"] as const;
export type RoomLevel = (typeof ROOM_LEVELS)[number];
export type RoomGrants = Partial<Record<RoomId, RoomLevel>>;

export type HomeAccessView = {
  role: FamilyRole;
  rooms: RoomGrants;
  canOpenDoor: boolean;
  canManage: boolean;
  canControlAny: boolean;
  userId: string;
  displayName: string;
};
