import type { Metadata } from "next";
import { GOOGLE_PERMISSIONS_URL, GOOGLE_PRIVACY_URL, POLICIES_UPDATED, YOUTUBE_TERMS_URL, publicOperator } from "@/lib/publicInfo";

export const metadata: Metadata = { title: "Privacy Policy · Lumen Cloud" };
export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  const operator = publicOperator();
  return (
    <>
      <h1>Privacy Policy</h1>
      <p>Last updated: {POLICIES_UPDATED}</p>
      <p>
        Lumen Cloud is a private video studio run by {operator.name}. It writes, voices and renders videos and, when the operator connects a
        YouTube channel, uploads them to that channel. It is not open to the public: only the operator can sign in.
      </p>

      <h2>YouTube API Services</h2>
      <p>
        Lumen Cloud uses YouTube API Services to upload videos to the connected channel and to read that channel&apos;s identity and each
        uploaded video&apos;s visibility. By connecting a YouTube account you agree to the{" "}
        <a href={YOUTUBE_TERMS_URL} target="_blank" rel="noreferrer">
          YouTube Terms of Service
        </a>
        . Google&apos;s handling of your data is described in the{" "}
        <a href={GOOGLE_PRIVACY_URL} target="_blank" rel="noreferrer">
          Google Privacy Policy
        </a>
        .
      </p>

      <h2>What we access and store</h2>
      <ul>
        <li>
          <strong>Google authorization.</strong> With your consent Lumen Cloud requests two scopes: <code>youtube.upload</code> (upload
          videos) and <code>youtube.readonly</code> (read your channel&apos;s ID and title, and your uploaded videos&apos; visibility). The
          OAuth access and refresh tokens are stored encrypted (AES-256-GCM).
        </li>
        <li>
          <strong>YouTube data.</strong> The connected channel&apos;s ID, and for each uploaded video its YouTube video ID, publish time and
          whether YouTube kept it private. The channel title is shown once when you connect and is not stored.
        </li>
        <li>
          <strong>Content you create.</strong> Topics, scripts, titles, descriptions, tags, voice-overs, images and rendered videos, stored in
          the studio&apos;s database and file storage.
        </li>
        <li>
          <strong>Sign-in.</strong> A signed session cookie keeps the operator signed in; a short-lived cookie protects the YouTube connection
          step. No analytics or advertising cookies are used.
        </li>
      </ul>

      <h2>How the data is used and shared</h2>
      <p>
        Data is used only to produce and publish the operator&apos;s own videos. It is never sold and never used for advertising. To do the
        work, Lumen Cloud sends the minimum needed to these services:
      </p>
      <ul>
        <li>Google Gemini: topics and script instructions, to write scripts and metadata.</li>
        <li>Microsoft Edge text-to-speech: narration text, to produce voice-overs.</li>
        <li>Pexels and Pollinations: image and search prompts, to find or generate visuals.</li>
        <li>GitHub Actions: the video&apos;s scenes and, for publishing, a one-hour YouTube access token, to render and upload the video.</li>
        <li>Supabase and Vercel: database, file storage and hosting.</li>
        <li>YouTube: the rendered video and its title, description, tags and visibility.</li>
      </ul>
      <p>No YouTube data is shared with anyone else.</p>

      <h2>Revoking access and deleting data</h2>
      <ul>
        <li>
          <strong>Disconnect</strong> on a channel&apos;s page revokes Lumen Cloud&apos;s access at Google and immediately deletes the stored
          tokens and channel ID.
        </li>
        <li>
          You can also revoke access at any time from the{" "}
          <a href={GOOGLE_PERMISSIONS_URL} target="_blank" rel="noreferrer">
            Google security settings page
          </a>
          . Lumen Cloud then deletes the stored tokens and channel ID as soon as Google reports the access as revoked, the next time it tries
          to use them.
        </li>
        <li>Deleting a project deletes its script, scenes and metadata. Videos already on YouTube are managed in YouTube Studio.</li>
        <li>Ask us to delete all data held about you and we will do so within 7 days.</li>
      </ul>

      <h2>Contact</h2>
      <p>
        {operator.email ? (
          <>
            Questions or deletion requests: <a href={`mailto:${operator.email}`}>{operator.email}</a>.
          </>
        ) : (
          <>Questions or deletion requests: contact {operator.name}.</>
        )}
      </p>
    </>
  );
}
