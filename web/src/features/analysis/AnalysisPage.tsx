import { useNavigate, useParams } from "react-router";
import { useAnalysis } from "@/api/analyses";
import { BackButton, Page } from "@/components/ui/misc";
import { AnalysisView } from "./AnalysisView";

export default function AnalysisPage() {
  const { analysisId = "" } = useParams();
  const navigate = useNavigate();
  // Shares the query cache with the view, so this costs no extra request.
  const { data } = useAnalysis(analysisId);
  return (
    <Page className="analysis-page">
      <BackButton onClick={() => navigate(data?.entry_id ? `/applications/${data.entry_id}` : "/")}>Applications</BackButton>
      <div className="mt-2">
        <AnalysisView analysisId={analysisId} />
      </div>
    </Page>
  );
}
