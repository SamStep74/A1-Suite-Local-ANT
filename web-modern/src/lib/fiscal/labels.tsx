/**
 * labels — i18n labels for the fiscal-gates surface.
 *
 * Why a separate file:
 *   Lingui's `t\`\`` macro has to be called from a TS/TSX source
 *   that the extractor walks. Centralising the message ids in one
 *   TSX file (and the matching `Trans` / `t` `` calls there) means
 *   the route stays free of `kind -> string` maps, and the i18n
 *   extractor only has to look in one place for fiscal copy.
 *
 *   This file is also where the route asks for a translated
 *   category label, status label, action label, etc. — all of
 *   which must round-trip through Lingui so the `hy` catalog grows
 *   from 37 to ~50 strings after W1.
 *
 * Patterns:
 *   - `gateLabel(kind)` and `gateDescription(kind)` look up the
 *     registry from `gates.ts` and return the translated string for
 *     that kind. `kind` is the stable `gate.kind` value (e.g.
 *     `"vat-monthly"`), not a display string.
 *   - The other helpers (`statusLabel`, `categoryLabel`,
 *     `actionLabel`) take the Zod-discriminated union member and
 *     return the matching `<Trans>`-extracted message.
 */
import { Trans, useLingui } from "@lingui/react/macro";
import {
  GateAction,
  GateCategory,
  GateStatus,
  type FiscalGate,
} from "./schemas";
import { GATE_DEFINITIONS, type GateDefinition } from "./gates";

/* ────────── gate kind labels (per definition) ────────── */

const findDef = (kind: string): GateDefinition | undefined =>
  GATE_DEFINITIONS.find((d) => d.kind === kind);

/** `<Trans>` JSX rendering of a gate label. Use this in column
 *  cells, table headers, and the bulk action bar. */
export const GateLabel = ({ kind }: { kind: string }) => {
  const def = findDef(kind);
  if (!def) return <Trans>Other</Trans>;
  // The labelKey doubles as the message id; we resolve it through
  // a small switch so Lingui can statically extract each id.
  switch (def.labelKey) {
    case "fiscal.gate.vat-monthly":
      return <Trans>VAT return (monthly)</Trans>;
    case "fiscal.gate.payroll-tax-monthly":
      return <Trans>Payroll tax (monthly)</Trans>;
    case "fiscal.gate.withholding-monthly":
      return <Trans>Withholding tax (monthly)</Trans>;
    case "fiscal.gate.social-contribution-monthly":
      return <Trans>Social contribution (monthly)</Trans>;
    case "fiscal.gate.pension-quarterly":
      return <Trans>Pension contribution (quarterly)</Trans>;
    case "fiscal.gate.statistical-monthly":
      return <Trans>Statistical return (monthly)</Trans>;
    case "fiscal.gate.excise-quarterly":
      return <Trans>Excise (quarterly)</Trans>;
    case "fiscal.gate.environmental-annual":
      return <Trans>Environmental fee (annual)</Trans>;
    case "fiscal.gate.customs-monthly":
      return <Trans>Customs declaration (monthly)</Trans>;
    case "fiscal.gate.income-tax-annual":
      return <Trans>Income tax (annual)</Trans>;
  }
  return <Trans>Other</Trans>;
};

/** `<Trans>` description for a gate kind (used in the peek / hover
 *  tooltip). */
export const GateDescription = ({ kind }: { kind: string }) => {
  const def = findDef(kind);
  if (!def) return <Trans>No description</Trans>;
  switch (def.descriptionKey) {
    case "fiscal.gate.vat-monthly.desc":
      return <Trans>File the monthly VAT return with the tax authority.</Trans>;
    case "fiscal.gate.payroll-tax-monthly.desc":
      return <Trans>Remit income tax withheld from employee salaries.</Trans>;
    case "fiscal.gate.withholding-monthly.desc":
      return <Trans>Remit tax withheld on payments to non-resident contractors.</Trans>;
    case "fiscal.gate.social-contribution-monthly.desc":
      return <Trans>Pay social-security contributions for the period.</Trans>;
    case "fiscal.gate.pension-quarterly.desc":
      return <Trans>Pay mandatory pension contributions for the quarter.</Trans>;
    case "fiscal.gate.statistical-monthly.desc":
      return <Trans>Submit the monthly statistical report to the statistical office.</Trans>;
    case "fiscal.gate.excise-quarterly.desc":
      return <Trans>File the quarterly excise return and remit the tax owed.</Trans>;
    case "fiscal.gate.environmental-annual.desc":
      return <Trans>Pay the annual environmental-protection fee.</Trans>;
    case "fiscal.gate.customs-monthly.desc":
      return <Trans>Submit the consolidated customs declaration for the month.</Trans>;
    case "fiscal.gate.income-tax-annual.desc":
      return <Trans>File the annual corporate income-tax return.</Trans>;
  }
  return <Trans>No description</Trans>;
};

/* ────────── status / category / action labels ────────── */

export const StatusLabel = ({ status }: { status: GateStatus }) => {
  switch (status) {
    case GateStatus.Pending:
      return <Trans>Pending</Trans>;
    case GateStatus.Acknowledged:
      return <Trans>Acknowledged</Trans>;
    case GateStatus.Filed:
      return <Trans>Filed</Trans>;
    case GateStatus.Overdue:
      return <Trans>Overdue</Trans>;
    case GateStatus.Escalated:
      return <Trans>Escalated</Trans>;
  }
};

export const CategoryLabel = ({ category }: { category: GateCategory }) => {
  switch (category) {
    case GateCategory.Vat:
      return <Trans>VAT</Trans>;
    case GateCategory.PayrollTax:
      return <Trans>Payroll tax</Trans>;
    case GateCategory.Withholding:
      return <Trans>Withholding</Trans>;
    case GateCategory.SocialContribution:
      return <Trans>Social contribution</Trans>;
    case GateCategory.Pension:
      return <Trans>Pension</Trans>;
    case GateCategory.Statistical:
      return <Trans>Statistical</Trans>;
    case GateCategory.Excise:
      return <Trans>Excise</Trans>;
    case GateCategory.Environmental:
      return <Trans>Environmental</Trans>;
    case GateCategory.Customs:
      return <Trans>Customs</Trans>;
    case GateCategory.Other:
      return <Trans>Other</Trans>;
  }
};

export const ActionLabel = ({ action }: { action: GateAction }) => {
  switch (action) {
    case GateAction.Acknowledge:
      return <Trans>Acknowledge</Trans>;
    case GateAction.MarkFiled:
      return <Trans>Mark filed</Trans>;
    case GateAction.Escalate:
      return <Trans>Escalate</Trans>;
  }
};

/* ────────── t``-string hooks for non-JSX call sites ────────── */

/** Hook variant for the `t\`\`` tagged template. Use this in the
 *  BulkActionBar button labels and any other call site that needs
 *  a string (not a JSX node). */
export const useFiscalLabels = () => {
  const { t } = useLingui();
  return {
    statusLabel: (status: GateStatus): string => {
      switch (status) {
        case GateStatus.Pending:
          return t`Pending`;
        case GateStatus.Acknowledged:
          return t`Acknowledged`;
        case GateStatus.Filed:
          return t`Filed`;
        case GateStatus.Overdue:
          return t`Overdue`;
        case GateStatus.Escalated:
          return t`Escalated`;
      }
    },
    categoryLabel: (category: GateCategory): string => {
      switch (category) {
        case GateCategory.Vat:
          return t`VAT`;
        case GateCategory.PayrollTax:
          return t`Payroll tax`;
        case GateCategory.Withholding:
          return t`Withholding`;
        case GateCategory.SocialContribution:
          return t`Social contribution`;
        case GateCategory.Pension:
          return t`Pension`;
        case GateCategory.Statistical:
          return t`Statistical`;
        case GateCategory.Excise:
          return t`Excise`;
        case GateCategory.Environmental:
          return t`Environmental`;
        case GateCategory.Customs:
          return t`Customs`;
        case GateCategory.Other:
          return t`Other`;
      }
    },
    actionLabel: (action: GateAction): string => {
      switch (action) {
        case GateAction.Acknowledge:
          return t`Acknowledge`;
        case GateAction.MarkFiled:
          return t`Mark filed`;
        case GateAction.Escalate:
          return t`Escalate`;
      }
    },
    gateKindLabel: (kind: string): string => {
      const def = findDef(kind);
      if (!def) return t`Other`;
      switch (def.labelKey) {
        case "fiscal.gate.vat-monthly":
          return t`VAT return (monthly)`;
        case "fiscal.gate.payroll-tax-monthly":
          return t`Payroll tax (monthly)`;
        case "fiscal.gate.withholding-monthly":
          return t`Withholding tax (monthly)`;
        case "fiscal.gate.social-contribution-monthly":
          return t`Social contribution (monthly)`;
        case "fiscal.gate.pension-quarterly":
          return t`Pension contribution (quarterly)`;
        case "fiscal.gate.statistical-monthly":
          return t`Statistical return (monthly)`;
        case "fiscal.gate.excise-quarterly":
          return t`Excise (quarterly)`;
        case "fiscal.gate.environmental-annual":
          return t`Environmental fee (annual)`;
        case "fiscal.gate.customs-monthly":
          return t`Customs declaration (monthly)`;
        case "fiscal.gate.income-tax-annual":
          return t`Income tax (annual)`;
      }
      return t`Other`;
    },
  };
};

/* ────────── row kind helper (used by the route's reducer) ────────── */

/** Stable description used by the route for screen-reader text and
 *  test snapshots. */
export const describeGate = (g: FiscalGate): string => `${g.kind}@${g.period}`;
