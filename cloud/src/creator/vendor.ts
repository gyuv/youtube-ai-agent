/**
 * Vendored from https://github.com/Jakeschincariol/youtube-agent-skill (MIT License,
 * Copyright (c) 2026 Jake Schincariol). Regenerate with the script in the PR rather than editing.
 * Skill bodies are the original SKILL.md text; the studio feeds them to Gemini as instructions.
 */

export const SKILL_TEXT: Record<string, { description: string; body: string }> = {
 "yt-script": {
  "description": "Write a YouTube video script from a raw idea - hook options off 21 formulas, scored, then the full spoken script with the retention beats marked. Use whenever the user wants a video script, a hook, an opening line, \"what should I say\", \"write my next video\", or is about to record and does not have the first fifteen seconds yet.",
  "body": "# yt-script\n\nOne idea into a script somebody finishes.\n\nTwo tools live in this folder and both actually run. Use them. Do not eyeball the hook.\n\n```bash\npython3 hookscore.py hooks.txt              # rank your hook options\npython3 hookscore.py --hook \"one line\"      # score a single one\n```\n\n## Before you write\n\n1. Read `~/.claude/youtube/voice.md` if it exists. That is the user's voice profile: how they talk\n   on camera, the words they never use, who they are talking to, what they will not claim. If it\n   does not exist, ask for **three of their own videos**, read or transcribe them, infer the voice,\n   and write the file. A script in the wrong voice is worse than no script, because they have to\n   read it out loud.\n2. Never invent a number, a result or a source. If a figure would strengthen it and you do not have\n   one, ask for it or write the line without it.\n\n## The shape\n\n**The first 15 seconds is the whole job.** It does three things or the video leaks: confirm the\nclick the title promised, open a question the viewer cannot close, and prove the payoff exists.\n\n1. **Hook.** Write FIVE against [the 21 formulas](hooks.json), run them through `hookscore.py`,\n   keep the top two, and show the user both with their scores. Never hand over one hook.\n2. **The turn** (0:15-0:45). Say what the video is going to do, in one sentence, and start doing it.\n   No channel intro, no \"before we get started\", no subscribe pitch. Those are the single most\n   common cause of the 0:30 cliff.\n3. **The body.** One idea per beat. Mark each beat with what is ON SCREEN, not just what is said -\n   a talking head with nothing to look at is a podcast.\n4. **The payoff.** Deliver the thing the hook promised, explicitly, and say that you are delivering\n   it: \"that is the prompt, it is in the description\".\n5. **The close.** One ask. Not three.\n\n## What to hand back\n\n- the two best hooks with their scored panels\n- the script, beat by beat, with `[ON SCREEN: ...]` on every beat\n- the runtime estimate at 150 words per minute\n- one line naming which formula the winning hook used and why it fits this idea\n\n## The gate\n\nNothing here publishes. This skill writes and you publish. Every output ends in a block the user\ncopies, and the last line of every run is the question: **ship it, or change it?**"
 },
 "yt-package": {
  "description": "Write and lint the title and thumbnail for a YouTube video as one pairing, checking truncation, duplication and vagueness before publish. Use for \"title ideas\", \"what should I call this\", \"thumbnail text\", \"my CTR is bad\", packaging, or any request to rename or repackage an existing video.",
  "body": "# yt-package\n\nThe title and the thumbnail are ONE unit. Writing them separately is why most packaging fails: the\nthumbnail repeats the title, and half the click surface says the same thing twice.\n\n```bash\npython3 title.py --title \"...\" --thumb \"AI RAN IT\"\npython3 title.py titles.txt            # one per line, ranked\n```\n\n## Before you write\n\n1. Read `~/.claude/youtube/voice.md` if it exists. That is the user's voice profile: how they talk\n   on camera, the words they never use, who they are talking to, what they will not claim. If it\n   does not exist, ask for **three of their own videos**, read or transcribe them, infer the voice,\n   and write the file. A script in the wrong voice is worse than no script, because they have to\n   read it out loud.\n2. Never invent a number, a result or a source. If a figure would strengthen it and you do not have\n   one, ask for it or write the line without it.\n\n## Rules the tool enforces, and why\n\n- **60 characters** is where desktop search truncates, **40** is a mobile home feed. Both are\n  reported because they fail differently: a desktop cut loses the tail, a mobile cut can lose the\n  subject.\n- **The thumbnail must not repeat the title.** Different words, same promise.\n- **Three words maximum on the thumbnail.** At feed size a fourth word is a grey smear.\n- **A number, a name or a date** beats every adjective available to you.\n- **Two all-caps words is the ceiling** before a title reads as spam.\n\n## Write ten, keep two\n\nGenerate ten titles, run them all through `title.py`, show the user the top three with their scores\nand the specific issue on each. For the winner, write the thumbnail brief: the expression, the\nframing, the three words, and what the background has to do to hold contrast at feed size.\n\n## The gate\n\nNothing here publishes. This skill writes and you publish. Every output ends in a block the user\ncopies, and the last line of every run is the question: **ship it, or change it?**"
 },
 "yt-seo": {
  "description": "Write the description, tags and search-facing text for a YouTube video, aimed at the query a real person types. Use for \"write my description\", \"tags\", \"SEO\", \"help this video get found\", \"nobody is finding this\".",
  "body": "# yt-seo\n\nSearch is a smaller lever than packaging and a bigger one than people think for evergreen videos.\nFor a video aimed at the subscriber feed, say so and spend the effort on `/yt-package` instead.\n\n## Before you write\n\n1. Read `~/.claude/youtube/voice.md` if it exists. That is the user's voice profile: how they talk\n   on camera, the words they never use, who they are talking to, what they will not claim. If it\n   does not exist, ask for **three of their own videos**, read or transcribe them, infer the voice,\n   and write the file. A script in the wrong voice is worse than no script, because they have to\n   read it out loud.\n2. Never invent a number, a result or a source. If a figure would strengthen it and you do not have\n   one, ask for it or write the line without it.\n\n## The description\n\n- **The first two lines are the only ones anyone reads.** They show above \"...more\" and they are\n  the search snippet. Say what the video gives them, in the words they would have typed.\n- Then the link or the resource, if there is one, so it is above the fold.\n- Then chapters (`/yt-chapters` writes them).\n- Then the long version: what is covered, who it is for, what it assumes.\n\n## Tags, honestly\n\nTags are a weak signal and YouTube has said so. Use them for disambiguation - spellings, the tool\nnames, the abbreviations people actually type - and stop. Fifteen is plenty. A wall of tags is not\na strategy and stuffing unrelated ones is against the terms.\n\n## The query test\n\nBefore handing anything over, write the three search queries this video should win, and check the\ntitle and first two description lines contain the words in those queries. If they do not, the\nproblem is the title, not the description.\n\n## The gate\n\nNothing here publishes. This skill writes and you publish. Every output ends in a block the user\ncopies, and the last line of every run is the question: **ship it, or change it?**"
 },
 "yt-edit": {
  "description": "Turn a raw recording's transcript into an edit decision list - dead air, filler cues and retakes, with timecodes. Use for \"edit this\", \"cut the dead space\", \"tighten this video\", \"I rambled\", or any request to shorten footage from a transcript.",
  "body": "# yt-edit\n\nAn edit decision list from a timestamped transcript. It prints the cuts. You apply them.\n\n```bash\npython3 deadair.py transcript.srt              # srt, vtt or whisper json\npython3 deadair.py transcript.srt --floor 0.35 --json\n```\n\nNo transcript yet? Ask for one, or produce one first - `whisper`, `faster-whisper`, or the caption\ntrack YouTube generates on an unlisted upload all work. Do not guess at timings.\n\n## What it finds\n\n- **DEAD** - gaps longer than the floor, trimmed from the MIDDLE so both sides keep a breath.\n  Cutting flush against speech is what makes a tightened take sound gasping.\n- **FILLER** - cues that are nothing but \"um\", \"so yeah\", \"basically\".\n- **REPEAT** - a sentence restarted. Compared against the last cue that was actually speech, not\n  the literal previous cue, because most retakes have an \"um\" between the two attempts.\n\n## What it will not do\n\nIt does not touch media. It has no opinion about your B-roll. A 40% cut on the report is a 40% cut\nof SPEECH, and if the video has a long silent demo in it that number is wrong - check the report\nagainst the footage before you trust the runtime at the bottom.\n\n## The gate\n\nNothing here publishes. This skill writes and you publish. Every output ends in a block the user\ncopies, and the last line of every run is the question: **ship it, or change it?**"
 },
 "yt-chapters": {
  "description": "Write YouTube chapters from a transcript, validated against YouTube's own rules so they actually render. Use for \"add chapters\", \"timestamps\", \"break this video into sections\".",
  "body": "# yt-chapters\n\n```bash\npython3 chapters.py transcript.srt --target 8\n```\n\n## The rules, which are not optional\n\nA chapter list that breaks any of these silently does not become chapters at all - the block just\nsits in the description doing nothing:\n\n- The first entry must be **00:00**.\n- There must be **at least three**.\n- Each must be **at least 10 seconds** long.\n\nThe tool checks all three and tells you when a list is invalid rather than letting you paste it.\n\n## Retitle every line\n\n`chapters.py` finds the BOUNDARIES well - it scores the pauses you actually took by how much the\nvocabulary shifts across them. The titles it emits are the topic words, and they are a draft. A\nchapter called \"Thumbnails Titles Packaging\" is a placeholder. Rewrite each one as the promise of\nthat section, in the user's voice, three to five words.\n\nChapters are also a retention diagnostic: if a section cannot be named in five words, it is two\nsections or it is filler.\n\n## The gate\n\nNothing here publishes. This skill writes and you publish. Every output ends in a block the user\ncopies, and the last line of every run is the question: **ship it, or change it?**"
 },
 "yt-shorts": {
  "description": "Find the Shorts hiding inside a long video and write them, using the transcript to pick self-contained moments. Use for \"cut this into shorts\", \"clip this\", \"repurpose this video\", \"what should I clip\".",
  "body": "# yt-shorts\n\nA Short cut out of a long video is not a clip of the best moment. It is a moment that **survives\nwithout the video around it**, which is a much smaller set.\n\n## Picking\n\nRead the transcript and find spans of 20-55 seconds where all three are true:\n\n1. It opens on a complete thought. If the first sentence needs the previous minute, it is not a Short.\n2. There is a turn in it - a claim, then something that complicates or proves it.\n3. It ends on a line, not a trail-off.\n\nRank the candidates and show the user the top five with their timecodes and first line, so they can\nreject one without reading the whole transcript.\n\n## Writing each one\n\n- **A NEW first line.** The long video's line assumes context this viewer does not have. Write the\n  replacement and run it through `../yt-script/hookscore.py`.\n- **On-screen text for the first two seconds**, different words from the spoken line.\n- **A loop point**: what the last line sets up so the first line answers it.\n- Vertical framing note - what gets cropped out of a 16:9 frame and whether that matters.\n\n## The gate\n\nNothing here publishes. This skill writes and you publish. Every output ends in a block the user\ncopies, and the last line of every run is the question: **ship it, or change it?**"
 },
 "yt-retention": {
  "description": "Read a YouTube Studio audience-retention export and find where viewers actually leave, then say what to change. Use for \"why do people stop watching\", \"my retention is bad\", a pasted retention chart or CSV, or \"fix my pacing\".",
  "body": "# yt-retention\n\nThe retention graph is the only honest feedback YouTube gives you. Almost nobody exports it.\n\n```bash\npython3 retention.py retention.csv --duration 600\npython3 retention.py retention.csv --transcript transcript.srt\n```\n\nGetting the file: Studio -> a video -> Analytics -> Engagement -> the audience-retention chart ->\nthe download icon -> \"Audience retention\".\n\n## Three different problems\n\n- **HOOK LEAK** - what is lost in the first 30 seconds. Under 25% is healthy. This is always the\n  first thing to fix and it is always the first fifteen seconds of script, never the edit.\n- **CLIFFS** - single steep drops. A cliff is a moment: a topic change with no signposting, a\n  sponsor read, a long setup. With `--transcript` the tool prints what was being said there, which\n  is what makes the report actionable instead of interesting.\n- **SLIDE** - the steady bleed across the middle. A flat slide is pacing. The fix is cutting, not\n  rewriting.\n\n## What to hand back\n\nName the single biggest leak and one change for it. Not a list of five. Then, only if asked, the\nrest. And if the hook leak is healthy and the slide is flat, say the video is fine and the problem\nis packaging - send them to `/yt-package`.\n\n## The gate\n\nNothing here publishes. This skill writes and you publish. Every output ends in a block the user\ncopies, and the last line of every run is the question: **ship it, or change it?**"
 },
 "yt-plan": {
  "description": "Plan a week or a month of YouTube uploads - what to post, when, and in what order, sized to the creator's actual capacity. Use for \"plan my week\", \"content calendar\", \"what should I post\", \"I have no idea what to make next\".",
  "body": "# yt-plan\n\nA plan that does not fit the week is a list of regrets. Ask two questions before writing anything:\n**how many hours do you actually have**, and **what is already half-made**.\n\n## Before you write\n\n1. Read `~/.claude/youtube/voice.md` if it exists. That is the user's voice profile: how they talk\n   on camera, the words they never use, who they are talking to, what they will not claim. If it\n   does not exist, ask for **three of their own videos**, read or transcribe them, infer the voice,\n   and write the file. A script in the wrong voice is worse than no script, because they have to\n   read it out loud.\n2. Never invent a number, a result or a source. If a figure would strengthen it and you do not have\n   one, ask for it or write the line without it.\n\n## The shape of a week\n\n- **One anchor.** The video the week is for. It gets the most time and it goes out on the day the\n  channel's own analytics say is best - ask for that, do not assume Tuesday.\n- **One cheap one.** Built from something that exists: a clip, a reaction, a follow-up to the\n  comment that got the most replies last week.\n- **Shorts from the anchor.** Three, cut from the long video, not written separately. `/yt-shorts`\n  finds them.\n\nThree uploads on a seven-day week, not seven. A plan that posts daily is not a plan anyone\nrecognises, and the empty days are what make the filled ones survive a bad week.\n\n## What to hand back\n\nA table: day, format, working title, the one sentence it promises, and what already exists for it.\nThen the honest line at the bottom - how many hours this costs, and what to drop first if the week\ngoes wrong.\n\n## The gate\n\nNothing here publishes. This skill writes and you publish. Every output ends in a block the user\ncopies, and the last line of every run is the question: **ship it, or change it?**"
 },
 "yt-viral": {
  "description": "Find what is actually working in the user's niche on YouTube and rank it by how far each video beat its own channel, then name the formula. Use for \"what's working right now\", \"find viral videos in my niche\", \"why did this blow up\", competitor research, or a swipe file.",
  "body": "# yt-viral\n\nRaw view counts rank channel size, not ideas. This ranks by **multiple over each channel's own\nmedian**, which is the only version of the question that is about the video.\n\n```bash\npython3 swipe.py collected.json --min 2.0\n```\n\n## Collecting the input\n\nYou need at least **four videos per channel** or a median means nothing, and the tool will skip the\nchannel and tell you it did. Collect them however the user prefers - `yt-dlp --flat-playlist -J`\nagainst a channel URL is the fastest, the public page works, a manual list works.\n\n```json\n[{\"channel\":\"...\",\"title\":\"...\",\"views\":412000,\"url\":\"...\",\"duration\":613}]\n```\n\n**Read, do not scrape.** Public listings only, never a logged-in session, never the user's own\naccount credentials.\n\n## Reading the output\n\nThe multiple is the signal. The formula line is a judgement about the TITLE, matched against\n[the 21 formulas](../yt-script/hooks.json) - it is not a claim about why the video worked, and you\nshould say so when you present it.\n\nWhat to hand back: the top five with their multiples, the formula each used, and the ONE structural\nthing they share. Then the harder line - which of those the user could actually make this week, in\ntheir voice, with what they have.\n\n## The gate\n\nNothing here publishes. This skill writes and you publish. Every output ends in a block the user\ncopies, and the last line of every run is the question: **ship it, or change it?**"
 },
 "yt-audit": {
  "description": "Audit a YouTube channel end to end - packaging, consistency, the first fifteen seconds, and what to fix first. Use for \"audit my channel\", \"why isn't my channel growing\", \"review my videos\", or a pasted channel URL.",
  "body": "# yt-audit\n\nAn audit that lists twenty problems is a way of avoiding the one that matters. This ends in ONE fix.\n\n## Before you write\n\n1. Read `~/.claude/youtube/voice.md` if it exists. That is the user's voice profile: how they talk\n   on camera, the words they never use, who they are talking to, what they will not claim. If it\n   does not exist, ask for **three of their own videos**, read or transcribe them, infer the voice,\n   and write the file. A script in the wrong voice is worse than no script, because they have to\n   read it out loud.\n2. Never invent a number, a result or a source. If a figure would strengthen it and you do not have\n   one, ask for it or write the line without it.\n\n## What to look at, in this order\n\n1. **The last ten titles, as a set.** Read them as a list, the way the channel page shows them. Do\n   they promise different things? Run them through `../yt-package/title.py`. A channel where every\n   title is the same shape has a format problem, not a title problem.\n2. **The thumbnails, at feed size.** Shrink them. What survives? If three of them are unreadable at\n   that size, that is the fix and nothing else matters yet.\n3. **The first fifteen seconds of the three most recent.** Transcribe them and score with\n   `../yt-script/hookscore.py`. This is where most channels lose.\n4. **Upload rhythm.** Not frequency - CONSISTENCY. Six videos in one week and then nothing for a\n   month is worse than one a fortnight forever.\n5. **The retention shape**, if they can export it. `/yt-retention`.\n\n## What to hand back\n\n- The single biggest fix, named, with what to do this week.\n- Three things that are already working, so they do not break them. Be specific; \"your energy is\n  good\" is not an observation.\n- What NOT to do yet, and why.\n\nNever open an audit with praise you do not mean, and never end one with a list of twenty things.\n\n## The gate\n\nNothing here publishes. This skill writes and you publish. Every output ends in a block the user\ncopies, and the last line of every run is the question: **ship it, or change it?**"
 },
 "yt-comment": {
  "description": "Draft replies to YouTube comments in the creator's voice, triaged by which ones are worth answering. Use for \"reply to my comments\", \"handle the comment section\", \"someone asked X\", or a pasted comment thread.",
  "body": "# yt-comment\n\nThe comment section is a retention surface, not a chore. Replies in the first few hours are what\ndecide whether a thread becomes a conversation other people read.\n\n## Before you write\n\n1. Read `~/.claude/youtube/voice.md` if it exists. That is the user's voice profile: how they talk\n   on camera, the words they never use, who they are talking to, what they will not claim. If it\n   does not exist, ask for **three of their own videos**, read or transcribe them, infer the voice,\n   and write the file. A script in the wrong voice is worse than no script, because they have to\n   read it out loud.\n2. Never invent a number, a result or a source. If a figure would strengthen it and you do not have\n   one, ask for it or write the line without it.\n\n## Triage first, always\n\nSort what the user pastes into four piles and say how many are in each before writing anything:\n\n1. **Questions** - answer them. These are your next video's topics, so note the repeats.\n2. **Corrections** - if they are right, say so plainly and thank them. Never argue a fact you\n   cannot check.\n3. **Praise** - reply to a few, briefly, with something specific from their comment. A wall of\n   identical \"thank you!\" replies reads as automated because it is.\n4. **Bait** - do not reply. Say so and move on. Never write a comeback, however deserved.\n\n## Writing the reply\n\n- Under 30 words. A long reply in a comment thread is a blog post nobody asked for.\n- Answer the actual question in the first sentence.\n- One question back, only when it is real.\n- No emoji unless the user's own replies use them. Check their voice file.\n- Never promise a video you have not agreed to make.\n\n## The heart and the pin\n\nSay which ONE comment to pin and why. Pin the question the most people also have, not the nicest\none. Heart generously - it costs nothing and it is visible.\n\n## The gate\n\nNothing here publishes. This skill writes and you publish. Every output ends in a block the user\ncopies, and the last line of every run is the question: **ship it, or change it?**"
 }
};

export const HOOKS = {
 "version": "1.0",
 "note": "21 hook formulas for YouTube. A YouTube hook is the first 15 seconds and it does three jobs: confirm the click the title promised, raise a question the viewer cannot close, and prove the payoff exists. A hook that only does the third is a summary and it leaks. Every formula here carries the shape, a worked example, the failure mode, and the patterns hookscore.py classifies transcribed speech against.",
 "rules": [
  "Confirm the title in the first sentence. A hook that ignores its own title is why people leave at 0:08.",
  "One idea. A hook carrying two promises keeps neither.",
  "Specific beats big. '400 to 200,000 in seven months' outperforms 'massive growth'.",
  "Show the artifact inside 20 seconds if you promised one.",
  "Never open with who you are. The subscribe pitch has not been earned yet."
 ],
 "hooks": [
  {
   "id": "the-statistic",
   "name": "The Statistic",
   "shape": "A number the viewer did not know, stated flat, then the consequence.",
   "example": "97% of the people who start a channel quit before video 30. Here is what the other 3% do differently.",
   "fails_when": "Dies if the number is vague or unverifiable. Say the source out loud.",
   "match": [
    "\\b\\d+(\\.\\d+)?\\s?%",
    "\\b\\d+ (out of|in) \\d+\\b",
    "\\b\\d{2,}(,\\d{3})+\\b"
   ]
  },
  {
   "id": "someone-elses-result",
   "name": "Someone Else's Result",
   "shape": "A named person's outcome, then the mechanism.",
   "example": "This channel went from 400 subscribers to 200,000 in seven months on one format. I mapped it.",
   "fails_when": "Do not invent the number. If you cannot name the channel, use a different formula.",
   "match": [
    "\\bthis (channel|guy|creator|account)\\b",
    "\\bwent from .* to\\b",
    "\\bin (a|one|two|three|\\d+) (week|month|year)s?\\b"
   ]
  },
  {
   "id": "the-mistake",
   "name": "The Mistake",
   "shape": "Name the error the viewer is probably making right now.",
   "example": "Your first 30 seconds are why nobody finishes your videos. It is not the topic.",
   "fails_when": "Only works if the mistake is common and the viewer can check it in one second.",
   "match": [
    "\\byou('re| are) (probably |still )?(doing|making)\\b",
    "\\bthe (mistake|reason) (everyone|most people|nobody)\\b",
    "\\bstop (doing )?\\b"
   ]
  },
  {
   "id": "contrarian-flip",
   "name": "Contrarian Flip",
   "shape": "State the accepted advice, then reject it.",
   "example": "Everyone says post daily. I posted once a week for a year and tripled the channel.",
   "fails_when": "Needs evidence in the next 15 seconds or it reads as contrarian for its own sake.",
   "match": [
    "\\beveryone (says|thinks|tells you)\\b",
    "\\bis (actually )?wrong\\b",
    "\\bnobody (tells|talks about)\\b"
   ]
  },
  {
   "id": "the-reveal",
   "name": "The Reveal",
   "shape": "Promise a specific thing will be shown, then show it.",
   "example": "I am going to show you the exact prompt, on screen, that wrote this video.",
   "fails_when": "You have to actually show it, early. A reveal at 8:00 is a retention cliff at 1:00.",
   "match": [
    "\\bI('m| am) going to show you\\b",
    "\\bhere('s| is) (the|exactly)\\b",
    "\\bon screen\\b"
   ]
  },
  {
   "id": "the-superlative",
   "name": "The Superlative",
   "shape": "The single best/worst/fastest of a category.",
   "example": "This is the fastest way to turn one long video into thirty Shorts.",
   "fails_when": "Superlatives are cheap. Earn it by naming what it beat.",
   "match": [
    "\\bthe (best|worst|fastest|easiest|only)\\b",
    "\\bnumber one\\b"
   ]
  },
  {
   "id": "the-clock",
   "name": "The Clock",
   "shape": "Bound the payoff in time.",
   "example": "In the next six minutes you will have a working title, thumbnail and script for your next video.",
   "fails_when": "The clock has to be true. Overrun it and the next video's hook is not believed.",
   "match": [
    "\\bin (the next )?\\d+ (seconds|minutes|hours)\\b",
    "\\bby the end of this video\\b",
    "\\bunder \\d+\\b"
   ]
  },
  {
   "id": "i-tried-it",
   "name": "I Tried It",
   "shape": "First-person experiment with a stated cost.",
   "example": "I let an AI run my channel for 30 days. I did not touch the uploads.",
   "fails_when": "Needs a real cost - time, money, risk - or there is no stake.",
   "match": [
    "\\bI (tried|spent|tested|let|gave)\\b",
    "\\bfor \\d+ (days|weeks|months)\\b",
    "\\bso you don'?t have to\\b"
   ]
  },
  {
   "id": "the-question",
   "name": "The Question",
   "shape": "Ask the exact question the viewer typed into search.",
   "example": "Why do your videos die at 30 seconds when the topic is fine?",
   "fails_when": "Must be the viewer's question, not yours. Pull it from your own comments.",
   "match": [
    "^(why|how|what|when|should|can|do|does|is)\\b",
    "\\?\\s*$"
   ]
  },
  {
   "id": "the-before-after",
   "name": "Before and After",
   "shape": "Two states, one cut between them.",
   "example": "This was my thumbnail. This is my thumbnail now. Same video, four times the click-through.",
   "fails_when": "Only works with a visual. Do not use it on a talking-head-only video.",
   "match": [
    "\\bbefore\\b.*\\bafter\\b",
    "\\bthis was\\b.*\\bthis is\\b",
    "\\bused to\\b"
   ]
  },
  {
   "id": "the-teardown",
   "name": "The Teardown",
   "shape": "Take a real thing apart in public.",
   "example": "I pulled the nine most-viewed AI videos of the month and broke down what the titles share.",
   "fails_when": "Name what you pulled and how many. A teardown of one example is an anecdote.",
   "match": [
    "\\b(broke|break|breaking) (it )?down\\b",
    "\\bteardown\\b",
    "\\banalys(ed|ed|is|e)\\b",
    "\\bI pulled\\b"
   ]
  },
  {
   "id": "the-stack",
   "name": "The Stack",
   "shape": "Two named tools combined into one outcome.",
   "example": "Claude plus your YouTube Studio export gives you next week's upload schedule in one prompt.",
   "fails_when": "Both tools must be nameable and the outcome must need both.",
   "match": [
    "\\b\\w+ (plus|\\+) \\w+\\b",
    "\\bcombine\\b",
    "\\btogether\\b"
   ]
  },
  {
   "id": "the-warning",
   "name": "The Warning",
   "shape": "A cost the viewer is about to pay.",
   "example": "Do not upload another video until you check this one setting.",
   "fails_when": "If the cost is small the hook is a lie. Reserve it.",
   "match": [
    "\\bdo not\\b",
    "\\bdon'?t (upload|post|publish|start)\\b",
    "\\bbefore you\\b",
    "\\bstop\\b"
   ]
  },
  {
   "id": "the-list",
   "name": "The List",
   "shape": "A counted set, with the count in the first line.",
   "example": "Seven things I would do differently if I started a channel in 2026.",
   "fails_when": "The count must be exact and every item must be different in kind.",
   "match": [
    "^\\d+ \\w+",
    "\\b(here are|these are) \\d+\\b"
   ]
  },
  {
   "id": "the-receipt",
   "name": "The Receipt",
   "shape": "Show the artifact first, explain second.",
   "example": "This is the analytics page. This video did 40% of the channel's watch time. Here is why.",
   "fails_when": "Requires a real screenshot. A described receipt is not a receipt.",
   "match": [
    "\\bthis is (the|my)\\b",
    "\\bscreenshot\\b",
    "\\bproof\\b",
    "\\breceipts?\\b"
   ]
  },
  {
   "id": "the-insider",
   "name": "The Insider",
   "shape": "Information from inside a system.",
   "example": "YouTube tells you which videos are underperforming. Almost nobody opens the report.",
   "fails_when": "Do not claim insider access you do not have.",
   "match": [
    "\\b(nobody|almost nobody|most people) (knows?|opens?|uses?)\\b",
    "\\bhidden\\b",
    "\\bburied\\b"
   ]
  },
  {
   "id": "the-impossible",
   "name": "The Impossible Claim",
   "shape": "State something that sounds untrue, then prove it.",
   "example": "You can write, title, thumbnail and schedule a week of videos without opening a single editor.",
   "fails_when": "The proof has to start within 20 seconds or it reads as clickbait.",
   "match": [
    "\\bwithout\\b",
    "\\bnever\\b",
    "\\bin one\\b",
    "\\bzero\\b"
   ]
  },
  {
   "id": "the-comparison",
   "name": "The Comparison",
   "shape": "Two named options, one winner.",
   "example": "I wrote the same video three ways. One of them held 62% and the other two did not.",
   "fails_when": "Say the losing option out loud. A comparison with no loser is an advert.",
   "match": [
    "\\bvs\\.?\\b",
    "\\bversus\\b",
    "\\bwhich (one )?(is|wins)\\b",
    "\\bsame .* (three|two) ways\\b"
   ]
  },
  {
   "id": "the-origin",
   "name": "The Origin",
   "shape": "Where a result actually came from.",
   "example": "Every video on this channel starts in the same 12-line file. Here it is.",
   "fails_when": "Works once per channel. It is a reveal about you, and you only have one.",
   "match": [
    "\\bevery (video|post) .* starts\\b",
    "\\bit all (starts|started)\\b",
    "\\bthe (real )?reason\\b"
   ]
  },
  {
   "id": "the-deadline",
   "name": "The Deadline",
   "shape": "Something is changing on a date.",
   "example": "The old description format stops mattering this month. Here is what replaces it.",
   "fails_when": "Only use with a real, checkable date. This is the fastest formula to lose trust with.",
   "match": [
    "\\b(this|next) (week|month|year)\\b",
    "\\bis changing\\b",
    "\\bno longer\\b",
    "\\bas of\\b"
   ]
  },
  {
   "id": "the-direct-address",
   "name": "The Direct Address",
   "shape": "Name the exact viewer in the first six words.",
   "example": "If you have under a thousand subscribers, this is the only video you need this week.",
   "fails_when": "Narrow beats broad. 'If you make videos' addresses nobody.",
   "match": [
    "^if you\\b",
    "\\bfor (anyone|everyone|people) who\\b",
    "\\byou specifically\\b"
   ]
  }
 ]
} as const;

export const VOICE_TEMPLATE = "# voice.md\n\nCopy this to `~/.claude/youtube/voice.md` and fill it in. Every skill in this pack reads it. Ten\nminutes here is worth more than any prompt you will ever write, because on YouTube you have to say\nthe words out loud and a script in the wrong voice is unreadable on camera.\n\n## Who I am talking to\n\nOne person. Name them properly - not \"creators\", but \"someone with under a thousand subs who has\nmade nine videos and cannot work out why none of them break 400 views\".\n\n## How I actually talk\n\nPaste the transcript of your best-performing video here, or three of them. Not what you wish you\nsounded like.\n\n## Words I never use\n\nThe ones that are not mine. Be specific: \"unlock\", \"game-changer\", \"dive in\", \"let's get into it\".\n\n## Words I do use\n\nYour tics. The phrases that are yours. Keep them.\n\n## What I will not claim\n\nNumbers I cannot show, results that are not mine, tools I have not used. Write them down so the\nskills refuse them for you instead of you catching it in the edit.\n\n## My format\n\nLength, how a video opens, whether there is an intro, whether you swear, whether you appear on\ncamera, what the desk looks like.\n";
