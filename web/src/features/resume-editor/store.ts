// One editing session of one resume: content, undo/redo, save status and the editor's UI state.
// Content is immutable (Immer), so undo snapshots are the previous objects themselves, never deep copies.
import { produce, type Draft as ImmerDraft } from "immer";
import { create } from "zustand";
import { findTarget, LIST_FIELDS } from "./model";
import type { Change, Draft, DraftMeta, ResumeContent, SaveStatus, SidePanelName, Validation } from "./types";

export interface CompareState {
  value: string;
  loading?: boolean;
  error?: string;
  changes?: Change[];
  pdfUrl?: string;
}

export const HISTORY_LIMIT = 100;
/** Text edits within this window share one undo step. */
export const GROUP_MS = 1200;

export type { DraftMeta };

export interface PreviewState {
  url: string;
  pageCount: number | null;
  previousPageCount: number | null;
  error: string;
}

interface Session {
  resumeId: string;
  content: ResumeContent | null;
  revision: number;
  contentHash: string;
  meta: DraftMeta | null;
  undo: ResumeContent[];
  redo: ResumeContent[];
  lastSnapshotAt: number;
  status: SaveStatus;
  saveError: string;
  conflict: Draft | null;
  /** Bumped by every local edit that must be saved. */
  editSeq: number;
  /** Bumped whenever the preview must re-render; immediate skips the typing debounce. */
  previewKick: { seq: number; immediate: boolean };
  preview: PreviewState;
  panel: SidePanelName;
  leftTab: "content" | "design";
  mobileTab: "edit" | "preview";
  revealed: string[];
  onlySuggested: boolean;
  analysisId: string;
  scoreCheck: { analysisId: string; jobId: string } | null;
  suggestionJobId: string;
  recommending: string;
  compare: CompareState | null;
  validation: Validation | null;
  analysisDialog: boolean;
}

interface Actions {
  load: (resumeId: string, draft: Draft) => void;
  setField: (target: string, field: string, raw: string) => void;
  setSectionTitle: (section: string, value: string) => void;
  setLayout: (key: string, value: string | number | boolean) => void;
  setMeta: (key: "paper" | "page_limit", value: string | number) => void;
  applyPreset: (template: string, layout: Record<string, string | number | boolean>) => void;
  structural: (mutator: (content: ImmerDraft<ResumeContent>) => void) => void;
  undoEdit: () => void;
  redoEdit: () => void;
  acceptServerDraft: (draft: Draft) => void;
  clearHistory: () => void;
  beginSave: () => void;
  saveSucceeded: (draft: Draft, sent: ResumeContent) => void;
  saveFailed: (message: string) => void;
  setConflict: (draft: Draft | null) => void;
  keepMine: () => void;
  patchMeta: (meta: Partial<DraftMeta>) => void;
  setPreview: (preview: Partial<PreviewState>) => void;
  set: (patch: Partial<Session>) => void;
  reveal: (section: string) => void;
}

export type EditorStore = Session & Actions;

const initialSession = (): Session => ({
  resumeId: "",
  content: null,
  revision: 0,
  contentHash: "",
  meta: null,
  undo: [],
  redo: [],
  lastSnapshotAt: 0,
  status: "saved",
  saveError: "",
  conflict: null,
  editSeq: 0,
  previewKick: { seq: 0, immediate: true },
  preview: { url: "", pageCount: null, previousPageCount: null, error: "" },
  panel: "preview",
  leftTab: "content",
  mobileTab: "edit",
  revealed: [],
  onlySuggested: false,
  analysisId: "",
  scoreCheck: null,
  suggestionJobId: "",
  recommending: "",
  compare: null,
  validation: null,
  analysisDialog: false,
});

const metaOf = ({ content: _content, ...meta }: Draft): DraftMeta => meta;

export const useEditor = create<EditorStore>()((set, get) => {
  /** Record the current content as an undo step; text edits are grouped unless forced. */
  const snapshot = (force: boolean): Partial<Session> | null => {
    const state = get();
    const now = Date.now();
    if (!state.content || (!force && now - state.lastSnapshotAt < GROUP_MS)) return null;
    const undo = [...state.undo, state.content];
    if (undo.length > HISTORY_LIMIT) undo.shift();
    return { undo, redo: [], lastSnapshotAt: force ? 0 : now };
  };

  const edit = (force: boolean, recipe: (content: ImmerDraft<ResumeContent>) => void) => {
    const state = get();
    if (!state.content) return;
    const history = snapshot(force) ?? {};
    const content = produce(state.content, recipe);
    if (content === state.content) return;
    set({ ...history, content, status: "unsaved", editSeq: state.editSeq + 1, previewKick: { seq: state.previewKick.seq + 1, immediate: false } });
  };

  return {
    ...initialSession(),

    load: (resumeId, draft) =>
      set((state) => ({
        ...initialSession(),
        // Keep the Content/Design choice when reopening the same resume.
        leftTab: state.resumeId === resumeId ? state.leftTab : "content",
        resumeId,
        content: draft.content,
        revision: draft.revision,
        contentHash: draft.content_hash,
        meta: metaOf(draft),
        previewKick: { seq: state.previewKick.seq + 1, immediate: true },
      })),

    setField: (target, field, raw) =>
      edit(false, (content) => {
        const found = findTarget(content as ResumeContent, target);
        if (!found) return;
        found.node[field] = LIST_FIELDS.has(field)
          ? raw
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean)
          : raw;
      }),

    setSectionTitle: (section, value) =>
      edit(false, (content) => {
        content.meta.section_titles[section] = value;
      }),

    setLayout: (key, value) =>
      edit(false, (content) => {
        content.meta.layout[key] = value;
      }),

    setMeta: (key, value) =>
      edit(true, (content) => {
        if (key === "page_limit") content.meta.page_limit = Number(value);
        else content.meta.paper = String(value);
      }),

    applyPreset: (template, layout) =>
      edit(true, (content) => {
        content.meta.template = template;
        content.meta.layout = { ...layout };
      }),

    structural: (mutator) => edit(true, mutator),

    undoEdit: () => {
      const state = get();
      if (!state.undo.length || !state.content) return;
      const undo = state.undo.slice(0, -1);
      set({
        undo,
        redo: [...state.redo, state.content],
        content: state.undo[state.undo.length - 1]!,
        lastSnapshotAt: 0,
        status: "unsaved",
        editSeq: state.editSeq + 1,
        previewKick: { seq: state.previewKick.seq + 1, immediate: false },
      });
    },

    redoEdit: () => {
      const state = get();
      if (!state.redo.length || !state.content) return;
      set({
        redo: state.redo.slice(0, -1),
        undo: [...state.undo, state.content],
        content: state.redo[state.redo.length - 1]!,
        lastSnapshotAt: 0,
        status: "unsaved",
        editSeq: state.editSeq + 1,
        previewKick: { seq: state.previewKick.seq + 1, immediate: false },
      });
    },

    // Server-made changes (accepted suggestions, imports, fit) stay undoable locally.
    acceptServerDraft: (draft) => {
      const state = get();
      set({
        ...(snapshot(true) ?? {}),
        content: draft.content,
        revision: draft.revision,
        contentHash: draft.content_hash,
        meta: metaOf(draft),
        status: "saved",
        conflict: null,
        previewKick: { seq: state.previewKick.seq + 1, immediate: true },
      });
    },

    clearHistory: () => set({ undo: [], redo: [], lastSnapshotAt: 0 }),

    beginSave: () => set({ status: "saving" }),

    saveSucceeded: (draft, sent) =>
      set((state) => ({
        revision: draft.revision,
        contentHash: draft.content_hash,
        meta: { ...state.meta, ...metaOf(draft) },
        // Edits made while the request was in flight still need saving.
        status: state.content === sent ? "saved" : "unsaved",
        saveError: "",
      })),

    saveFailed: (message) => set({ status: "error", saveError: message }),

    setConflict: (draft) => set(draft ? { conflict: draft, status: "conflict" } : { conflict: null }),

    keepMine: () =>
      set((state) => ({
        revision: state.conflict?.revision ?? state.revision,
        conflict: null,
        status: "unsaved",
        editSeq: state.editSeq + 1,
      })),

    patchMeta: (meta) => set((state) => ({ meta: { ...state.meta, ...meta } as DraftMeta })),

    setPreview: (preview) => set((state) => ({ preview: { ...state.preview, ...preview } })),

    set: (patch) => set(patch),

    reveal: (section) => set((state) => ({ revealed: state.revealed.includes(section) ? state.revealed : [...state.revealed, section] })),
  };
});

export const editor = () => useEditor.getState();
