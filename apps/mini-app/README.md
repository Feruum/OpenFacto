# Openfacto Organizer

React + Vite SPA. Use the organizer bot’s Mini App button to sign in. Telegram supplies the signed launch data in the URL fragment. The SPA exchanges it with the API, removes the fragment and keeps the returned session in the current browser tab. Opening the app without a Telegram launch or an existing session displays the **Demo mode** workspace. Its event data lives in memory and is discarded on reload.

Set `VITE_API_BASE_URL` to the API origin before building. Configure the API’s `MINI_APP_ORIGIN` to match the SPA origin exactly. Local development uses `http://localhost:3000` for the API.

```sh
pnpm --filter @openfacto/mini-app... build
pnpm --filter @openfacto/mini-app dev
```

## Organizer workflows

- Choose an organization and event in Settings. Owners and administrators can manage team roles, configure bots and set AI funding.
- Save a FAQ or document draft, publish it, inspect its versions, restore an earlier publication, or unpublish it. For PDF sources, create a document and import a PDF up to 8 MiB. Reopen the source to check ingestion progress and publish a ready version.
- Test participant questions in Playground. Choose the language and published/draft scope. The form stays busy while the saved request is processed; inspect the completed decision, verified citations, request duration, cost and trace. The evaluation panel runs suites of up to 20 cases on the server and polls results.
- Moderators can resolve handoffs and create FAQ drafts. Owners and administrators can assign open handoffs to members.
- Use Settings → API status to run the original readiness probe. The probe contacts the configured API in either mode.

## Asynchronous Playground

`EventClient.playground(input): Promise<Decision>` submits POST
`/api/v1/organizations/:org/events/:event/playground` and follows GET
`/playground/:requestId` under the same event path. POST returns 202 with
`{requestId,status,decision?,errorCode?}`; GET returns the same shape with ordinary
Bearer authentication scoped to the request's actor, organization and event.
Statuses are pending, running, completed and failed. Only completed carries a decision.

The client polls every 1.5 seconds for at most five minutes, with each network request
bounded to 15 seconds or the remaining deadline. Network/server retries reuse the same
ID and payload. After a timeout, submitting the unchanged form resumes that request,
including its original conversation context. Controls stay disabled while waiting;
switching event or interface language discards stale results. Pending forms are not
restored automatically after reload. Demo mode still uses the local AnswerEngine and
does not submit AI work to the API.

The single NestJS backend owns RabbitMQ consumers. Telegram and Playground share
`ai.questions`; PostgreSQL holds durable state and dispatch/claim leases. No broker
credentials belong in the SPA. Deploy this client with the asynchronous backend after
migrations 0010/0011 and the old BullMQ consumers have stopped; see the
[migration runbook](../../docs/openfacto/RUNBOOK.md#переход-с-bullmq-на-rabbitmq).

`pnpm --filter @openfacto/mini-app test` exercises polling with mocked fetch and clock.
For the isolated UI harness, start a loopback Vite dev server and run from the repository root:

```powershell
$env:PLAYGROUND_TEST_URL='http://127.0.0.1:5173'
node --test apps/mini-app/test/playground.browser.mjs
```

The harness uses synthetic deferred responses to check waiting controls, timeout retry
identity/context and stale event/language results. It does not verify the live broker.

## Landing and generative illustrations

Open `/welcome` for the public product landing, or use the **О продукте / About Openfacto** link in the workspace header. The workspace remains at `/?view=overview`. The landing is loaded separately and includes three selectable SVG scenes, a keyboard-accessible terrain slider, pointer parallax with reduced-motion support, and explicitly labelled, prewritten dialogue examples (not live AI requests).

`src/GenerativeArt.tsx` generates deterministic SVG illustrations for Knowledge, Playground, Inbox and Settings. The overview retains its mountain banner. No image service or new dependency is required.

To verify the visual flows with an installed Chrome browser, build the mini-app and run a local production preview, then in another PowerShell terminal:

```powershell
pnpm --filter @openfacto/mini-app build
pnpm --filter @openfacto/mini-app preview --host 127.0.0.1 --port 55175
# In another terminal, from apps/mini-app:
$env:LANDING_TEST_URL = 'http://127.0.0.1:55175'
node --test test/landing.integration.mjs
node --test test/mobile-layout.integration.mjs
```

The test checks scene switching, slider geometry, pointer interaction, evidence disclosure, desktop/mobile overflow, navigation and browser errors. Optional `LANDING_SCREENSHOT_DIR` saves preview screenshots to an existing directory. Production hosting must serve the SPA entry for `/welcome`, as Vite preview does.

The mobile regression uses touch emulation at 320, 390, 430 and 768 CSS pixels in Russian, Kazakh and English. It checks all five workspace screens, the source editor, reply/evaluation forms, input font sizes, consistent illustration colors and the absence of a FAQ hover fill. Native keyboard behavior and physical-device safe areas still require a real iOS/Android check.

## Component provenance

The free Button and Badge and their motion tokens were downloaded from the [official Arc UI registry](https://uiarc.dev/). Original component and CSS module sources live under `src/components/arc`. The Button includes a parent-element check for strict TypeScript. Resize observers in both components store their measurements in React refs. App styles supply the brand tokens. The license is shipped in [public/UIARC-LICENSE.txt](public/UIARC-LICENSE.txt).

Runtime and operations are documented in the [runbook](../../docs/openfacto/RUNBOOK.md).



## Browser regression

Run a disposable NestJS backend with its in-process consumers, migrated PostgreSQL,
RabbitMQ and SPA on loopback. Use a synthetic manager token in that API. Set
`BROWSER_TEST_URL` to the SPA origin and `BROWSER_TEST_MANAGER_TOKEN` to the same
synthetic token, then run `pnpm --filter @openfacto/mini-app test:browser`. The test
uses an installed Chrome browser. Set `BROWSER_TEST_CHROME` to its executable when
Chrome is installed outside the standard location. It signs in two fixture users,
creates an organization, event and FAQ, follows Playground POST 202 and GET polling,
runs an evaluation, checks viewer permissions, and verifies tab-session recovery and
mobile Kazakh navigation. Dispose of the test database after the run.
