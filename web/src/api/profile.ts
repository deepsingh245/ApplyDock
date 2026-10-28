import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { keys } from "./state";

export type ProfileKind = "personal" | "experience" | "project" | "skill" | "achievement" | "education" | "certification";
export type Verification = "verified" | "unverified" | "needs_review";

export interface Claim {
  id?: string;
  text: string;
  verified: boolean;
}

/** Field values vary by kind (see features/profile/fields.ts); the helper validates and cleans them. */
export type ProfileData = Record<string, unknown>;

export interface ProfileItem {
  id: string;
  kind: ProfileKind;
  data: ProfileData;
  label: string;
  verification: Verification;
  archived: boolean;
  revision: number;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface LinkCheck {
  url: string;
  status: string;
  http_status?: number | null;
  final_url?: string;
  detail?: string;
  checked_at?: string;
}

export interface Profile {
  personal: ProfileItem;
  items: ProfileItem[];
  link_checks: Record<string, Record<string, LinkCheck>>;
  project_usage: Record<string, { name: string; [key: string]: unknown }[]>;
  counts: Partial<Record<ProfileKind, number>>;
}

export interface LinkResult extends LinkCheck {
  item_id: string;
  field: string;
}

export function useProfile() {
  return useQuery({ queryKey: keys.profile, queryFn: () => api<{ profile: Profile }>("/api/profile").then((result) => result.profile) });
}

/**
 * Every profile write answers with the whole updated profile; storing it avoids a second request and keeps the
 * screen in step with what the helper saved.
 */
export function useProfileWrite() {
  const client = useQueryClient();
  return useCallback(
    async <T extends { profile?: Profile }>(request: Promise<T>): Promise<T> => {
      const response = await request;
      if (response.profile) client.setQueryData(keys.profile, response.profile);
      return response;
    },
    [client],
  );
}

export function useReloadProfile() {
  const client = useQueryClient();
  return useCallback(() => client.invalidateQueries({ queryKey: keys.profile }), [client]);
}

export const profileApi = {
  savePersonal: (data: ProfileData, expectedRevision?: number) =>
    api<{ profile: Profile }>("/api/profile/personal", "PATCH", { data, expected_revision: expectedRevision }),
  createItem: (kind: ProfileKind, data: ProfileData, verification: Verification) =>
    api<{ item: ProfileItem; profile: Profile }>("/api/profile/items", "POST", { kind, data, verification }),
  updateItem: (id: string, changes: { data?: ProfileData; verification?: Verification; archived?: boolean; expected_revision?: number }) =>
    api<{ item: ProfileItem; profile: Profile }>(`/api/profile/items/${id}`, "PATCH", changes),
  deleteItem: (id: string) => api<{ profile: Profile }>(`/api/profile/items/${id}`, "DELETE"),
  importFromResume: (resumeId: string, verified: boolean) =>
    api<{ added: Record<string, number>; profile: Profile }>("/api/profile/import", "POST", { resume_id: resumeId, verified }),
  verifyLinks: (itemId?: string) => api<{ results: LinkResult[]; profile: Profile }>("/api/profile/verify-links", "POST", itemId ? { item_id: itemId } : {}),
};
