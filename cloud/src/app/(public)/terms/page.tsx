import type { Metadata } from "next";
import { GOOGLE_PRIVACY_URL, POLICIES_UPDATED, YOUTUBE_TERMS_URL, publicOperator } from "@/lib/publicInfo";

export const metadata: Metadata = { title: "Terms of Use · Lumen Cloud" };
export const dynamic = "force-dynamic";

export default function TermsPage() {
  const operator = publicOperator();
  return (
    <>
      <h1>Terms of Use</h1>
      <p>Last updated: {POLICIES_UPDATED}</p>
      <p>
        Lumen Cloud is a private video studio run by {operator.name} for their own YouTube channels. Access is limited to the operator.
      </p>

      <h2>YouTube</h2>
      <p>
        Lumen Cloud uses YouTube API Services. <strong>By using Lumen Cloud you agree to be bound by the{" "}
        <a href={YOUTUBE_TERMS_URL} target="_blank" rel="noreferrer">
          YouTube Terms of Service
        </a>
        .</strong> Google&apos;s use of data is covered by the{" "}
        <a href={GOOGLE_PRIVACY_URL} target="_blank" rel="noreferrer">
          Google Privacy Policy
        </a>
        .
      </p>

      <h2>Your content</h2>
      <ul>
        <li>You are responsible for every video uploaded from your studio and for following YouTube&apos;s Community Guidelines.</li>
        <li>
          Videos made with AI voices or imagery are uploaded with YouTube&apos;s altered or synthetic content disclosure turned on. Review
          them before publishing; the studio lets you require approval before anything is uploaded.
        </li>
        <li>Only upload content you have the rights to.</li>
      </ul>

      <h2>Privacy</h2>
      <p>
        How data is handled is described in the <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>Changes</h2>
      <p>These terms may be updated; the date above shows the latest version.</p>
    </>
  );
}
