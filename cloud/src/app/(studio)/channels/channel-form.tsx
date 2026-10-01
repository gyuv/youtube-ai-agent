"use client";

import { Bot, LoaderCircle } from "lucide-react";
import { startTransition, useActionState, useMemo, useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldHint, Input, Label, Select, Switch, Textarea } from "@/components/ui/form-controls";
import type { Channel } from "@/generated/prisma/client";
import { useClientValue } from "@/lib/use-client-value";
import { cn } from "@/lib/utils";
import { DEFAULT_VOICE, VOICE_OPTIONS } from "@/lib/voices";
import { formatSlot, isValidCron, isValidTimeZone, nextPostingTimes } from "@/services/schedule";
import { saveChannelAction, type ChannelFormState } from "./actions";

type ChannelFields = Pick<
  Channel,
  | "name"
  | "niche"
  | "targetAudience"
  | "language"
  | "defaultVoice"
  | "defaultFormat"
  | "defaultPrivacy"
  | "defaultScriptPrompt"
  | "defaultVisualPrompt"
  | "postingCron"
  | "postingTimezone"
  | "autoPublish"
  | "isActive"
  | "autopilot"
  | "autopilotReview"
  | "autopilotLeadHours"
  | "autopilotVisualSource"
  | "topicBacklog"
>;

const CRON_PRESETS = [
  { label: "Daily 6 pm", cron: "0 18 * * *" },
  { label: "Mon · Wed · Fri 6 pm", cron: "0 18 * * 1,3,5" },
  { label: "Weekdays 9 am", cron: "0 9 * * 1-5" },
  { label: "Twice daily", cron: "0 9,18 * * *" },
];

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <FieldHint>{hint}</FieldHint> : null}
    </div>
  );
}

export function ChannelForm({ channelId, initial, youtubeConnected }: { channelId: string | null; initial: ChannelFields | null; youtubeConnected: boolean }) {
  const [state, action, pending] = useActionState<ChannelFormState, FormData>(saveChannelAction.bind(null, channelId), {
    error: null,
    fieldErrors: {},
  });
  const errors = state.fieldErrors;
  const [cron, setCron] = useState(initial?.postingCron ?? "0 18 * * 1,3,5");
  // New channels default to the operator's own time zone.
  const browserTimeZone = useClientValue(() => Intl.DateTimeFormat().resolvedOptions().timeZone, "UTC");
  // Slot previews depend on the clock and on the browser's date formatting (Node and Chrome
  // disagree on commas), so they only render after hydration.
  const hydrated = useClientValue(() => true, false);
  const [editedTimeZone, setTimeZone] = useState<string | null>(initial?.postingTimezone ?? null);
  const timeZone = editedTimeZone ?? browserTimeZone;
  const [autoPublish, setAutoPublish] = useState(initial?.autoPublish ?? false);
  const [autopilot, setAutopilot] = useState(initial?.autopilot ?? false);

  const timeZones = useMemo(() => (typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []), []);
  const preview = useMemo(() => {
    if (!cron.trim()) return { slots: [] as string[], note: "No schedule: videos are published when you choose." };
    if (!isValidCron(cron)) return { slots: [], note: "Not a valid 5-field cron expression yet." };
    if (!isValidTimeZone(timeZone)) return { slots: [], note: "Unknown time zone." };
    return { slots: nextPostingTimes(cron, timeZone, 3).map((d) => formatSlot(d, timeZone)), note: null };
  }, [cron, timeZone]);

  // Submit via a transition instead of <form action>, so a validation error doesn't reset the form.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  };

  return (
    <form onSubmit={submit} className="grid gap-6">
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription className="col-span-2 col-start-1">{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Channel</CardTitle>
            <CardDescription className="mt-1.5">What the channel is about. Gemini writes every script with this in mind.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <Field id="name" label="Name" error={errors.name}>
            <Input id="name" name="name" defaultValue={initial?.name} required maxLength={80} aria-invalid={!!errors.name} />
          </Field>
          <Field id="language" label="Language" error={errors.language} hint="Narration language code, e.g. en, hi, en-IN">
            <Input id="language" name="language" defaultValue={initial?.language ?? "en"} required aria-invalid={!!errors.language} />
          </Field>
          <div className="sm:col-span-2">
            <Field id="niche" label="Niche" error={errors.niche} hint="e.g. Personal finance for young Indian professionals">
              <Input id="niche" name="niche" defaultValue={initial?.niche} required maxLength={200} aria-invalid={!!errors.niche} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field id="targetAudience" label="Target audience" error={errors.targetAudience}>
              <Input id="targetAudience" name="targetAudience" defaultValue={initial?.targetAudience ?? ""} maxLength={300} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Voice, format and style</CardTitle>
            <CardDescription className="mt-1.5">Defaults for new videos; each video can still be changed in the studio.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-3">
          <Field id="defaultVoice" label="Voice" error={errors.defaultVoice} hint="Pick one, or type any edge-tts voice or elevenlabs:<voice ID>">
            <Input id="defaultVoice" name="defaultVoice" list="edge-voices" defaultValue={initial?.defaultVoice ?? DEFAULT_VOICE} required aria-invalid={!!errors.defaultVoice} />
            <datalist id="edge-voices">
              {VOICE_OPTIONS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </datalist>
          </Field>
          <Field id="defaultFormat" label="Format">
            <Select id="defaultFormat" name="defaultFormat" defaultValue={initial?.defaultFormat ?? "SHORT"}>
              <option value="SHORT">Short · 9:16</option>
              <option value="LONG_FORM">Long-form · 16:9</option>
            </Select>
          </Field>
          <Field id="defaultPrivacy" label="YouTube visibility">
            <Select id="defaultPrivacy" name="defaultPrivacy" defaultValue={initial?.defaultPrivacy ?? "PRIVATE"}>
              <option value="PRIVATE">Private</option>
              <option value="UNLISTED">Unlisted</option>
              <option value="PUBLIC">Public</option>
            </Select>
          </Field>
          <div className="sm:col-span-3">
            <Field id="defaultScriptPrompt" label="Script style guide" error={errors.defaultScriptPrompt} hint="Tone, persona, recurring segments, words to avoid…">
              <Textarea id="defaultScriptPrompt" name="defaultScriptPrompt" defaultValue={initial?.defaultScriptPrompt ?? ""} maxLength={4000} rows={4} />
            </Field>
          </div>
          <div className="sm:col-span-3">
            <Field id="defaultVisualPrompt" label="Visual style" error={errors.defaultVisualPrompt} hint="Appended to every AI image prompt, e.g. cinematic, moody lighting, 35mm film">
              <Input id="defaultVisualPrompt" name="defaultVisualPrompt" defaultValue={initial?.defaultVisualPrompt ?? ""} maxLength={1000} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Posting schedule</CardTitle>
            <CardDescription className="mt-1.5">Slots appear on the dashboard; new videos can take the next free one.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="flex flex-wrap gap-2">
            {CRON_PRESETS.map((preset) => (
              <Button key={preset.cron} type="button" size="sm" variant={cron === preset.cron ? "secondary" : "outline"} onClick={() => setCron(preset.cron)}>
                {preset.label}
              </Button>
            ))}
            <Button type="button" size="sm" variant={cron === "" ? "secondary" : "outline"} onClick={() => setCron("")}>
              No schedule
            </Button>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="postingCron" label="Cron expression" error={errors.postingCron} hint="minute hour day month weekday">
              <Input id="postingCron" name="postingCron" value={cron} onChange={(e) => setCron(e.target.value)} className="font-mono" aria-invalid={!!errors.postingCron} />
            </Field>
            <Field id="postingTimezone" label="Time zone" error={errors.postingTimezone}>
              <Input id="postingTimezone" name="postingTimezone" list="time-zones" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} required aria-invalid={!!errors.postingTimezone} />
              <datalist id="time-zones">
                {timeZones.map((tz) => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
            </Field>
          </div>
          <div className="rounded-md border bg-muted/30 px-3 py-2.5 text-sm">
            {!hydrated ? (
              <span className="text-muted-foreground">Calculating next slots…</span>
            ) : preview.note ? (
              <span className="text-muted-foreground">{preview.note}</span>
            ) : (
              <>
                <span className="text-muted-foreground">Next slots: </span>
                {preview.slots.join("  ·  ")}
              </>
            )}
          </div>
          <div className="grid gap-3">
            <Label className="font-normal">
              <Switch name="autoPublish" checked={autoPublish} onChange={(e) => setAutoPublish(e.target.checked)} />
              Publish to YouTube automatically after each render
            </Label>
            {autoPublish && !youtubeConnected ? (
              <FieldHint className="text-amber-600 dark:text-amber-400">Connect this channel to YouTube after saving, or renders will stop at &quot;Rendered&quot;.</FieldHint>
            ) : null}
            <Label className="font-normal">
              <Switch name="isActive" defaultChecked={initial?.isActive ?? true} />
              Channel is active (shows its slots on the dashboard)
            </Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-4" /> Autopilot
            </CardTitle>
            <CardDescription className="mt-1.5">
              Fills each open posting slot on its own: picks a topic, writes the script, voices and illustrates every scene,
              renders on GitHub Actions and, with auto-publish on, schedules the upload for the slot.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5">
          <Label className="font-normal">
            <Switch name="autopilot" checked={autopilot} onChange={(e) => setAutopilot(e.target.checked)} />
            Run this channel on autopilot
          </Label>
          {/* Dimmed rather than disabled: disabled fields aren't submitted, which would wipe the backlog. */}
          <div className={cn("grid gap-5 transition-opacity", !autopilot && "opacity-60")}>
            <Label className="font-normal">
              <Switch name="autopilotReview" defaultChecked={initial?.autopilotReview ?? false} />
              Let me review each video before it renders
            </Label>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="autopilotLeadHours" label="Start production" error={errors.autopilotLeadHours} hint="Hours before a slot; leave time for review and rendering">
                <Input id="autopilotLeadHours" name="autopilotLeadHours" type="number" min={6} max={168} defaultValue={initial?.autopilotLeadHours ?? 36} />
              </Field>
              <Field id="autopilotVisualSource" label="Visuals">
                <Select id="autopilotVisualSource" name="autopilotVisualSource" defaultValue={initial?.autopilotVisualSource === "PEXELS" ? "PEXELS" : "POLLINATIONS"}>
                  <option value="POLLINATIONS">AI images (Pollinations)</option>
                  <option value="PEXELS">Stock B-roll (Pexels)</option>
                </Select>
              </Field>
            </div>
            <Field id="topicBacklog" label="Topic backlog" error={errors.topicBacklog} hint="One topic per line, used first and in order. When it runs out, Gemini suggests topics that don't repeat earlier videos.">
              <Textarea id="topicBacklog" name="topicBacklog" defaultValue={initial?.topicBacklog ?? ""} rows={4} placeholder={"How UPI changed small shops\nIs gold still worth buying in 2026?"} />
            </Field>
          </div>
          {autopilot && !cron.trim() ? <FieldHint className="text-amber-600 dark:text-amber-400">Autopilot needs a posting schedule above.</FieldHint> : null}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : null}
          {channelId ? "Save changes" : "Create channel"}
        </Button>
      </div>
    </form>
  );
}
