// Dev-only gallery of every shared component in both themes (npm run dev â†’ /app/kit). Not in production builds.
import { MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { useDialogs } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { CheckLine, Field, FieldGrid, Input, Select, Textarea } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Count, EmptyState, Eyebrow, KeyValue, Meter, Page, PageHeading, ScoreFigure, Spinner } from "@/components/ui/misc";
import { Note } from "@/components/ui/note";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notify } from "@/components/ui/toaster";

export default function KitPage() {
  const { confirm, prompt } = useDialogs();
  const [filter, setFilter] = useState<"all" | "open" | "done">("all");
  return (
    <Page>
      <PageHeading title="Component kit" description="Every shared component, in the current theme. Toggle the theme in the top bar." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Buttons" aside={<Pill tone="accent">cva variants</Pill>} />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary">Primary</Button>
            <Button>Secondary</Button>
            <Button variant="quiet">Quiet</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="text">Text link</Button>
            <Button size="sm">Small</Button>
            <Button disabled>Disabled</Button>
            <IconButton label="Add">
              <PlusIcon aria-hidden />
            </IconButton>
          </div>
        </Card>
        <Card>
          <CardHeader title="Pills" />
          <div className="flex flex-wrap gap-2">
            {(["neutral", "accent", "success", "warn", "danger", "outline"] as const).map((tone) => (
              <Pill key={tone} tone={tone}>
                {tone}
              </Pill>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Fields" />
          <div className="grid gap-3">
            <FieldGrid>
              <Field label="Title">
                <Input placeholder="Senior Frontend Engineer" />
              </Field>
              <Field label="Stage" help="Synced with Notion">
                <Select defaultValue="Applied">
                  <option>To apply</option>
                  <option>Applied</option>
                </Select>
              </Field>
            </FieldGrid>
            <Field label="Notes" error="This field has a problem.">
              <Textarea rows={3} aria-invalid />
            </Field>
            <CheckLine defaultChecked>Needs more review</CheckLine>
            <label className="flex items-center gap-2 text-sm">
              <Switch defaultChecked /> Notifications
            </label>
          </div>
        </Card>
        <Card>
          <CardHeader title="Data" />
          <div className="grid gap-3">
            <ScoreFigure score={72.4} />
            <Meter value={72.4} label="Match" />
            <KeyValue items={[["Stage", "Applied"], ["Notion", "Synced"]]} />
            <div className="flex items-center gap-2">
              <Eyebrow>Next step</Eyebrow>
              <Count>12</Count>
              <Spinner />
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Notes" />
          <div className="grid gap-2">
            <Note>Info note.</Note>
            <Note tone="warn">Check captured details before you apply.</Note>
            <Note tone="danger">Resume missing.</Note>
            <Note tone="success">Submission recorded.</Note>
          </div>
        </Card>
        <Card>
          <CardHeader title="Navigation" />
          <Tabs defaultValue="a">
            <TabsList>
              <TabsTrigger value="a">Overview</TabsTrigger>
              <TabsTrigger value="b">Job details</TabsTrigger>
            </TabsList>
            <TabsContent value="a" className="py-3 text-sm">
              Underline tabs.
            </TabsContent>
            <TabsContent value="b" className="py-3 text-sm">
              Second pane.
            </TabsContent>
          </Tabs>
          <Tabs defaultValue="p">
            <TabsList variant="segmented">
              <TabsTrigger value="p">Preview</TabsTrigger>
              <TabsTrigger value="v">Versions</TabsTrigger>
            </TabsList>
          </Tabs>
          <Segmented
            className="mt-3"
            label="Filter"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "open", label: "Open" },
              { value: "done", label: "Done", suffix: <Count>3</Count> },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Overlays" />
          <div className="flex flex-wrap gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button>Dialog</Button>
              </DialogTrigger>
              <DialogContent title="Full analysis" size="md">
                <p className="p-4 text-sm">Dialog body.</p>
              </DialogContent>
            </Dialog>
            <Button onClick={async () => notify(String(await confirm({ message: "Remove this item?", danger: true, confirmLabel: "Remove" })))}>Confirm</Button>
            <Button onClick={async () => notify(String(await prompt({ message: "Edit the suggestion.", initialValue: "Text" })))}>Prompt</Button>
            <Button onClick={() => notify("Saved.")}>Toast</Button>
            <Button onClick={() => notify("Something failed.", true)}>Error toast</Button>
            <Menu>
              <MenuTrigger asChild>
                <IconButton label="More actions">
                  <MoreHorizontalIcon aria-hidden />
                </IconButton>
              </MenuTrigger>
              <MenuContent>
                <MenuItem>Duplicate</MenuItem>
                <MenuItem danger>Remove from ApplyDock</MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <EmptyState title="No active applications" actions={<Button variant="primary">Add a job</Button>}>
            Everything is applied, sent, or closed.
          </EmptyState>
        </Card>
      </div>
    </Page>
  );
}
