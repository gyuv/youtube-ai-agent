# Applying for the YouTube API Services audit

Google Cloud projects created after 28 July 2020 have every `videos.insert` upload locked as
**private** until the project passes the YouTube API Services compliance audit. The studio flags
such videos (see "locked private" in the README). This guide gets your project through the audit.

The form: <https://support.google.com/youtube/contact/yt_api_form>. Review usually takes a few
weeks, sometimes longer. Google follows up by email from the address on the form.

Replace everything in `<angle brackets>` with your own details. `<app>` is your Vercel address,
for example `lumen-cloud.vercel.app`.

## 1. Before you open the form (about 15 minutes)

1. **Vercel → Settings → Environment Variables** (Production): set
   - `PUBLIC_OPERATOR_NAME`: your name, or your firm's name.
   - `PUBLIC_CONTACT_EMAIL`: an address you read. It is shown publicly on the privacy page.

   Then redeploy.
2. Open `https://<app>/privacy` and `https://<app>/terms` in a private browser window. Both must load
   **without** the studio password and show your name and email.
3. **Google Cloud Console → Google Auth Platform → Branding** (the OAuth consent screen):
   - App name: `Lumen Cloud`, or any name that does **not** contain "YouTube".
   - App home page: `https://<app>/login`
   - Privacy policy: `https://<app>/privacy`
   - Terms of service: `https://<app>/terms`
   - Authorised domain: `<app>` (your Vercel domain, or your custom domain if you use one).
4. **Audience**: publishing status **In production**, not *Testing*. This also stops refresh
   tokens from expiring every 7 days.
5. **Data access**: only `youtube.upload` and `youtube.readonly` should be listed.
6. Note your **project number**: Cloud Console → the project dashboard's *Project info* card. It is
   the number, not the project ID.
7. Recommended while the audit runs: on each channel with autopilot, turn on **Review mode**, so no
   video is uploaded until you approve it. Reviewers look for human oversight of automated uploads,
   and you can truthfully say every upload is approved by a person.

## 2. Screenshots to attach

Take these from the live site and from Google:

1. `https://<app>/login`: the sign-in page with the *Privacy Policy*, *Terms of Use* and
   *Uses YouTube API Services* links at the bottom.
2. `https://<app>/privacy`, full page.
3. `https://<app>/terms`, full page.
4. The Google consent screen you see when you click **Connect YouTube** on a channel, showing the
   app name and the two permissions.
5. A channel page showing **Connected to …**, the **Disconnect** button and the Google security
   settings link.
6. A project page with the finished video: the preview, *YouTube details* (title, description,
   visibility) and **Dispatch Cloud Render**.
7. Optional: the *Autopilot* panel with **Review mode** on.

## 3. The form, section by section

Wording on the form changes from time to time. Match each answer below to the closest field.

### Request type

Choose the **compliance audit** option (the wording is close to "I want to complete an audit…").
You do **not** need extra quota: the default 10,000 units a day covers about 6 uploads. If the form
insists on quota numbers, enter the defaults (10,000 per day).

### Organisation or individual

- Filing as: **Individual**, unless you run it through a registered firm.
- Name, address, country and email: your real details, matching the privacy page.
- Organisation website: `https://<app>/login`

**What does your organisation do and how is it related to YouTube?**

> I run a small YouTube channel and built a private studio, "Lumen Cloud", to produce its
> videos. It drafts scripts, creates narration and visuals, renders the video, and uploads it to my
> own channel through the YouTube Data API. It is used only by me, only for channels I own. It does
> not display, search, download or analyse other people's YouTube content.

- Primary audience: YouTube creators or content publishers, meaning yourself.
- Revenue model: none for the tool. If your channel is monetised, say the *channel* earns through
  the YouTube Partner Program and the tool itself is not sold.
- Ads over YouTube content: **No**.
- Google or YouTube partner manager: **No**, unless you have one.

### API client

| Field | Answer |
| --- | --- |
| API client name | `Lumen Cloud` |
| Name contains "YouTube"? | No |
| Primary access URL | `https://<app>/login` |
| Privacy policy URL | `https://<app>/privacy` |
| Terms of service URL | `https://<app>/terms` |
| Is the API client public? | **No: internal use only, single operator** |

**Access instructions**

> Lumen Cloud is a password-protected internal tool with a single operator account. The public
> pages are the sign-in page, the privacy policy and the terms linked above. I can provide a
> reviewer password on request, and screenshots of every screen that uses the API are attached.

If Google asks for the password, send it. Change `STUDIO_PASSWORD` in Vercel once the review is
over: anyone with it can publish to your channel.

### Google Cloud project and use of the API

- Number of projects: **1**. Project number: `<project number>`.
- Use case: **uploading videos to my own channel**.
- Authorisation: **OAuth 2.0, web server flow**. Scopes: `youtube.upload` and `youtube.readonly`.

**Endpoints used** (tick only these):

| Endpoint | Why | Quota per call |
| --- | --- | --- |
| `videos.insert` | upload the finished video to my channel | 1,600 |
| `videos.list` (`part=status`, my own video IDs) | confirm the visibility YouTube applied after upload, and once after a scheduled publish time | 1 |
| `channels.list` (`mine=true`, `part=snippet`) | identify which channel was connected, once per connection | 1 |

**Expected volume**

> 1 to 3 uploads a day, never more than 6. About 1,600 to 9,700 units a day, within the
> default 10,000.

**How YouTube data is stored and protected**

> The app stores the OAuth refresh and access tokens encrypted with AES-256-GCM, the connected
> channel's ID, and for each video it uploaded the video ID, publish time and whether YouTube kept it
> private. It does not store any other YouTube data and does not share YouTube data with anyone.
> "Disconnect" revokes the grant at Google (oauth2.googleapis.com/revoke) and deletes the tokens
> immediately. If the user revokes access in Google's security settings, the app deletes the stored
> tokens as soon as Google reports the grant as revoked. The privacy policy explains all of this,
> links to the Google Privacy Policy and the Google security settings page, and the terms state that
> users agree to the YouTube Terms of Service.

**How uploads are made (automation and AI)**

Answer this truthfully. The studio can write and publish on a schedule, and reviewers will ask.

> Videos are produced from my own topics with AI-assisted scripts, narration and visuals. Every
> upload sets `status.containsSyntheticMedia = true`, which is YouTube's altered or synthetic content
> disclosure. Uploads go only to my own channel, at most a few a day on a fixed posting schedule. A
> review mode holds every video until I approve it in the studio, and I use it. Titles, descriptions
> and tags are checked against YouTube's limits and edited by me before publishing.

### Attachments

Upload the screenshots from section 2.

## 4. After you submit

- You get an automatic confirmation. Answer any follow-up email quickly and consistently with the
  form.
- Don't rename the Cloud project or change the OAuth client while the review is open.
- Once approved, new uploads keep the visibility you choose. Videos that were already locked stay
  private: download each project's rendered MP4, upload it in YouTube Studio, then delete the
  locked copy.
- Use **Check visibility** on a project after your first upload following approval. The locked
  warning should no longer appear.
- If the audit is refused, the email says which policy failed. Fix that point and resubmit.
