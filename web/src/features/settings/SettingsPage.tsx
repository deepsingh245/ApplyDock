import { Navigate, useNavigate, useParams } from "react-router";
import { BackButton, Page, PageHeading } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isProfileSection } from "@/features/profile/fields";
import { MasterProfile } from "@/features/profile/MasterProfile";
import { Connections } from "./Connections";

const TABS = ["connections", "profile"] as const;
type SettingsTab = (typeof TABS)[number];

/** /settings/connections, /settings/profile[/section][?item=<id>] — the tab and section live in the URL. */
export default function SettingsPage() {
  const navigate = useNavigate();
  const { tab, section } = useParams();
  if (!TABS.includes(tab as SettingsTab)) return <Navigate to="/settings/connections" replace />;
  const profileSection = isProfileSection(section) ? section : "personal";
  if (tab === "profile" && section && !isProfileSection(section)) return <Navigate to="/settings/profile" replace />;

  return (
    <Page id="settings-view">
      <BackButton onClick={() => navigate("/")}>Applications</BackButton>
      <PageHeading className="mt-2" title="Settings" description="Connections and your career profile stay with this local helper." />
      <Tabs value={tab} onValueChange={(value) => navigate(`/settings/${value}`)}>
        <TabsList aria-label="Settings sections" className="mb-4">
          <TabsTrigger value="connections" data-settings-tab="connections">
            Connections
          </TabsTrigger>
          <TabsTrigger value="profile" data-settings-tab="profile">
            Master Profile
          </TabsTrigger>
        </TabsList>
        <TabsContent value="connections">
          <Connections />
        </TabsContent>
        <TabsContent value="profile">
          <MasterProfile section={profileSection} />
        </TabsContent>
      </Tabs>
    </Page>
  );
}
