import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, FileTextIcon, MessageSquareTextIcon, UserRoundIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useAppState } from "@/api/state";
import { Card } from "@/components/ui/card";
import { Eyebrow, Page, PageHeading } from "@/components/ui/misc";
import { api } from "@/lib/api";

interface FeatureProps {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  to: string;
  facts: { label: string; value: ReactNode }[];
  links: { label: string; to: string }[];
}

/** One feature: the title is the main link and stretches over the whole card; quick links sit above it. */
function Feature({ id, icon, title, description, to, facts, links }: FeatureProps) {
  return (
    <Card className="relative flex flex-col gap-3 transition-ledger transition-colors hover:border-line-strong" data-testid={`feature-${id}`}>
      <div className="flex items-center gap-3">
        <span className="inline-flex size-9 items-center justify-center rounded-sm bg-accent-soft text-accent [&_svg]:size-5" aria-hidden>{icon}</span>
        <h2 className="m-0 text-lg font-semibold text-ink">
          <Link to={to} className="text-ink no-underline after:absolute after:inset-0 after:content-[''] hover:text-accent">{title}</Link>
        </h2>
        <ArrowRightIcon aria-hidden className="ml-auto size-4 text-ink-3" />
      </div>
      <p className="m-0 text-sm text-ink-2">{description}</p>
      <dl className="m-0 flex flex-wrap gap-x-6 gap-y-1">
        {facts.map((fact) => (
          <div key={fact.label} className="flex items-baseline gap-1.5">
            <dd className="tabular m-0 text-md font-semibold text-ink">{fact.value}</dd>
            <dt className="text-xs text-ink-3">{fact.label}</dt>
          </div>
        ))}
      </dl>
      <div className="relative z-10 mt-auto flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-sm">
        {links.map((link) => <Link key={link.to} to={link.to} className="text-accent">{link.label}</Link>)}
      </div>
    </Card>
  );
}

export default function HomePage() {
  const state = useAppState();
  const outreach = useQuery({ queryKey: ["outreach-overview"], queryFn: () => api<{ total_contacts: number; awaiting_action: number }>("/api/outreach/overview") });
  const entries = state.data?.entries ?? [];
  const resumes = state.data?.resumes ?? [];
  const active = entries.filter((entry) => entry.status !== "rejected").length;
  const dash = (value: number | undefined) => (value === undefined ? "–" : value);

  return (
    <Page>
      <PageHeading title="ApplyDock" description="Pick a feature to get started." />
      <Eyebrow className="mb-3">Features</Eyebrow>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Feature
          id="applications"
          icon={<FileTextIcon />}
          title="Applications and resume parsing"
          description="Capture jobs, parse your resumes into structured sections, check how well each fits a role, tailor the resume and track every application."
          to="/applications"
          facts={[{ label: "applications", value: dash(state.data ? active : undefined) }, { label: "resumes", value: dash(state.data ? resumes.length : undefined) }]}
          links={[{ label: "Add a job", to: "/applications/new" }, { label: "Resume library", to: "/resumes" }]}
        />
        <Feature
          id="outreach"
          icon={<MessageSquareTextIcon />}
          title="WhatsApp outreach"
          description="Keep recruiter contacts, write message templates and schedule your applications across a time window, with reminders and follow-ups."
          to="/outreach"
          facts={[{ label: "contacts", value: dash(outreach.data?.total_contacts) }, { label: "awaiting you", value: dash(outreach.data?.awaiting_action) }]}
          links={[{ label: "Schedule messages", to: "/outreach" }]}
        />
        <Feature
          id="profile"
          icon={<UserRoundIcon />}
          title="Profile and settings"
          description="Your Master Profile that every resume and message draws from, plus Notion, Gmail and resume design settings."
          to="/settings/profile"
          facts={[]}
          links={[{ label: "Connections", to: "/settings/connections" }, { label: "Resume design", to: "/settings/design" }]}
        />
      </div>
    </Page>
  );
}
