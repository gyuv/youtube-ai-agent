"use client";

import { LoaderCircle, Sparkles } from "lucide-react";
import { startTransition, useActionState, useMemo, useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldHint, Input, Label, Select, Switch, Textarea } from "@/components/ui/form-controls";
import { useClientValue } from "@/lib/use-client-value";
import { cn } from "@/lib/utils";
import { createProjectAction, type NewProjectState } from "../actions";

interface ChannelOption {
  id: string;
  name: string;
  defaultFormat: "SHORT" | "LONG_FORM";
  hasSchedule: boolean;
  nextFreeSlot: string | null;
}

/** "2026-09-30T18:00" in the browser's time zone, for <input type="datetime-local">. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function NewProjectForm({ channels, initialChannelId, initialAt }: { channels: ChannelOption[]; initialChannelId: string | null; initialAt: string | null }) {
  const [state, action, pending] = useActionState<NewProjectState, FormData>(createProjectAction, { error: null });
  const [channelId, setChannelId] = useState(initialChannelId ?? channels[0]?.id ?? "");
  const channel = channels.find((c) => c.id === channelId);
  const [schedule, setSchedule] = useState<"none" | "next" | "custom">(initialAt ? "custom" : "none");
  const initialLocalAt = useClientValue(() => toLocalInput(initialAt), "");
  const [editedAt, setCustomAt] = useState<string | null>(null);
  const customAt = editedAt ?? initialLocalAt;
  const scheduledIso = useMemo(() => (schedule === "custom" && customAt ? new Date(customAt).toISOString() : ""), [schedule, customAt]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  };

  return (
    <form onSubmit={submit}>
      <Card>
        <CardContent className="grid gap-6">
          {state.error ? (
            <Alert variant="destructive">
              <AlertDescription className="col-span-2 col-start-1">{state.error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor="topic">What is the video about?</Label>
            <Textarea
              id="topic"
              name="topic"
              required
              minLength={3}
              maxLength={500}
              rows={3}
              placeholder="e.g. Why the Indian rupee's symbol was designed the way it was"
              autoFocus
            />
            <FieldHint>Gemini turns this into a hook, scenes, a call to action, image prompts and YouTube metadata.</FieldHint>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="channelId">Channel</Label>
              <Select id="channelId" name="channelId" value={channelId} onChange={(e) => setChannelId(e.target.value)} required>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="format">Format</Label>
              <Select id="format" name="format" defaultValue="">
                <option value="">Channel default ({channel?.defaultFormat === "LONG_FORM" ? "long-form" : "Short"})</option>
                <option value="SHORT">Short · 9:16</option>
                <option value="LONG_FORM">Long-form · 16:9</option>
              </Select>
            </div>
          </div>

          <fieldset className="grid gap-3">
            <legend className="mb-2 text-sm font-medium">When should it go live?</legend>
            <input type="hidden" name="schedule" value={schedule} />
            <input type="hidden" name="scheduledFor" value={scheduledIso} />
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  ["none", "Decide later", "Publish manually or schedule in the studio."],
                  ["next", "Next free slot", channel?.nextFreeSlot ?? (channel?.hasSchedule ? "—" : "Channel has no schedule")],
                  ["custom", "Pick a time", "Uses your browser's time zone."],
                ] as const
              ).map(([value, label, hint]) => {
                const disabled = value === "next" && !channel?.hasSchedule;
                return (
                  <button
                    key={value}
                    type="button"
                    disabled={disabled}
                    onClick={() => setSchedule(value)}
                    aria-pressed={schedule === value}
                    className={cn(
                      "rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      schedule === value ? "border-primary bg-accent" : "hover:border-ring/60",
                    )}
                  >
                    <div className="text-sm font-medium">{label}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
                  </button>
                );
              })}
            </div>
            {schedule === "custom" ? (
              <Input type="datetime-local" aria-label="Publish time" value={customAt} onChange={(e) => setCustomAt(e.target.value)} required className="w-fit" />
            ) : null}
          </fieldset>

          <Label className="font-normal">
            <Switch name="writeScript" defaultChecked />
            Write the script with Gemini right away
          </Label>

          <div className="flex justify-end">
            <Button type="submit" disabled={pending || !channelId}>
              {pending ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
              Create video
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
