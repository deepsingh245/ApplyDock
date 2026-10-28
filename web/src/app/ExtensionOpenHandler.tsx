import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useAppState } from "@/api/state";
import { takeOpenRequest, useOpenRequest } from "@/bridge/extension";
import { notify } from "@/components/ui/toaster";
import { useOpenResumeEditor, useRunAnalysis } from "@/features/applications/actions";

/** Acts on an "applydock-open" request from the extension once the state has loaded. */
export function ExtensionOpenHandler() {
  const request = useOpenRequest();
  const { data } = useAppState();
  const navigate = useNavigate();
  const runAnalysis = useRunAnalysis();
  const openEditor = useOpenResumeEditor();

  useEffect(() => {
    if (!request || !data) return;
    const { entryId, action } = takeOpenRequest() ?? request;
    if (action === "profile") {
      navigate("/settings/profile");
      return;
    }
    const entry = data.entries.find((item) => item.id === entryId);
    if (!entry) {
      if (entryId) notify("That application is no longer in ApplyDock.", true);
      return;
    }
    if (action === "analysis") {
      if (entry.analysis?.id) navigate(`/analysis/${entry.analysis.id}`);
      else void runAnalysis(entry);
    } else if (action === "optimize") void openEditor(entry, "optimize", data.resumes);
    else if (action === "submission") navigate(`/applications/${entry.id}?tab=resume&submission=1`);
    else navigate(`/applications/${entry.id}`);
  }, [request, data, navigate, runAnalysis, openEditor]);

  return null;
}
