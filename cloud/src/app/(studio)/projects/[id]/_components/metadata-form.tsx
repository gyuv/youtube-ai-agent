"use client";

import { LoaderCircle, Save } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/form-controls";
import { useClientValue } from "@/lib/use-client-value";
import { saveMetadataAction } from "../../actions";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface MetadataProps {
  projectId: string;
  title: string;
  description: string;
  tags: string[];
  privacy: "PRIVATE" | "UNLISTED" | "PUBLIC";
  scheduledFor: string | null;
  readOnly: boolean;
}

export function MetadataForm({ projectId, title, description, tags, privacy, scheduledFor, readOnly }: MetadataProps) {
  const [titleText, setTitle] = useState(title);
  const [descriptionText, setDescription] = useState(description);
  const initialAt = useClientValue(() => toLocalInput(scheduledFor), "");
  const [editedAt, setAt] = useState<string | null>(null);
  const at = editedAt ?? initialAt;
  const [saving, startTransition] = useTransition();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.set("scheduledFor", at ? new Date(at).toISOString() : "");
    startTransition(async () => {
      const result = await saveMetadataAction(projectId, data);
      if (result.ok) toast.success("YouTube details saved");
      else toast.error(result.error);
    });
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>YouTube details</CardTitle>
          <CardDescription className="mt-1.5">Written by Gemini; used when the video is published.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          <fieldset disabled={readOnly || saving} className="grid gap-4">
            <div className="grid gap-2">
              <div className="flex justify-between">
                <Label htmlFor="meta-title">Title</Label>
                <span className="text-xs tabular-nums text-muted-foreground">{titleText.length}/100</span>
              </div>
              <Input id="meta-title" name="title" value={titleText} onChange={(e) => setTitle(e.target.value)} maxLength={100} />
            </div>
            <div className="grid gap-2">
              <div className="flex justify-between">
                <Label htmlFor="meta-description">Description</Label>
                <span className="text-xs tabular-nums text-muted-foreground">{descriptionText.length}/5000</span>
              </div>
              <Textarea id="meta-description" name="description" value={descriptionText} onChange={(e) => setDescription(e.target.value)} maxLength={5000} rows={5} />
              <FieldHint>Chapters (long-form) and #Shorts are added automatically at upload.</FieldHint>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="meta-tags">Tags</Label>
              <Input id="meta-tags" name="tags" defaultValue={tags.join(", ")} placeholder="comma, separated" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="meta-privacy">Visibility</Label>
                <Select id="meta-privacy" name="privacy" defaultValue={privacy}>
                  <option value="PRIVATE">Private</option>
                  <option value="UNLISTED">Unlisted</option>
                  <option value="PUBLIC">Public</option>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="meta-schedule">Publish at</Label>
                <Input id="meta-schedule" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
              </div>
            </div>
            <FieldHint>A public video with a future time uploads as private and YouTube makes it public then. Private and unlisted videos upload with that visibility.</FieldHint>
          </fieldset>
          {readOnly ? (
            <FieldHint>This video is on YouTube; edit its details in YouTube Studio.</FieldHint>
          ) : (
            <Button type="submit" variant="secondary" disabled={saving} className="justify-self-start">
              {saving ? <LoaderCircle className="animate-spin" /> : <Save />} Save details
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
