import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftSaver } from "./saver";
import { GROUP_MS, HISTORY_LIMIT, editor } from "./store";
import type { Draft, ResumeContent } from "./types";

function content(): ResumeContent {
  return {
    basics: { name: "Jordan", label: "Frontend Engineer", email: "", phone: "", location: "", url: "", summary: "", profiles: [] },
    work: [{ id: "w_1", position: "Engineer", name: "Initech", highlights: [{ id: "h_1", text: "Built things" }] }],
    projects: [],
    skills: [{ id: "s_1", name: "Languages", keywords: ["TypeScript"] }],
    education: [],
    certificates: [],
    awards: [],
    custom: [],
    meta: { template: "classic", paper: "a4", page_limit: 0, section_order: ["summary", "work", "skills"], section_titles: { work: "Experience" }, layout: { font_size: 10 } },
  };
}

const draft = (overrides: Partial<Draft> = {}): Draft => ({ content: content(), revision: 1, content_hash: "h1", ...overrides });

describe("resume editor store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T10:00:00Z"));
    editor().load("r1", draft());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("groups quick text edits into one undo step and starts a new step after the pause", () => {
    editor().setField("basics", "label", "S");
    vi.advanceTimersByTime(300);
    editor().setField("basics", "label", "Senior");
    expect(editor().undo).toHaveLength(1);
    vi.advanceTimersByTime(GROUP_MS + 1);
    editor().setField("basics", "label", "Senior Engineer");
    expect(editor().undo).toHaveLength(2);
    editor().undoEdit();
    expect(editor().content!.basics.label).toBe("Senior");
    editor().undoEdit();
    expect(editor().content!.basics.label).toBe("Frontend Engineer");
    editor().redoEdit();
    expect(editor().content!.basics.label).toBe("Senior");
    expect(editor().status).toBe("unsaved");
  });

  it("splits comma lists and edits nested lines by id", () => {
    editor().setField("s_1", "keywords", "TypeScript, React , ,SQL");
    editor().setField("h_1", "text", "Built fast things");
    const state = editor().content!;
    expect(state.skills[0]!.keywords).toEqual(["TypeScript", "React", "SQL"]);
    expect(state.work[0]!.highlights![0]!.text).toBe("Built fast things");
  });

  it("structural edits always snapshot and clear redo", () => {
    editor().structural((c) => {
      c.work.push({ id: "w_2", position: "", name: "" });
    });
    editor().structural((c) => {
      c.meta.section_order = ["work", "summary", "skills"];
    });
    expect(editor().undo).toHaveLength(2);
    editor().undoEdit();
    expect(editor().redo).toHaveLength(1);
    editor().structural((c) => {
      c.work.pop();
    });
    expect(editor().redo).toHaveLength(0);
  });

  it("caps undo history at the limit", () => {
    for (let index = 0; index < HISTORY_LIMIT + 20; index++)
      editor().structural((c) => {
        c.basics.name = `Name ${index}`;
      });
    expect(editor().undo).toHaveLength(HISTORY_LIMIT);
  });

  it("keeps undo snapshots immutable (no shared drafts)", () => {
    const before = editor().content!;
    editor().setField("basics", "name", "Changed");
    expect(editor().undo[0]).toBe(before);
    expect(before.basics.name).toBe("Jordan");
  });

  it("accepting a server draft is undoable and marks the content saved", () => {
    const server = draft({ revision: 5, content_hash: "h5" });
    server.content.basics.summary = "From profile";
    editor().acceptServerDraft(server);
    expect(editor().status).toBe("saved");
    expect(editor().revision).toBe(5);
    editor().undoEdit();
    expect(editor().content!.basics.summary).toBe("");
  });
});

describe("draft saver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    editor().load("r1", draft());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("saves after the debounce and records the new revision", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(respond(200, { draft: { ...draft({ revision: 2, content_hash: "h2" }) } }));
    const saver = new DraftSaver("r1");
    editor().setField("basics", "name", "Jo");
    saver.schedule();
    await vi.advanceTimersByTimeAsync(899);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    await saver.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.expected_revision).toBe(1);
    expect(editor().revision).toBe(2);
    expect(editor().status).toBe("saved");
  });

  it("a 409 opens the conflict, blocks autosave and makes flush throw", async () => {
    const latest = draft({ revision: 9, content_hash: "h9" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(respond(409, { error: "Changed elsewhere", draft: latest }));
    const saver = new DraftSaver("r1");
    editor().setField("basics", "name", "Jo");
    await expect(saver.flush()).rejects.toThrow("Resolve the editing conflict first.");
    expect(editor().status).toBe("conflict");
    expect(editor().conflict?.revision).toBe(9);
    editor().setField("basics", "name", "Joe");
    await saver.save();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    editor().keepMine();
    expect(editor().revision).toBe(9);
    expect(editor().conflict).toBeNull();
  });

  it("runs one save at a time and saves edits made while a save was in flight", async () => {
    let release: (value: Response) => void = () => {};
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)))
      .mockResolvedValue(respond(200, { draft: draft({ revision: 3, content_hash: "h3" }) }));
    const saver = new DraftSaver("r1");
    editor().setField("basics", "name", "A");
    const first = saver.save();
    editor().setField("basics", "name", "AB");
    void saver.save();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(respond(200, { draft: draft({ revision: 2, content_hash: "h2" }) }));
    await first;
    await saver.flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body)).content.basics.name).toBe("AB");
    expect(editor().status).toBe("saved");
  });
});
