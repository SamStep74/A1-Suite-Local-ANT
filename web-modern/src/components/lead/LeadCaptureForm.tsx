/**
 * LeadCaptureForm — inline form for POST /api/crm/leads.
 *
 * Used on /app/crm/leads for both the standalone "New lead" sheet and
 * the page-level add form. The backend computes a score + rating from
 * the input — the form just collects the basics.
 *
 * On success, the parent can either close the sheet or reset for the
 * next entry. We invalidate the `["crm-leads"]` query key so the list
 * refreshes.
 */

import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { postJson } from "../../lib/api/client";
import {
  CrmLeadSchema,
  CreateCrmLeadInputSchema,
  type CrmLead,
  type CreateCrmLeadInput,
} from "../../lib/api/schemas";
import { Button } from "../ui/Button";
import { cn } from "../../lib/utils/cn";

const SEGMENTS = ["retail", "wholesale", "enterprise", "government"] as const;
const SOURCES = ["Website", "Referral", "Cold outreach", "Event", "Partner"] as const;
const CHANNELS = ["Email", "Phone", "WhatsApp", "Walk-in"] as const;

export interface LeadCaptureFormProps {
  /** When true, the form is laid out as a "sheet" (right-side panel). */
  asSheet?: boolean;
  /** Fires after a successful create. */
  onSuccess?: (lead: CrmLead) => void;
  /** ClassName override. */
  className?: string;
}

export function LeadCaptureForm({
  asSheet,
  onSuccess,
  className,
}: LeadCaptureFormProps) {
  const queryClient = useQueryClient();
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [interest, setInterest] = useState("");
  const [segment, setSegment] = useState<string>("retail");
  const [source, setSource] = useState<string>("Website");
  const [channel, setChannel] = useState<string>("Email");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submitMut = useMutation({
    mutationFn: async () => {
      const candidate: CreateCrmLeadInput = {
        companyName: companyName.trim(),
        contactName: contactName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        interest: interest.trim(),
        segment,
        source,
        channel,
        estimatedValue: estimatedValue === "" ? undefined : Number(estimatedValue),
        currency: "AMD",
      };
      const parsed = CreateCrmLeadInputSchema.safeParse(candidate);
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        );
      }
      return postJson("/api/crm/leads", parsed.data, CrmLeadSchema);
    },
    onSuccess: (lead) => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
      onSuccess?.(lead);
      // Reset for the next entry
      setCompanyName("");
      setContactName("");
      setEmail("");
      setPhone("");
      setInterest("");
      setEstimatedValue("");
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : "Failed to create lead");
    },
  });

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    submitMut.mutate();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3",
        asSheet && "max-w-md",
        className,
      )}
    >
      <h3 className="text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
        New lead
      </h3>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Company name *</span>
          <input
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            required
            minLength={2}
            placeholder="Acme LLC"
            className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-base)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
          />
        </label>

        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Contact name *</span>
          <input
            type="text"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            required
            minLength={2}
            placeholder="Anna Petrosyan"
            className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-base)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Email *</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="anna@acme.am"
            className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-base)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
          />
        </label>

        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Phone *</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            minLength={4}
            placeholder="+374 99 ..."
            className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-base)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-[var(--text-sm)]">
        <span className="text-[var(--color-muted)]">Interest *</span>
        <input
          type="text"
          value={interest}
          onChange={(e) => setInterest(e.target.value)}
          required
          minLength={4}
          placeholder="Need 5 treatment chairs"
          className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-base)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
        />
      </label>

      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Segment</span>
          <select
            value={segment}
            onChange={(e) => setSegment(e.target.value)}
            className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-base)]"
          >
            {SEGMENTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Source</span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-base)]"
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Channel</span>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-base)]"
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-[var(--text-sm)]">
        <span className="text-[var(--color-muted)]">Estimated value (AMD, optional)</span>
        <input
          type="number"
          min={0}
          value={estimatedValue}
          onChange={(e) => setEstimatedValue(e.target.value)}
          placeholder="5000000"
          className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-base)] tabular-nums"
        />
      </label>

      {error && (
        <p role="alert" className="text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          leadingIcon={<UserPlus className="size-3.5" />}
          loading={submitMut.isPending}
        >
          Create lead
        </Button>
      </div>
    </form>
  );
}
