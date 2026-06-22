/**
 * Centralized app/module catalog. Source of truth for:
 *   - App Launcher grid (Phase 0.4c)
 *   - LeftRail (Phase 0.4b)
 *   - /app/<id> route param validation
 *   - Today feed deep-links
 *
 * Mirrors web/src/suite-routes.js#SUITE_APP_IDS — keep in sync until sunset.
 */

import {
  Users,
  Calculator,
  Sparkles,
  Headphones,
  Megaphone,
  KanbanSquare,
  PackageSearch,
  ShoppingCart,
  UserCog,
  FolderOpen,
  BarChart3,
  Workflow,
  ClipboardList,
  TrendingUp,
  RadioTower,
  Boxes,
  Truck,
  Sprout,
  Building2,
  type LucideIcon,
} from "lucide-react";

export const APP_IDS = [
  "crm",
  "crm-tube",
  "smb-crm",
  "finance",
  "copilot",
  "desk",
  "campaigns",
  "projects",
  "assets",
  "inventory",
  "purchase",
  "pos",
  "people",
  "docs",
  "analytics",
  "flow",
  "forms",
  "cfo",
  "fleet",
  "greenhouse",
] as const;

export type AppId = (typeof APP_IDS)[number];

export interface AppMeta {
  id: AppId;
  /** Short English label for the topbar / launcher. */
  label: string;
  /** Armenian label (the legacy app is bilingual EN/AM). */
  labelAm: string;
  /** Tagline shown under the label in the App Launcher card. */
  tagline: string;
  /** lucide-react icon component. */
  icon: LucideIcon;
  /** Tint applied to the launcher card hover. 8-color palette name.
   *  Must match one of `--color-{teal|blue|violet|green|amber|ruby|orange|pink}`
   *  in tokens.css (the color-blind-safe palette: red→#c026d3 ruby, green→#0d9488 teal-shifted). */
  accent: "teal" | "blue" | "violet" | "green" | "amber" | "ruby" | "orange" | "pink";
  /** "core" apps appear first in the launcher; "ext" later. */
  group: "core" | "ext";
  /** Where the legacy Vite app currently mounts this app. */
  legacyMountId: string;
}

export const APPS: Record<AppId, AppMeta> = {
  crm: {
    id: "crm",
    label: "CRM",
    labelAm: "Հաճախորդներ",
    tagline: "Quotes · deals · activities",
    icon: Users,
    accent: "teal",
    group: "core",
    legacyMountId: "suite-app-crm",
  },
  "crm-tube": {
    id: "crm-tube",
    label: "Tube",
    labelAm: "Խողովակ",
    tagline: "Apollo · CloudTalk · 10 sovereign connectors",
    icon: RadioTower,
    accent: "violet",
    group: "ext",
    legacyMountId: "suite-app-crm-tube",
  },
  "smb-crm": {
    id: "smb-crm",
    label: "SMB CRM",
    labelAm: "Փոքր բիզնես",
    tagline: "AI blueprint · customers · deals · automations",
    icon: Building2,
    accent: "violet",
    group: "core",
    legacyMountId: "suite-app-smb-crm",
  },
  finance: {
    id: "finance",
    label: "Finance",
    labelAm: "Ֆինանսներ",
    tagline: "Invoices · ledger · taxes",
    icon: Calculator,
    accent: "blue",
    group: "core",
    legacyMountId: "suite-app-finance",
  },
  copilot: {
    id: "copilot",
    label: "Mission Control",
    labelAm: "Առաքելությունների կենտրոն",
    tagline: "Agents · approvals · audit",
    icon: Sparkles,
    accent: "violet",
    group: "core",
    legacyMountId: "suite-app-copilot",
  },
  desk: {
    id: "desk",
    label: "Desk",
    labelAm: "Աջակցություն",
    tagline: "Tickets · customer 360",
    icon: Headphones,
    accent: "amber",
    group: "core",
    legacyMountId: "suite-app-desk",
  },
  campaigns: {
    id: "campaigns",
    label: "Campaigns",
    labelAm: "Արշավներ",
    tagline: "Audience · send-time AI",
    icon: Megaphone,
    accent: "pink",
    group: "ext",
    legacyMountId: "suite-app-campaigns",
  },
  projects: {
    id: "projects",
    label: "Projects",
    labelAm: "Ծրագրեր",
    tagline: "Kanban · gantt · workflows",
    icon: KanbanSquare,
    accent: "teal",
    group: "ext",
    legacyMountId: "suite-app-projects",
  },
  assets: {
    id: "assets",
    label: "Assets",
    labelAm: "Հիմնական միջոցներ",
    tagline: "Fixed assets · depreciation · maintenance · assignment",
    icon: Boxes,
    accent: "amber",
    group: "ext",
    legacyMountId: "suite-app-assets",
  },
  inventory: {
    id: "inventory",
    label: "Inventory",
    labelAm: "Պահեստ",
    tagline: "Stock · reorder · cycle count",
    icon: PackageSearch,
    accent: "green",
    group: "ext",
    legacyMountId: "suite-app-inventory",
  },
  purchase: {
    id: "purchase",
    label: "Purchase",
    labelAm: "Գնումներ",
    tagline: "Vendors · 3-way match",
    icon: ShoppingCart,
    accent: "orange",
    group: "ext",
    legacyMountId: "suite-app-purchase",
  },
  pos: {
    id: "pos",
    label: "POS",
    labelAm: "Վաճառք",
    tagline: "Cash sessions · receipts · refunds",
    icon: ShoppingCart,
    accent: "ruby",
    group: "ext",
    legacyMountId: "suite-app-pos",
  },
  people: {
    id: "people",
    label: "People",
    labelAm: "Անձնակազմ",
    tagline: "HR · payroll · contracts",
    icon: UserCog,
    accent: "blue",
    group: "ext",
    legacyMountId: "suite-app-people",
  },
  docs: {
    id: "docs",
    label: "Docs",
    labelAm: "Փաստաթղթեր",
    tagline: "Cabinet · OCR · templates",
    icon: FolderOpen,
    accent: "teal",
    group: "ext",
    legacyMountId: "suite-app-docs",
  },
  analytics: {
    id: "analytics",
    label: "Analytics",
    labelAm: "Վերլուծություն",
    tagline: "Narrative dashboards",
    icon: BarChart3,
    accent: "violet",
    group: "ext",
    legacyMountId: "suite-app-analytics",
  },
  flow: {
    id: "flow",
    label: "Flow",
    labelAm: "Հոսքեր",
    tagline: "No-code workflow builder",
    icon: Workflow,
    accent: "blue",
    group: "ext",
    legacyMountId: "suite-app-flow",
  },
  forms: {
    id: "forms",
    label: "Forms",
    labelAm: "Ձևեր",
    tagline: "Lead capture · classification",
    icon: ClipboardList,
    accent: "amber",
    group: "ext",
    legacyMountId: "suite-app-forms",
  },
  cfo: {
    id: "cfo",
    label: "CFO",
    labelAm: "Ֆինանստնոր",
    tagline: "Cash flow · treasury · loans",
    icon: TrendingUp,
    accent: "green",
    group: "ext",
    legacyMountId: "suite-app-cfo",
  },
  fleet: {
    id: "fleet",
    label: "Fleet",
    labelAm: "Ավտոպառկ",
    tagline: "Vehicles · drivers · trips · fuel · repairs · tires · cold chain",
    icon: Truck,
    accent: "teal",
    group: "ext",
    legacyMountId: "suite-app-fleet",
  },
  greenhouse: {
    id: "greenhouse",
    label: "Greenhouse",
    labelAm: "Ջեռանոչհ",
    tagline: "Houses · zones · crops · climate · energy · bioprotection · harvest",
    icon: Sprout,
    accent: "green",
    group: "ext",
    legacyMountId: "suite-app-greenhouse",
  },
};

export function appHref(id: AppId): string {
  return `/app/${id}`;
}

/**
 * Build the TanStack Router `to` + `params` pair for a given app id.
 *
 * Every id in `APP_IDS` has a literal route file
 * (e.g. `src/routes/app/crm/index.tsx` → registered as `/app/crm/`).
 * Linking via `/app/$appId` (the catch-all) for these emits
 * `params.stringify`'s "Generated path matched literal route" warning
 * on every render, which floods the console and burns the main
 * thread — at ~19 apps × multiple Link components per page, that's
 * 100+ warnings on every navigation. Linking directly to the
 * literal route avoids both the warning and the per-call
 * route-match check.
 *
 * Unknown ids (e.g. a future app whose route file hasn't been
 * written yet) fall through to the dynamic catch-all so the
 * placeholder page at `/app/$appId.tsx` can render.
 */
/**
 * Build a TanStack Router `to` + `params` pair for a given app id.
 *
 * Every id in `APP_IDS` has a literal route file
 * (e.g. `src/routes/app/crm/index.tsx` → registered as `/app/crm`).
 * Linking via `/app/$appId` (the catch-all) for these emits
 * `params.stringify`'s "Generated path matched literal route" warning
 * on every render, which floods the console and burns the main
 * thread — at ~19 apps × multiple Link components per page, that's
 * 100+ warnings on every navigation. Linking directly to the
 * literal route avoids both the warning and the per-call
 * route-match check.
 *
 * Unknown ids (e.g. a future app whose route file hasn't been
 * written yet) fall through to the dynamic catch-all so the
 * placeholder page at `/app/$appId.tsx` can render.
 *
 * Cast: TanStack Router types `to` as a strict literal union of
 * registered route IDs; `\`/app/${id}\`` is too dynamic to express
 * in that union. The runtime uses the actual string value, which
 * IS a registered route (the literal index for `id`).
 */
export function appLinkTo(
  id: string,
): { to: "/app/$appId"; params: { appId: string } } {
  if ((APP_IDS as readonly string[]).includes(id)) {
    if (id === "copilot") {
      return { to: "/app/copilot" as unknown as "/app/$appId", params: { appId: id } };
    }
    return { to: `/app/${id}/` as unknown as "/app/$appId", params: { appId: id } };
  }
  return { to: "/app/$appId", params: { appId: id } };
}
