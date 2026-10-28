import { useEffect, useRef, useState } from "react";
import type { Profile, ProfileItem, Verification } from "@/api/profile";
import { Button } from "@/components/ui/button";
import { Pill, type PillTone } from "@/components/ui/pill";
import { cn } from "@/lib/cn";
import { dateLabel, plural } from "@/lib/format";
import { EMPLOYMENT_LABELS, FUNCTIONAL_LABELS, LINK_FIELD_LABELS, LINK_LABELS, LINK_TONES, PROJECT_STATUS_LABELS, SKILL_CATEGORY_LABELS, VERIFICATION_LABELS } from "./fields";

const VERIFICATION_TONES: Record<Verification, PillTone> = { verified: "success", needs_review: "warn", unverified: "neutral" };

export function VerificationChip({ value }: { value: Verification }) {
  return <Pill tone={VERIFICATION_TONES[value] ?? "neutral"}>{VERIFICATION_LABELS[value] ?? value}</Pill>;
}

const LINK_CLASSES: Record<string, string> = {
  success: "bg-success-soft text-success",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-surface-2 text-ink-2",
};

/** One chip per project link with its last check result; the chip opens the link. */
export function LinkSummary({ item, profile }: { item: ProfileItem; profile: Profile }) {
  const checks = profile.link_checks?.[item.id] ?? {};
  const fields = Object.keys(LINK_FIELD_LABELS).filter((field) => item.data[field]);
  if (!fields.length) return <span className="text-xs text-ink-3">No links</span>;
  return (
    <>
      {fields.map((field) => {
        const check = checks[field];
        const status = check?.status ?? "not_checked";
        return (
          <a
            key={field}
            className={cn(
              "link-check inline-flex min-h-[22px] items-center rounded-pill px-2 text-xs font-medium no-underline hover:underline",
              LINK_CLASSES[LINK_TONES[status] ?? "neutral"],
            )}
            data-status={status}
            href={String(item.data[field])}
            target="_blank"
            rel="noopener noreferrer"
            title={(check?.detail || "Not checked yet.") + (check?.checked_at ? ` Checked ${dateLabel(check.checked_at)}.` : "")}
          >
            {LINK_FIELD_LABELS[field]}: {LINK_LABELS[status] ?? status}
          </a>
        );
      })}
    </>
  );
}

const asList = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

function Tags({ values }: { values: string[] }) {
  if (!values.length) return null;
  return (
    <p className="m-0 flex flex-wrap gap-1">
      {values.map((tag) => (
        <Pill key={tag}>{tag}</Pill>
      ))}
    </p>
  );
}

export interface ItemActions {
  edit: (item: ProfileItem) => void;
  verifyLinks: (item: ProfileItem) => Promise<void>;
  markVerified: (item: ProfileItem) => Promise<void>;
  toggleArchived: (item: ProfileItem) => Promise<void>;
}

export function ItemCard({ item, profile, actions, compact, highlight }: { item: ProfileItem; profile: Profile; actions: ItemActions; compact?: boolean; highlight?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const [checking, setChecking] = useState(false);
  const data = item.data;

  // Deep links (?item=) bring the card into view and put focus on it, replacing the classic openProfileItem.
  useEffect(() => {
    if (!highlight || !ref.current) return;
    ref.current.scrollIntoView({ block: "center" });
    ref.current.querySelector("button")?.focus({ preventScroll: true });
  }, [highlight]);

  let meta = "";
  let body = null;
  if (item.kind === "experience") {
    const achievements = (Array.isArray(data.achievements) ? data.achievements : []) as { verified?: boolean }[];
    const employment = EMPLOYMENT_LABELS[String(data.employment_type ?? "")];
    meta = [employment && employment !== "Not set" ? employment : "", [data.start, data.end || (data.start ? "present" : "")].filter(Boolean).join(" – "), data.location]
      .filter(Boolean)
      .join(" · ");
    body = (
      <>
        <Tags values={asList(data.technologies)} />
        <p className="m-0 text-xs text-ink-3">
          {achievements.length} {plural(achievements.length, "achievement")} ({achievements.filter((claim) => claim.verified).length} verified)
        </p>
      </>
    );
  } else if (item.kind === "project") {
    const usage = profile.project_usage?.[item.id] ?? [];
    const functional = FUNCTIONAL_LABELS[String(data.functional_status ?? "")];
    meta = [
      PROJECT_STATUS_LABELS[String(data.status ?? "")],
      data.category,
      functional ? functional + (data.functional_checked_at ? ` (${dateLabel(String(data.functional_checked_at))})` : "") : "",
    ]
      .filter(Boolean)
      .join(" · ");
    body = (
      <>
        {data.summary ? <p className="m-0 text-sm text-ink-2">{String(data.summary)}</p> : null}
        <Tags values={asList(data.technologies)} />
        <p className="pf-links m-0 flex flex-wrap gap-x-2 gap-y-1">
          <LinkSummary item={item} profile={profile} />
        </p>
        <p className="m-0 text-xs text-ink-3">
          {usage.length ? `In ${usage.length} ${plural(usage.length, "resume")}: ${usage.map((entry) => entry.name).join(", ")}` : "Not in any saved resume yet"}
          {data.resume_ready ? "" : " · marked not for resumes"} · updated {dateLabel(item.updated_at)}
        </p>
      </>
    );
  } else if (item.kind === "skill") {
    const names = asList(data.evidence_ids)
      .map((id) => profile.items.find((other) => other.id === id)?.label)
      .filter(Boolean);
    meta = SKILL_CATEGORY_LABELS[String(data.category ?? "")] ?? "";
    body = <p className="m-0 truncate text-xs text-ink-3">{names.length ? `Shown in ${names.join(", ")}` : "No linked evidence yet"}</p>;
  } else if (item.kind === "achievement") {
    body = data.evidence ? <p className="m-0 text-xs text-ink-3">Evidence: {String(data.evidence)}</p> : null;
  } else if (item.kind === "education") {
    meta = [data.field, [data.start, data.end].filter(Boolean).join(" – ")].filter(Boolean).join(" · ");
  } else if (item.kind === "certification") {
    meta = [data.issuer, data.date].filter(Boolean).join(" · ");
  }

  const size = compact ? "sm" : "md";
  return (
    <article
      ref={ref}
      id={`pf-item-${item.id}`}
      data-kind={item.kind}
      data-highlight={highlight || undefined}
      className={cn(
        "pf-card grid content-start rounded-md border border-line bg-surface",
        compact ? "gap-1 p-3" : "gap-2 p-4",
        item.archived && "opacity-70",
        highlight && "pf-highlight border-accent shadow-[inset_0_0_0_1px_var(--accent)]",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <strong className={cn("break-words", compact ? "text-sm" : "text-md")}>{item.label}</strong>
          {meta ? <span className="text-xs text-ink-3">{meta}</span> : null}
        </div>
        <VerificationChip value={item.verification} />
        {item.archived ? <Pill>Archived</Pill> : null}
      </div>
      {body}
      <div className={cn("flex flex-wrap gap-x-2 gap-y-1", compact && "mt-1")}>
        <Button size={size === "sm" ? "sm" : "md"} onClick={() => actions.edit(item)}>
          Edit
        </Button>
        {item.kind === "project" ? (
          <Button
            size={size === "sm" ? "sm" : "md"}
            variant="quiet"
            data-profile-action="verify-links"
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              try {
                await actions.verifyLinks(item);
              } finally {
                setChecking(false);
              }
            }}
          >
            {checking ? "Checking…" : "Verify links"}
          </Button>
        ) : null}
        {item.verification !== "verified" ? (
          <Button size={size === "sm" ? "sm" : "md"} variant="quiet" onClick={() => actions.markVerified(item)}>
            Mark verified
          </Button>
        ) : null}
        <Button size={size === "sm" ? "sm" : "md"} variant="quiet" onClick={() => actions.toggleArchived(item)}>
          {item.archived ? "Restore" : "Archive"}
        </Button>
      </div>
    </article>
  );
}
