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
  type LucideIcon,
} from "lucide-react";

export const APP_IDS = [
  "crm",
  "crm-tube",
  "finance",
  "copilot",
  "desk",
  "campaigns",
  "projects",
  "assets",
  "inventory",
  "purchase",
  "people",
  "docs",
  "analytics",
  "flow",
  "forms",
  "cfo",
  "fleet",
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
    labelAm: "Ավdelays",
    tagline: "Vehicles · drivers · trips · fuel · repairs · tires · cold chain",
    icon: Truck,
    accent: "teal",
    group: "ext",
    legacyMountId: "suite-app-fleet",
  },
};

export function appHref(id: AppId): string {
  return `/app/${id}`;
}
