import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MomentsSchema } from "@/services/clipContract";
import { listClipJobs } from "@/services/clipJobs";

export const metadata: Metadata = { title: "Clips" };
export const dynamic = "force-dynamic";

export default async function ClipsPage() {
  const jobs = await listClipJobs();
  return (
    <>
      <PageHeader
        title="Clips"
        description="Long videos turned into Shorts: Gemini finds the best moments, you pick them, GitHub Actions cuts them to 9:16 with captions."
        actions={
          <Link href="/research" className={buttonVariants()}>
            Clip a new video
          </Link>
        }
      />
      {jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No clip jobs yet. Open <Link href="/research" className="underline">Research</Link>, paste a long video and choose <strong>Find best moments</strong>.
        </p>
      ) : (
        <div className="grid gap-3">
          {jobs.map((job) => {
            const moments = MomentsSchema.safeParse(job.moments);
            const list = moments.success ? moments.data : [];
            const done = list.filter((m) => m.status === "done").length;
            return (
              <Link key={job.id} href={`/clips/${job.id}`}>
                <Card className="transition-colors hover:bg-accent/40">
                  <CardContent className="flex flex-wrap items-center gap-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`https://i.ytimg.com/vi/${job.videoId}/mqdefault.jpg`} alt="" className="h-14 w-24 rounded object-cover" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{job.sourceTitle}</div>
                      <div className="text-xs text-muted-foreground">
                        {job.channel.name} · {list.length} moments · {done} clipped · {job.createdAt.toLocaleDateString()}
                      </div>
                    </div>
                    <Badge variant={job.status === "FAILED" ? "destructive" : "secondary"}>{job.status.toLowerCase()}</Badge>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
