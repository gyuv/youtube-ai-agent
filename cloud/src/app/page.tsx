const PIPELINE = [
  { stage: "Script", engine: "Gemini Flash (Google AI Studio free tier)" },
  { stage: "Voiceover", engine: "edge-tts neural voices" },
  { stage: "Visuals", engine: "Pollinations.ai images + Pexels B-roll" },
  { stage: "Render", engine: "GitHub Actions runner (Remotion / FFmpeg)" },
  { stage: "Publish", engine: "YouTube Data API v3" },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Lumen Cloud</h1>
      <p className="mt-2 text-muted-foreground">
        Zero-cost YouTube automation. Every stage runs on a free cloud service; nothing renders on your machine.
      </p>
      <ol className="mt-10 divide-y divide-border rounded-lg border">
        {PIPELINE.map(({ stage, engine }, i) => (
          <li key={stage} className="flex items-center gap-4 px-4 py-3">
            <span className="w-6 text-sm tabular-nums text-muted-foreground">{i + 1}</span>
            <span className="w-28 font-medium">{stage}</span>
            <span className="text-sm text-muted-foreground">{engine}</span>
          </li>
        ))}
      </ol>
    </main>
  );
}
