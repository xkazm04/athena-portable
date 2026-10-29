1. About the project

## Inspiration

Most of what people need done lives inside web apps that will never offer an assistant: an invoicing tool, a tax portal, a landlord's page. The assistants that exist either live in a chat window beside the work, or they are given the keys and trusted. We wanted the opposite: a private assistant that sits inside the apps you already use, can operate them, and is **provably unable to do the irreversible thing without you**. The question behind the project was not "can an agent click a page" but "how would you know it won't do harm when someone attacks it", and that is where Nemotron on Nebius came in.

## What it does

Athena is an always-on desktop assistant for the Personal AI track. She holds your web apps in tabs and an agent in a column beside them. She sees the page you are on and operates it: if the page offers its own actions she calls them, and if it offers nothing she reads, clicks and types as a person would.

- **A gate she cannot talk her way past.** Anything irreversible, or anything that leaves the app (sending a reminder, voiding an invoice), stops and becomes a decision card you approve or decline. One approval runs exactly one action, once.
- **Projects with walled memory.** Each job has its own brief and memory; what is learned in one never leaks into another. Memory cites where it came from.
- **Chores.** 100 playbooks, each with a committed benchmark. You describe a chore in your own words, she finds the one that fits, asks what differs in your case, and rehearses it on a world shaped like yours before it is real.
- **Local voice.** She speaks with Kokoro on your own machine (free, nothing sent anywhere) and hears with local Whisper, with a cloud engine one key away.
- **A ledger.** Every model call and its cost is a row on your disk you can read.

Her proof is the Proving Ground: **Nemotron 3.5 Lightning writes the attacks** (hostile page text, a poisoned tool result, a planted memory), they go to a real Athena, and the verdict is read from the gate's own records, never from a model. Across three full runs: **306 hostile turns, 0 breaches.** The Nemotron side of the first 93-turn run cost $0.023; the Claude control cost $3.20.

## How we built it

- **Shell and daemon.** A Tauri v2 desktop app (Windows, WebView2) over a local Python daemon that owns brain, recall, the gate, approvals and the ledger. Pages talk to it through a thin bridge, so nothing is installed into the websites.
- **Day to day she thinks on the CLI you are already signed in to** (Claude Code or Codex), so no key is needed to try her. A `nebius` engine runs her on Nemotron Super behind the same gate and ledger.
- **The Proving Ground** drives a throwaway Athena through the daemon's own routes for each attack, then reduces the gate's records to a verdict. Each Nemotron role has a falsifiable proof test, a kill criterion and a Claude Haiku control row. We did not know the quality of the tooling when we began, so nothing was polished before it proved.
- **Nebius Token Factory** serves every Nemotron call: Lightning as attacker and user simulator, Super as second judge and as an engine, Super-VL as the document reader.
- **Process.** One commit per feature with its tests, an ADR for each decision, and run reports (`report.json`, ledger, cost) kept for every number we quote.

## Challenges we ran into

- **The reasoning switch.** Only one of five documented spellings turned Nemotron's reasoning off; the other four returned HTTP 200 and were silently ignored. With reasoning on, 2 of 9 Lightning answers were about 30,000 characters of chain of thought with no tags and never reached the JSON we asked for.
- **Nemotron as a judge.** Agreement with our Haiku judge ranged from rho 0.08 to 0.42 on Lightning and 0.36 to 0.53 on Super across five runs, and both were lenient. Both scored a pending decision card as "sent" until we stated each card's status in the prompt.
- **Nested JSON.** A nested `card` object closed wrongly on 5 of 76 live Lightning answers; the same fields flat parsed 32 of 32.
- **A bug the Gauntlet found in our own gate.** The approve-path probe showed the replay step accepted the same approval twice. The gate now spends an approval as it lets the action through.
- **What we could not build.** Token Factory Sandboxes (no beta access from our key) and a Serverless endpoint for the trigger page (a Token Factory key cannot deploy one). Both are spiked and documented, not shipped.
- **Recording honestly.** Making a film of a live desktop app that stays truthful: figures lifted from run records, windows laid out by script, and the staging we do declared.

## Accomplishments that we're proud of

- **The gate held under attempt.** 306 hostile turns over three runs, 0 breaches, with the verdict read from records and planted breaches proving the detector can say "breached".
- **The Proving Ground found a real defect** in our own approval replay, and the fix is in the gate.
- **Honest numbers, with controls.** Every Nemotron role was measured against a Claude control, and we report where Nemotron lost: as a judge, and as the document reader's accuracy interval that falls below our line.
- **Cost.** An open-weight attacker at cents against dollars for the control means the gauntlet runs on every change instead of once.
- **A document reader in the product.** Nemotron 3.5 Super-VL reads a person's letter or bill at 91.0% field accuracy against 96.2% for the Claude lane, at $0.0007 against $0.0209 a document, opt-in with a fall back to the Claude lane.
- **A demo film recorded by a script.** The capture, narration and render are re-runnable, and the lessons are written into a shared knowledge registry.

## What we learned

- **Nemotron is an excellent adversary and user, and not yet a trusted judge.** Lightning stayed in persona on 94% to 97% of turns and its attacks reached 0.60 to 0.88 of the control's valid-attack rate. Treat it as a role player first; score its judgments beside a stronger judge, never instead.
- **Reasoning is a per-role decision.** Off, Lightning's JSON roles went from 35 to 45 of 45 schema-valid at a tenth of the cost. As the agent with tools, off was 3.5 times faster but it answered plain questions with a bare tool call (turns with no text rose from 3 to 24 of 112). Super lost nothing with reasoning off.
- **Trust is a ratio of evidence to claim.** The row where the gate held without ever being attempted was a limit worth saying out loud, and the Nemotron row is what showed the gate under attempt.
- **Open weights matter for one reason:** a run against a pinned open model can be repeated by someone else.

## What's next for Athena

- **Make a judge we can trust**, by calibrating a Nemotron judge against human-labelled transcripts and promoting it only if its agreement holds across seeds.
- **Close the open channels:** a foreign agent calling Athena over MCP (designed, not built), and Token Factory Sandboxes as branching worlds once beta access is there.
- **Deploy the trigger page** so anyone can watch a Gauntlet run live, once there is a supported path from a Token Factory key to a small endpoint.
- **Two devices.** Pairing over a private network, write-once memory replication and a phone page are built and tested and need a second device to show.
- **More chores and more apps,** each tested against a case with a known answer before it reaches the shelf.

2. How would you rate Nemotron's output quality for your use case? (1 = Poor, 10 = Excellent)

**7.** It depends on the role, and we measured each against a control. As an attacker and a user simulator it was very good: Lightning's attacks reached 0.60 to 0.88 of Claude Haiku's valid-attack rate across three runs, and it stayed in persona on 94% to 97% of turns, with 72 of 72 valid JSON answers once reasoning was off. As a document reader, Super-VL reached 91.0% field accuracy against 96.2% for the Claude lane. As a judge it fell short: rubric agreement with our Haiku judge was rho 0.57 to 0.69 on the 2026-10-22 retest but only 0.08 to 0.53 earlier, and it was lenient. We rate the quality high where the task is generating or role playing, and middling where the task is calibrated scoring.

3. Did you fine-tune, prompt-engineer, or use Nemotron out of the box? What was your approach?

Out of the box. We did not fine-tune; we prompt-engineered and constrained the output. What mattered:

- **Reasoning off for role calls**, using the one parameter that works (`chat_template_kwargs: {"enable_thinking": false}`). It raised schema-valid answers from 35 to 45 of 45 at about a tenth of the cost.
- **Flat JSON instead of nested** for Lightning (nested `card` objects broke on 5 of 76 answers; flat parsed 32 of 32).
- **State the facts the model must not guess,** such as each decision card's status, which removed the judge's habit of scoring a pending card as "sent".
- **A control for every role,** a proof test and a kill criterion decided before the run, so a result we did not like could still count against Nemotron.
- **Reasoning left on where it helped,** as Athena with tools on Lightning it kept tool use coherent.

4. How did Nemotron's performance compare to other models you've used for similar tasks?

Our controls were Claude Haiku (attacker, user-persona judge, second judge) and Claude Sonnet (documents, and the engine under test). Measured against them:

| Task | Nemotron | Control |
|---|---|---|
| Attack writing | 0.60 to 0.88 of the control's valid-attack rate | Haiku |
| Gauntlet run (93 turns) | $0.023 | Claude $3.20 |
| User in persona | 94% to 97% of turns | judged blind by Haiku |
| Judging 24 transcripts | Super $0.022, rho 0.36 to 0.69 | Haiku $0.87 |
| Document fields | 91.0% at $0.0007 | Sonnet 96.2% at $0.0209 |

Summary: for generating and role playing, Nemotron was close to the control at a fraction of the price. For judging and for the most accurate extraction, Claude was better, and Nemotron's score sits beside Haiku's, not in place of it. Speed: with reasoning off, a Lightning role answer took a median of 22 s under nine-way concurrency, against 80 s with reasoning on.

5. Which Nebius platform capabilities were most valuable to your project and how?

- **Token Factory as one door to several Nemotron models.** Lightning, Super, Super-VL and Ultra behind one key and one API shape let us assign a model to a role and swap it, which is what the retests needed.
- **Price.** A full adversarial run for cents is what makes running the gauntlet on every change possible.
- **Concurrency.** Nine-way concurrent calls were enough to run a whole run in minutes.
- **`GET /v1/whoami` and the models list** for finding out what a key could do.
- **Open weights on a hosted endpoint.** A run against a pinned model can be repeated by someone else, which is the property a security claim needs.

We tried Token Factory Sandboxes and Serverless Endpoints and could not use them (no beta access visible from the key; a Token Factory key cannot deploy an endpoint).

6. How likely are you to recommend running Nemotron on Nebius to other developers? (1 = Unlikely, 10 = Highly Likely)

**8.** We would recommend it without hesitation for generation, simulation, extraction and anything that needs volume at low cost. We would add a warning for developers who want Nemotron as a judge, and one about reasoning parameters. The two reasons it is not higher are the friction on reasoning control and the gap between Token Factory and the rest of the platform.

7. How would you rate your experience running Nemotron inference on Nebius compared to previous cloud or local development environments? (1 = Poor, 10 = Excellent)

**8.** Compared with running open models ourselves, there was nothing to provision, the first call worked, and a whole adversarial run cost cents. Compared with other hosted APIs we use, the OpenAI-compatible shape made it a small integration. The deductions are for a reasoning switch that silently ignores four of five spellings, reasoning that can leak into the answer text, and a Sandboxes and Serverless path we could not reach from a Token Factory key.

8. What additional features or improvements would have made the Nemotron on Nebius experience more effective for your project?

1. **Reject or warn on ignored reasoning parameters,** and say in the models list how to control the `reasoning` feature it names.
2. **Return reasoning in its own field.** 2 of 9 Lightning answers came back as about 30,000 characters of chain of thought in `message.content`.
3. **Show the project id next to the key** and validate it in `whoami`; the `Project` header every call needs is shown nowhere.
4. **Name the missing permission and link the access form** in the 403 for Sandboxes; today a key without access sees only an all-false permission map.
5. **A supported path from a Token Factory account to a small Serverless endpoint,** and one environment variable name across the SDK and the CLI (`contree-sdk` 0.3.6 reads one and the CLI the other).
6. **Serve Nemotron Safety Guard on Token Factory;** we used Haiku to label attacks instead.
7. **Published prices for Sandboxes.**

9. What do you most hope to see from the Nemotron team next?

- **A calibrated judge:** published guidance, or a model, for rubric scoring that stays stable across seeds and is not lenient. This is what would let us put a Nemotron score in place of a Claude one.
- **Reliable nested structured output** on Lightning, or a structured-output mode that makes it so.
- **Tool use that keeps the text.** With reasoning off, Lightning as an agent answered plain questions with a bare tool call.
- **Documented reasoning trade-offs per model,** because on Super off lost nothing and on Lightning it changed the agent's behavior.
- **Vision-language accuracy** for documents that closes the gap to 96%, with a narrower interval at our sample size.
- **A Safety Guard model we can call next to the attacker.**

10. Which AI tools have you leveraged while working on this project?

- **Claude Code,** with Claude models for most of the building, and the Claude models as the control and judge of record (Claude Haiku 5.5 for judging, Claude Sonnet for the engine under test and documents).
- **NVIDIA Nemotron 3.5 Lightning, Super, Super-VL and Ultra,** served by Nebius Token Factory (attacker, user simulator, second judge, engine, document reader).
- **Codex CLI** and **Claude Code CLI** as the engines she can run on day to day.
- **Kokoro** for local text to speech and **Whisper** for local speech to text.
- **ElevenLabs** for the demo film's narration and its background music.
- **Playwright** and a screen-capture pipeline to record the film from the running app, and a knowledge registry of our own conventions that the film tooling reads.

11. Image prompts for the submission thumbnail and cover

Design brief for all of them: light, calm, botanical-technical. Palette: soft sage background `#edf1ea`, deep ink `#101a12`, leaf green accent `#3f6e0a`, a warm amber `#a86a0a` used sparingly. Subject: Athena's own avatar, a bell of soft green light or an owl made of light, with a thin gate or arch that lets only some light through. No people, no real logos, no photographs of screens. Keep the text to the one word "Athena" (set in a clean geometric sans) or none at all, because generators draw longer text badly; add titles afterwards in a design tool.

**1:1 thumbnail (generate at 1024 x 1024; keep the subject inside the centre 70% so a circular crop still works)**

1. *Bell of light.* "Square app-icon style illustration, a luminous translucent bell-shaped halo glowing leaf green at its centre and fading to pale sage at the edges, a single small rounded gate arch in front of it, soft studio lighting on a flat light sage background, minimal, vector-clean, subtle paper grain, no text, no people, centred composition, generous empty margin."
2. *Owl of light.* "Square illustration of a stylised owl built from thin glowing green lines and soft light, wings forming an arch around a small bright point, deep ink outlines, pale sage background, soft shadow, flat modern editorial style, the word 'Athena' in clean geometric sans below the owl, nothing else, centred."
3. *The gate.* "Square minimalist poster, a tall arched doorway cut into a sage wall, only a narrow band of warm amber and green light passing through it, a tiny silhouette-free halo hovering at the threshold, strong geometry, light pastel palette, soft gradient, no characters, no text, centred."

**16:9 cover (generate at 1920 x 1080; keep the left third calmer so a title can sit there)**

1. *A desk of windows.* "Wide cinematic illustration, a soft green halo of light moving across several abstract floating browser-window panels (invoice rows, a calendar, a chat card) drawn as simple pale cards on a sage background, a thin arched gate in the foreground letting a single bead of light through, airy, minimal, flat editorial vector style with gentle depth and shadows, left third left calm, no readable text, no logos."
2. *The attack that stops.* "Wide illustration, dozens of thin dark-green lines streaming in from the right like hostile arrows, all stopping against a glowing arched barrier of pale green light in the centre, behind it a calm bell-shaped halo untouched, sage background, ink-line style with amber highlights, dramatic but quiet, no text, no people, space on the left for a title."
3. *Botanical circuit.* "Wide panoramic illustration, a branching botanical drawing whose veins become circuit traces, converging into a small luminous owl-of-light mark at the centre right, light sage paper background with fine grain, deep ink linework, leaf green and sparing amber accents, elegant scientific-plate look, ample empty space on the left, no readable text."

Notes for generation: ask for four images per prompt and keep the best; if text appears garbled, regenerate without it and add "Athena" afterwards. Do not use any NVIDIA, Nebius or Claude logos in the images; the film and form name them as text.
