/**
 * useUserAccess — app-tier access gate.
 *
 * Pattern: the route file calls `useUserAccess("fleet")` and renders a
 * 403 panel when the returned `hasAccess` is false. Mirrors the role-
 * based gate in `assets/index.tsx` (which uses `isAssetsRoleAllowed`),
 * but lifted one level: instead of taking a role, the hook takes the
 * app id and returns a boolean.
 *
 * Auth is not wired yet (see CLAUDE.md / Phase 8.4 roadmap) — the
 * hook defaults to permissive (returns `true`) when no auth context
 * is provided. The test wraps the component in
 * `<FleetAccessContext.Provider value={false}>` to exercise the
 * 403 branch.
 *
 * The legacy app's `useAppAccess` (web/src/main.jsx#useAppAccess)
 * behaves the same way: it consults the audit context and falls
 * back to permissive when no audit info is present.
 */
import { createContext, useContext } from "react";

/** App ids that this gate knows about. Mirrors APP_IDS in
 *  web-modern/src/lib/apps.ts. */
export type GateableAppId =
  | "crm"
  | "crm-tube"
  | "finance"
  | "copilot"
  | "desk"
  | "campaigns"
  | "projects"
  | "assets"
  | "inventory"
  | "purchase"
  | "people"
  | "docs"
  | "analytics"
  | "flow"
  | "forms"
  | "cfo"
  | "fleet"
  | "greenhouse";

/** Per-app access map: app id → does the current user have access?
 *  Default value (`undefined`) → permissive. */
export type UserAccessMap = Partial<Record<GateableAppId, boolean>>;

const DEFAULT_ACCESS: UserAccessMap = {
  // Default-on apps: most users can see Today + the public apps.
  crm: true,
  "crm-tube": true,
  finance: true,
  copilot: true,
  desk: true,
  campaigns: true,
  projects: true,
  assets: true,
  inventory: true,
  purchase: true,
  people: true,
  docs: true,
  analytics: true,
  flow: true,
  forms: true,
  cfo: true,
  fleet: true,
  greenhouse: true,
};

const UserAccessContext = createContext<UserAccessMap>(DEFAULT_ACCESS);

/** Provider — mounted at the app root (or in tests) to inject an
 *  access map. The map is partial: any unspecified app id falls
 *  through to `true` (permissive). */
export function UserAccessProvider({
  value,
  children,
}: {
  value?: UserAccessMap;
  children: React.ReactNode;
}) {
  return (
    <UserAccessContext.Provider value={value ?? DEFAULT_ACCESS}>
      {children}
    </UserAccessContext.Provider>
  );
}

/**
 * Returns whether the current user has access to the given app id.
 * Defaults to `true` when the app id is not in the access map (the
 * user is allowed to see it).
 */
export function useUserAccess(appId: GateableAppId): boolean {
  const access = useContext(UserAccessContext);
  if (access == null) return true;
  const explicit = access[appId];
  if (explicit === undefined) return true;
  return explicit;
}
