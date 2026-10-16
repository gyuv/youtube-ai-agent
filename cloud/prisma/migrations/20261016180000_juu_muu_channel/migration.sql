-- The operator asked for a new channel, "Juu-Muu": cute, funny slice-of-life couple comedy with two fixed
-- characters. Created once (idempotent); connect YouTube on its channel page to start posting.
INSERT INTO "Channel" (
  "id", "name", "niche", "targetAudience", "language", "defaultFormat", "defaultPrivacy",
  "defaultScriptPrompt", "defaultVisualPrompt", "postingCron", "postingTimezone",
  "autoPublish", "autopilot", "autopilotVisualSource", "growthGoal", "topicBacklog", "updatedAt"
)
SELECT
  'juumuuchannel000000000001',
  'Juu-Muu',
  'Cute, funny, relatable slice-of-life couple comedy starring Juu (panda boyfriend) and Muu (rabbit girlfriend)',
  'Couples, young adults and anyone who loves wholesome, relatable relationship humour',
  'en',
  'SHORT'::"VideoFormat",
  'PUBLIC'::"PrivacyStatus",
  E'You write for "Juu-Muu", a wholesome relationship-comedy channel with two fixed characters. Never change them.\n'
  || E'- Juu (the boyfriend): head of a cute, expressive PANDA on a human male body; fur and clothes strictly panda colours (black, white, dark greys). Laid-back, a bit clumsy, a gamer, deeply affectionate but sometimes oblivious.\n'
  || E'- Muu (the girlfriend): head of a cute, expressive RABBIT on a human female body; fur and clothes strictly soft rabbit colours (pure white, pastel pinks, creams). Energetic, playfully bossy, highly organised, very loving but easily annoyed by small things.\n'
  || E'Every video is one universally relatable couple moment (fighting over blankets, deciding what to eat, gaming vs. attention, shopping trips, cooking disasters, daily couple struggles). '
  || E'Structure: the hook sets up the situation; the sections are a punchy 4-6 line back-and-forth, written as narration that quotes them ("Muu: ...", "Juu: ..."); the CTA delivers the punchline and asks viewers to tag their partner. '
  || E'Titles are catchy and algorithm-friendly with emojis and end with "| Juu-Muu". Every image prompt must name both designs explicitly: "Juu, a panda-headed human boy in black and white clothes" and "Muu, a rabbit-headed human girl in pink and white clothes", plus their expressions, actions, the cozy setting and lighting.',
  '3D animated cute aesthetic, Pixar/Disney style, vibrant, cozy, cinematic soft lighting, highly expressive animal faces; Juu is a panda-headed human boy in black, white and dark grey clothes; Muu is a rabbit-headed human girl with long white ears in pastel pink, white and cream clothes; vertical 9:16',
  '0 19 * * *',
  'Asia/Kolkata',
  true,
  true,
  'POLLINATIONS'::"VisualSource",
  'SUBSCRIBERS'::"GrowthGoal",
  E'Juu and Muu fight over the blanket at 3 AM\nDeciding what to eat for dinner takes 2 hours\nJust one more game vs. dinner is getting cold\nMuu drags Juu on a shopping trip\nJuu tries to cook a surprise breakfast\nWho controls the TV remote\nJuu forgets their anniversary (almost)\nMuu reorganises Juu''s gaming setup\nRainy day indoors with nothing to do\nJuu tries to take the perfect photo of Muu',
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Channel" WHERE "name" = 'Juu-Muu');
