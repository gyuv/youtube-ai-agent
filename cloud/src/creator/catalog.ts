/**
 * The eleven youtube-agent-skill skills as studio tools, grouped into the three Creator tabs.
 * Pure data: safe for client components.
 */

export type LabId = "script" | "edit" | "growth";
export type FieldKind = "text" | "textarea" | "transcript" | "csv" | "json";

export interface ToolField {
  name: string;
  label: string;
  kind: FieldKind;
  placeholder?: string;
  hint?: string;
  required?: boolean;
}

export interface CreatorTool {
  id: string; // the skill id, e.g. "yt-script"
  lab: LabId;
  title: string;
  blurb: string;
  fields: ToolField[];
  /** Pre-fill from one of the channel's videos (idea, title, transcript...). */
  usesProject?: boolean;
  /** Its result can be written back to a video's title/description/tags. */
  applies?: "title" | "seo" | "chapters";
}

export const LABS: Record<LabId, { title: string; href: string; blurb: string }> = {
  script: { title: "Script Lab", href: "/script-lab", blurb: "Before you record: the script, the hook, the title and thumbnail, and the search copy." },
  edit: { title: "Edit Lab", href: "/edit-lab", blurb: "After you record: what to cut, the chapters, the Shorts hiding inside, and where viewers left." },
  growth: { title: "Growth Lab", href: "/growth-lab", blurb: "Running the channel: the week's plan, what's working in your niche, an audit and your comments." },
};

const transcriptHint = "Paste an .srt, .vtt or Whisper JSON, upload a file, or pick one of your videos to use its narration with exact timings.";

export const TOOLS: CreatorTool[] = [
  {
    id: "yt-script",
    lab: "script",
    title: "Script",
    blurb: "One idea into a script: five hooks off 21 formulas, scored, then the spoken script with the retention beats marked.",
    usesProject: true,
    fields: [
      { name: "idea", label: "Video idea", kind: "textarea", required: true, placeholder: "e.g. Why most SIP investors stop after 6 months" },
      { name: "length", label: "Length", kind: "text", placeholder: "e.g. 60-second Short, or 8 minutes" },
    ],
  },
  {
    id: "yt-package",
    lab: "script",
    title: "Title + thumbnail",
    blurb: "Title and thumbnail text as one pairing, linted for truncation, duplication and vagueness.",
    usesProject: true,
    applies: "title",
    fields: [
      { name: "idea", label: "What the video delivers", kind: "textarea", required: true },
      { name: "title", label: "Your current title (optional)", kind: "text" },
      { name: "thumb", label: "Thumbnail text (optional)", kind: "text", placeholder: "3 words max" },
    ],
  },
  {
    id: "yt-seo",
    lab: "script",
    title: "SEO",
    blurb: "The description, the tags worth having, and the three searches this video should win.",
    usesProject: true,
    applies: "seo",
    fields: [
      { name: "title", label: "Title", kind: "text", required: true },
      { name: "idea", label: "What the video covers", kind: "textarea", required: true },
    ],
  },
  {
    id: "yt-edit",
    lab: "edit",
    title: "Edit list",
    blurb: "A transcript into an edit decision list: dead air, filler and retakes, with timecodes and the runtime you'd land on.",
    usesProject: true,
    fields: [{ name: "transcript", label: "Transcript", kind: "transcript", required: true, hint: transcriptHint }],
  },
  {
    id: "yt-chapters",
    lab: "edit",
    title: "Chapters",
    blurb: "Chapters from a transcript, validated against YouTube's rules (0:00 first, 3+, 10 s each) so they actually render.",
    usesProject: true,
    applies: "chapters",
    fields: [{ name: "transcript", label: "Transcript", kind: "transcript", required: true, hint: transcriptHint }],
  },
  {
    id: "yt-shorts",
    lab: "edit",
    title: "Shorts finder",
    blurb: "The Shorts already inside a long video, each with a new first line.",
    usesProject: true,
    fields: [{ name: "transcript", label: "Transcript", kind: "transcript", required: true, hint: transcriptHint }],
  },
  {
    id: "yt-retention",
    lab: "edit",
    title: "Retention",
    blurb: "Your audience-retention export read properly: the hook leak, the cliffs, the slide, and what to change.",
    usesProject: true,
    fields: [
      { name: "csv", label: "Retention CSV", kind: "csv", required: true, hint: "YouTube Studio → Analytics → a video → Engagement → audience retention → download." },
      { name: "duration", label: "Video length in seconds (if the CSV uses percent)", kind: "text" },
      { name: "transcript", label: "Transcript (optional, names what you said at each drop)", kind: "transcript", hint: transcriptHint },
    ],
  },
  {
    id: "yt-plan",
    lab: "growth",
    title: "Weekly plan",
    blurb: "A week that fits the hours you actually have: one anchor, one cheap one, three Shorts.",
    fields: [
      { name: "hours", label: "Hours you have this week", kind: "text", required: true, placeholder: "e.g. 6" },
      { name: "notes", label: "Ideas, deadlines or constraints (optional)", kind: "textarea" },
    ],
  },
  {
    id: "yt-viral",
    lab: "growth",
    title: "Viral in your niche",
    blurb: "What's working in your niche, ranked by how far each video beat its own channel's median, not by channel size.",
    fields: [
      { name: "query", label: "Search YouTube for", kind: "text", placeholder: "Leave empty to use your channel's niche" },
      { name: "collected", label: "Or paste collected videos (JSON)", kind: "json", hint: '[{"channel":"...","title":"...","views":123}] - at least 4 videos per channel' },
    ],
  },
  {
    id: "yt-audit",
    lab: "growth",
    title: "Channel audit",
    blurb: "The whole channel from its real numbers, ending in ONE fix rather than twenty.",
    fields: [{ name: "notes", label: "Anything the numbers don't show (optional)", kind: "textarea", placeholder: "e.g. I changed thumbnail style in August" }],
  },
  {
    id: "yt-comment",
    lab: "growth",
    title: "Comment replies",
    blurb: "Your comments triaged into four piles, replies in your voice, and which one to pin.",
    fields: [{ name: "comments", label: "Comments", kind: "textarea", required: true, placeholder: "Paste comments, one per line" }],
  },
];

export const toolsFor = (lab: LabId) => TOOLS.filter((t) => t.lab === lab);
export const findTool = (id: string) => TOOLS.find((t) => t.id === id);
