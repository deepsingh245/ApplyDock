// Renders the real PDF for the current content: debounced while typing, newest request wins.
import { useEffect } from "react";
import { apiBlob } from "@/lib/api";
import { useEditor } from "./store";

export const PREVIEW_DELAY = 700;

export function usePreview(resumeId: string, rendererMessage: string | null) {
  useEffect(() => {
    if (!resumeId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let seq = 0;
    let url = "";
    let disposed = false;

    const render = async () => {
      const content = useEditor.getState().content;
      if (!content) return;
      controller?.abort();
      controller = new AbortController();
      const mine = ++seq;
      try {
        const result = await apiBlob(`/api/resumes/${resumeId}/draft/preview`, { content }, { signal: controller.signal });
        if (disposed || mine !== seq) return;
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(result.blob);
        const previous = useEditor.getState().preview.pageCount;
        useEditor.getState().setPreview({ url, previousPageCount: previous, pageCount: Number(result.headers.get("X-Page-Count") || 0) || null, error: "" });
      } catch (error) {
        if (disposed || mine !== seq || (error instanceof DOMException && error.name === "AbortError")) return;
        useEditor.getState().setPreview({ error: error instanceof Error ? error.message : String(error) });
      }
    };

    if (rendererMessage) useEditor.getState().setPreview({ error: rendererMessage });
    const schedule = (immediate: boolean) => {
      clearTimeout(timer);
      timer = setTimeout(() => void render(), immediate ? 0 : PREVIEW_DELAY);
    };
    schedule(true);
    const unsubscribe = useEditor.subscribe((state, previous) => {
      if (state.previewKick !== previous.previewKick && state.resumeId === resumeId) schedule(state.previewKick.immediate);
    });
    return () => {
      disposed = true;
      unsubscribe();
      clearTimeout(timer);
      controller?.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [resumeId, rendererMessage]);
}
