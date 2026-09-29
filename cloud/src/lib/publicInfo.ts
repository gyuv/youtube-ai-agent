import { optionalEnv } from "./env";

/**
 * Links and operator details for the public Privacy Policy and Terms pages, which the YouTube API
 * Services Developer Policies require (and the API audit checks).
 */

export const YOUTUBE_TERMS_URL = "https://www.youtube.com/t/terms";
export const GOOGLE_PRIVACY_URL = "https://www.google.com/policies/privacy";
export const GOOGLE_PERMISSIONS_URL = "https://security.google.com/settings/security/permissions";
export const POLICIES_UPDATED = "29 September 2026";

export function publicOperator(): { name: string; email: string | null } {
  return {
    name: optionalEnv("PUBLIC_OPERATOR_NAME", "the operator of this Lumen Cloud studio"),
    email: optionalEnv("PUBLIC_CONTACT_EMAIL") ?? null,
  };
}
