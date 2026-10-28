import { lazy } from "react";
import { createBrowserRouter, Navigate, useLocation } from "react-router";
import { BackButton, EmptyState, Page } from "@/components/ui/misc";
import { AppShell } from "./AppShell";

const ApplicationsPage = lazy(() => import("@/features/applications/ApplicationsPage"));
const CreateApplicationPage = lazy(() => import("@/features/applications/CreateApplicationPage"));
const AnalysisPage = lazy(() => import("@/features/analysis/AnalysisPage"));
const ResumeLibraryPage = lazy(() => import("@/features/resume-library/ResumeLibraryPage"));
const ResumeEditorPage = lazy(() => import("@/features/resume-editor/ResumeEditorPage"));
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage"));
// Only referenced in dev, so production builds drop the kit entirely.
const devRoutes = import.meta.env.DEV ? [{ path: "kit", Component: lazy(() => import("./KitPage")), handle: { title: "Component kit" } }] : [];

function NotFound() {
  const location = useLocation();
  return (
    <Page>
      <EmptyState title="Page not found" actions={<BackButton onClick={() => history.back()}>Back</BackButton>}>
        Nothing lives at <code>{location.pathname}</code>.
      </EmptyState>
    </Page>
  );
}

// basename follows Vite's base, so the app can be served under a sub-path if ever needed.
const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || "/";

export const router = createBrowserRouter(
  [
    {
      element: <AppShell />,
      children: [
        { index: true, element: <ApplicationsPage />, handle: { title: "Applications" } },
        { path: "applications/new", element: <CreateApplicationPage />, handle: { title: "Add a job" } },
        { path: "applications/:entryId", element: <ApplicationsPage />, handle: { title: "Applications" } },
        { path: "analysis/:analysisId", element: <AnalysisPage />, handle: { title: "ATS Analysis" } },
        { path: "resumes", element: <ResumeLibraryPage />, handle: { title: "Resume Library" } },
        { path: "resumes/:resumeId", element: <ResumeLibraryPage />, handle: { title: "Resume Library" } },
        { path: "resumes/:resumeId/edit", element: <ResumeEditorPage />, handle: { title: "Resume Editor" } },
        { path: "settings", element: <Navigate to="/settings/connections" replace /> },
        { path: "settings/:tab", element: <SettingsPage />, handle: { title: "Settings" } },
        { path: "settings/:tab/:section", element: <SettingsPage />, handle: { title: "Settings" } },
        ...devRoutes,
        { path: "*", element: <NotFound />, handle: { title: "Not found" } },
      ],
    },
  ],
  { basename },
);
