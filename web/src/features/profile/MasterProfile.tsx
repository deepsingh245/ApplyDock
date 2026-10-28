import { PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { profileApi, useProfile, useProfileWrite, useReloadProfile, type Profile, type ProfileItem, type ProfileKind, type Verification } from "@/api/profile";
import { useAppState } from "@/api/state";
import { Button } from "@/components/ui/button";
import { useDialogs } from "@/components/ui/confirm";
import { CheckLine, Field, Select } from "@/components/ui/field";
import { Count, Spinner } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notify } from "@/components/ui/toaster";
import { ApiError, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { dateLabel, plural } from "@/lib/format";
import { FUNCTIONAL_LABELS, KIND_LABELS, LINK_FIELD_LABELS, PROFILE_SECTIONS, VERIFICATION_LABELS, sectionFor, type ProfileSection } from "./fields";
import { ItemCard, LinkSummary, VerificationChip, type ItemActions } from "./ItemCard";
import { ProfileForm } from "./ProfileForm";

const sectionPath = (section: ProfileSection, item?: string) => `/settings/profile/${section}${item ? `?item=${encodeURIComponent(item)}` : ""}`;

/** All profile writes: store the returned profile, report like the classic dashboard, reload on a 409 conflict. */
function useProfileActions(onConflict: () => void) {
  const write = useProfileWrite();
  const reload = useReloadProfile();
  return async <T,>(run: () => Promise<T>, success?: string | ((result: T) => [string, boolean?])): Promise<T | undefined> => {
    try {
      const result = await write(run() as Promise<T & { profile?: Profile }>);
      if (typeof success === "function") {
        const [message, isError] = success(result);
        notify(message, isError);
      } else if (success) notify(success);
      return result;
    } catch (error) {
      notify(errorMessage(error), true);
      if (error instanceof ApiError && error.status === 409) {
        onConflict();
        void reload();
      }
      return undefined;
    }
  };
}

function linksCheckedMessage(response: { results: { status: string }[] }): [string, boolean] {
  const bad = response.results.filter((result) => !["reachable", "redirected"].includes(result.status)).length;
  const count = response.results.length;
  return count
    ? [`${count} ${plural(count, "link")} checked${bad ? `, ${bad} need attention.` : ", all reachable."}`, bad > 0]
    : ["This project has no links to check.", false];
}

function ImportCard({ run }: { run: ReturnType<typeof useProfileActions> }) {
  const { data: state } = useAppState();
  const masters = (state?.resumes ?? []).filter((resume) => resume.kind === "master");
  const [resumeId, setResumeId] = useState("");
  const [verified, setVerified] = useState(true);
  const [busy, setBusy] = useState(false);
  const chosen = resumeId || masters[0]?.id || "";
  return (
    <section className="grid gap-3 rounded-md border border-line bg-surface p-4" aria-labelledby="pf-import-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="pf-import-title" className="m-0 text-lg font-semibold">
            Import from a resume
          </h2>
          <p className="mt-1 mb-0 max-w-[72ch] text-sm text-ink-2">
            Adds experience, projects, skills, education, and certifications ApplyDock does not have yet. Nothing you already entered is overwritten.
          </p>
        </div>
        <Button asChild variant="quiet" size="sm">
          <Link to="/resumes">Manage resumes</Link>
        </Button>
      </div>
      {masters.length ? (
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <Field label="Resume" className="min-w-[260px] flex-1">
            <Select value={chosen} onChange={(event) => setResumeId(event.target.value)}>
              {masters.map((resume) => (
                <option key={resume.id} value={resume.id}>
                  {resume.name} · {resume.category}
                </option>
              ))}
            </Select>
          </Field>
          <CheckLine checked={verified} onChange={(event) => setVerified(event.target.checked)}>
            Mark imported entries as verified (they come from my own resume)
          </CheckLine>
          <Button
            data-profile-action="import"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await run(
                () => profileApi.importFromResume(chosen, verified),
                (response) => {
                  const added = Object.values(response.added).reduce((sum, value) => sum + value, 0);
                  return [
                    added
                      ? `Imported ${added} new ${plural(added, "detail")}. Review them in each tab.`
                      : "Nothing new to import — the profile already has everything from that resume.",
                  ];
                },
              );
              setBusy(false);
            }}
          >
            Import
          </Button>
        </div>
      ) : (
        <p className="m-0 text-sm text-ink-3">Upload a resume first.</p>
      )}
    </section>
  );
}

function ListSection({
  kind,
  title,
  description,
  profile,
  showArchived,
  editing,
  setEditing,
  actions,
  run,
  highlight,
}: {
  kind: ProfileKind;
  title: string;
  description?: string;
  profile: Profile;
  showArchived: boolean;
  editing: string;
  setEditing: (value: string) => void;
  actions: ItemActions;
  run: ReturnType<typeof useProfileActions>;
  highlight: string;
}) {
  const { confirm } = useDialogs();
  const list = profile.items.filter((item) => item.kind === kind && (showArchived || !item.archived));
  const adding = editing === `new:${kind}`;
  const save = (item: ProfileItem | null) => async (data: Record<string, unknown>, verification: Verification) => {
    const result = await run(
      () => (item ? profileApi.updateItem(item.id, { data, verification, expected_revision: item.revision }) : profileApi.createItem(kind, data, verification)),
      "Saved to your Master Profile.",
    );
    if (result) setEditing("");
  };
  const remove = async (item: ProfileItem) => {
    const ok = await confirm({
      title: "Delete from your Master Profile?",
      message: `Delete ‘${item.label}’ from your Master Profile? Resumes and submitted files are not affected.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setEditing("");
    await run(() => profileApi.deleteItem(item.id));
  };
  const skills = kind === "skill";
  return (
    <section className="grid gap-3" aria-labelledby={`pf-section-${kind}`} data-section={kind}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={`pf-section-${kind}`} className="m-0 flex items-baseline gap-2 text-lg font-semibold">
            {title} <Count>{list.length}</Count>
          </h2>
          {description ? <p className="mt-1 mb-0 max-w-[72ch] text-sm text-ink-2">{description}</p> : null}
        </div>
        {adding ? null : (
          <Button data-profile-action="new" data-kind={kind} onClick={() => setEditing(`new:${kind}`)}>
            <PlusIcon aria-hidden /> Add {KIND_LABELS[kind]}
          </Button>
        )}
      </div>
      {adding ? <ProfileForm kind={kind} item={null} items={profile.items} onSubmit={save(null)} onCancel={() => setEditing("")} /> : null}
      <div className={cn("pf-list grid gap-2", skills && "pf-skill-grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))]")}>
        {list.length
          ? list.map((item) =>
              editing === item.id ? (
                <ProfileForm
                  key={item.id}
                  kind={kind}
                  item={item}
                  items={profile.items}
                  onSubmit={save(item)}
                  onCancel={() => setEditing("")}
                  onDelete={() => void remove(item)}
                />
              ) : (
                <ItemCard key={item.id} item={item} profile={profile} actions={actions} compact={skills} highlight={highlight === item.id} />
              ),
            )
          : adding
            ? null
            : <p className="col-span-full m-0 rounded-md border border-dashed border-line-strong p-4 text-center text-sm text-ink-3">Nothing here yet.</p>}
      </div>
    </section>
  );
}

function VerificationSection({ profile, actions, run }: { profile: Profile; actions: ItemActions; run: ReturnType<typeof useProfileActions> }) {
  const active = profile.items.filter((item) => !item.archived);
  const projects = active.filter((item) => item.kind === "project");
  const review = active.filter((item) => item.verification !== "verified");
  const counts = Object.fromEntries(Object.keys(VERIFICATION_LABELS).map((key) => [key, active.filter((item) => item.verification === key).length]));
  const [checkingAll, setCheckingAll] = useState(false);
  const row = "grid items-center gap-3 border-b border-line py-3 md:grid-cols-[minmax(0,1fr)_minmax(180px,220px)_auto]";
  return (
    <>
      <section className="rounded-md border border-line bg-surface p-4" aria-labelledby="pf-links-title">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="pf-links-title" className="m-0 text-lg font-semibold">
              Project links
            </h2>
            <p className="mt-1 mb-0 max-w-[72ch] text-sm text-ink-2">Checks run only when you ask. A reachable link is not proof the app works — record your own test below.</p>
          </div>
          {projects.some((item) => Object.keys(LINK_FIELD_LABELS).some((field) => item.data[field])) ? (
            <Button
              disabled={checkingAll}
              onClick={async () => {
                setCheckingAll(true);
                await run(() => profileApi.verifyLinks(), linksCheckedMessage);
                setCheckingAll(false);
              }}
            >
              {checkingAll ? "Checking…" : "Verify all links"}
            </Button>
          ) : null}
        </div>
        {projects.length ? (
          <div className="mt-3 grid border-t border-line">
            {projects.map((item) => (
              <div key={item.id} className={row}>
                <div className="grid min-w-0 gap-1">
                  <strong>{item.label}</strong>
                  <p className="m-0 flex flex-wrap gap-x-2 gap-y-1">
                    <LinkSummary item={item} profile={profile} />
                  </p>
                </div>
                <Field label="Your own test" help={item.data.functional_checked_at ? `Recorded ${dateLabel(String(item.data.functional_checked_at))}` : "Not recorded"}>
                  <Select
                    data-functional={item.id}
                    value={String(item.data.functional_status ?? "not_verified")}
                    onChange={(event) => void run(() => profileApi.updateItem(item.id, { data: { functional_status: event.target.value } }), "Your test result was recorded.")}
                  >
                    {Object.entries(FUNCTIONAL_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button variant="quiet" onClick={() => actions.verifyLinks(item)}>
                  Verify links
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 mb-0 text-sm text-ink-3">Add projects to check their links.</p>
        )}
      </section>
      <section className="rounded-md border border-line bg-surface p-4" aria-labelledby="pf-confirm-title">
        <h2 id="pf-confirm-title" className="m-0 text-lg font-semibold">
          Entries to confirm
        </h2>
        <p className="mt-1 mb-0 max-w-[72ch] text-sm text-ink-2">
          {counts.verified} verified · {counts.unverified} unverified · {counts.needs_review} need review. Entries marked “needs review” are left out of job matching.
        </p>
        {review.length ? (
          <div className="mt-3 grid border-t border-line">
            {review.map((item) => (
              <div key={item.id} className={row}>
                <div className="grid min-w-0 gap-1">
                  <strong>{item.label}</strong>
                  <span className="text-xs text-ink-3">{KIND_LABELS[item.kind]}</span>
                </div>
                <div>
                  <VerificationChip value={item.verification} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="quiet" onClick={() => actions.markVerified(item)}>
                    Mark verified
                  </Button>
                  <Button variant="quiet" onClick={() => actions.edit(item)}>
                    Edit
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 mb-0 text-sm text-ink-3">Everything active is verified.</p>
        )}
      </section>
    </>
  );
}

export function MasterProfile({ section }: { section: ProfileSection }) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const highlight = search.get("item") ?? "";
  const profile = useProfile();
  const [editing, setEditing] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const run = useProfileActions(() => setEditing(""));
  const data = profile.data;

  // ?item=<id> may arrive with no section (or the wrong one); move to the section that lists that item.
  useEffect(() => {
    if (!highlight || !data) return;
    const item = data.items.find((entry) => entry.id === highlight);
    if (!item) {
      notify("That profile entry no longer exists.", true);
      navigate(sectionPath(section), { replace: true });
    } else if (sectionFor(item.kind) !== section) navigate(sectionPath(sectionFor(item.kind), item.id), { replace: true });
  }, [highlight, data, section, navigate]);

  if (profile.isPending)
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-ink-2">
        <Spinner /> Loading your Master Profile…
      </div>
    );
  if (!data) return <p className="text-sm text-danger">{profile.error ? errorMessage(profile.error) : "Could not load the profile."}</p>;

  const actions: ItemActions = {
    edit: (item) => {
      setEditing(item.id);
      if (sectionFor(item.kind) !== section) navigate(sectionPath(sectionFor(item.kind)));
    },
    verifyLinks: async (item) => {
      await run(() => profileApi.verifyLinks(item.id), linksCheckedMessage);
    },
    markVerified: async (item) => {
      await run(() => profileApi.updateItem(item.id, { verification: "verified" }), "Marked as verified.");
    },
    toggleArchived: async (item) => {
      await run(() => profileApi.updateItem(item.id, { archived: !item.archived }));
    },
  };
  const counts = data.counts ?? {};
  const tabCount: Partial<Record<ProfileSection, number>> = {
    experience: counts.experience,
    projects: counts.project,
    skills: (counts.skill ?? 0) + (counts.achievement ?? 0) + (counts.education ?? 0) + (counts.certification ?? 0),
  };
  const list = (kind: ProfileKind, title: string, description?: string) => (
    <ListSection
      kind={kind}
      title={title}
      description={description}
      profile={data}
      showArchived={showArchived}
      editing={editing}
      setEditing={setEditing}
      actions={actions}
      run={run}
      highlight={highlight}
    />
  );

  let body;
  if (section === "personal")
    body = (
      <>
        <section className="rounded-md border border-line bg-surface p-4" aria-labelledby="pf-personal-title">
          <h2 id="pf-personal-title" className="mt-0 mb-3 text-lg font-semibold">
            Personal details
          </h2>
          <ProfileForm
            key={`${data.personal.id}:${data.personal.revision}`}
            kind="personal"
            item={data.personal}
            items={data.items}
            onSubmit={(values) => run(() => profileApi.savePersonal(values, data.personal.revision || undefined), "Personal details saved.")}
          />
        </section>
        <ImportCard run={run} />
      </>
    );
  else if (section === "experience") body = list("experience", "Experience", "Detailed background is fine here; resumes only use what fits a job.");
  else if (section === "projects") body = list("project", "Projects and applications", "Software you built, separate from job applications. Reused across resumes without copying them.");
  else if (section === "skills")
    body = (
      <>
        {list("skill", "Skills", "Link each skill to the projects or roles that demonstrate it, so matching uses evidence rather than keywords.")}
        {list("achievement", "Achievements")}
        {list("education", "Education")}
        {list("certification", "Certifications")}
      </>
    );
  else body = <VerificationSection profile={data} actions={actions} run={run} />;

  return (
    <div className="grid gap-4" id="profile-pane" data-testid="profile-pane">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="m-0 max-w-[720px] text-sm text-ink-2">
          Your career source of truth. ApplyDock compares jobs against it and suggests resume additions from it — it never edits a resume or a sent file on its own.
        </p>
        <CheckLine checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)}>
          Show archived
        </CheckLine>
      </div>
      <Tabs
        value={section}
        onValueChange={(value) => {
          setEditing("");
          navigate(sectionPath(value as ProfileSection));
        }}
      >
        <TabsList variant="segmented" aria-label="Master Profile sections" className="flex w-full">
          {PROFILE_SECTIONS.map(([key, label]) => (
            <TabsTrigger key={key} value={key} data-profile-tab={key}>
              {label}
              {tabCount[key] ? <small className="tabular text-xs opacity-75">{tabCount[key]}</small> : null}
            </TabsTrigger>
          ))}
        </TabsList>
        {/* The section body is the selected tab's panel, so the tab's aria-controls points at it. */}
        <TabsContent value={section} className="mt-4 grid gap-5" aria-live="polite">
          {body}
        </TabsContent>
      </Tabs>
    </div>
  );
}
