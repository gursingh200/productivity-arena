/**
 * Who may sign in to this Arena instance. Each instance is self-hosted by one
 * group and configured with either or both of:
 *   ALLOWED_EMAIL_DOMAIN  a Google Workspace domain, e.g. "acme.com": any verified
 *                         account of that Workspace (Google's `hd` claim)
 *   ALLOWED_EMAILS        a comma-separated list of individual addresses, for
 *                         groups without a shared Workspace (friends, a club)
 * With neither set, nobody can sign in (fail closed).
 */
export interface AccessConfig {
  domain: string | null;
  emails: Set<string>;
}

export function accessConfig(env: Record<string, string | undefined> = process.env): AccessConfig {
  const domain = env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase() || null;
  const emails = new Set((env.ALLOWED_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
  return { domain, emails };
}

/** A Google sign-in: needs a verified email, plus the Workspace domain or a listed address. */
export function googleAllowed(config: AccessConfig, profile: { email?: string | null; email_verified?: boolean; hd?: string } | undefined): boolean {
  const email = profile?.email?.toLowerCase();
  if (!email || profile?.email_verified !== true) return false;
  if (config.emails.has(email)) return true;
  return config.domain !== null && profile.hd?.toLowerCase() === config.domain && email.endsWith(`@${config.domain}`);
}

/** The development-only email login: the domain or a listed address. */
export function devEmailAllowed(config: AccessConfig, email: string): boolean {
  const e = email.toLowerCase();
  return config.emails.has(e) || (config.domain !== null && e.endsWith(`@${config.domain}`));
}
