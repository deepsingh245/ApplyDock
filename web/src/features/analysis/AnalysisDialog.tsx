import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AnalysisView } from "./AnalysisView";

/**
 * The full analysis in a large dialog over the resume editor; closing (×, Esc, backdrop) returns to the editor.
 * Contract used by the resume editor: <AnalysisDialog analysisId open onOpenChange />.
 */
export function AnalysisDialog({ analysisId, open, onOpenChange }: { analysisId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Full analysis" size="full" closeLabel="Close full analysis" data-testid="analysis-dialog">
        <div className="p-4">
          {/* Keyed so reopening on another run starts from that run, not the one last viewed inside the dialog. */}
          {open ? <AnalysisView key={analysisId} analysisId={analysisId} inDialog onLeave={() => onOpenChange(false)} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
