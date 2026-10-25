# GHL Onboarding Widget: setup from scratch

## What you get
- `widget/ghl-onboarding-widget-paste.html`: the ribbon + dropdown (paste into GHL Custom JS)
- `backend/`: Node/Express API for Render (updates the pipeline stage, stores completion)

## Part 1: GoHighLevel
1. **Pipeline.** In the sub-account that will hold onboarding data (your agency sub-account), create a pipeline
   `Client Onboarding` with one stage per onboarding step (e.g. Business Profile, Contacts Imported, Calendar Connected, Workflow Created).
2. **One opportunity per client.** Create an opportunity for each client in that pipeline.
   **Its name must contain the client sub-account's Location ID** (e.g. `Acme Dental - 7xKq2LmN9pR4tWc1AbCd`).
   The Location ID is the string after `/location/` in the client's GHL URL.
3. **Private Integration token.** In the onboarding sub-account: Settings -> Private Integrations (enable it under Labs if hidden)
   -> Create new. Scopes: `opportunities.readonly`, `opportunities.write`. Copy the token (`pit-...`).
4. **Get pipeline and stage IDs.**
   ```
   curl "https://services.leadconnectorhq.com/opportunities/pipelines?locationId=<ONBOARDING_LOCATION_ID>" \
     -H "Authorization: Bearer <TOKEN>" -H "Version: 2021-07-28"
   ```
   Note the pipeline `id` and each stage `id`.
5. **Videos.** Upload them to Media Storage and copy each file's URL.

## Part 2: Backend on Render
1. Push the `backend/` folder to a GitHub repo.
2. Render -> New -> **PostgreSQL** (free is fine) -> copy the *Internal Database URL*.
3. Render -> New -> **Web Service** -> pick the repo.
   Runtime Node, Build `npm install`, Start `npm start`.
4. Environment variables (see `.env.example`):
   `GHL_TOKEN`, `ONBOARDING_LOCATION_ID`, `ONBOARDING_PIPELINE_ID`, `STEP_STAGES`,
   `ALLOWED_ORIGINS`, `DATABASE_URL`, `ADMIN_KEY`.
5. Deploy, then open `https://<your-service>.onrender.com/health`. It should return `{"ok":true}`.
   Free web services sleep when idle, so the first call can take about 30 seconds. Use a paid instance for production.

## Part 3: Widget
1. Open `widget/ghl-onboarding-widget-paste.html` and edit the CONFIG block:
   `API_BASE` (your Render URL, no trailing slash) and each step's `id`, `name`, `path`, `video`.
   Step `id`s must match the keys in `STEP_STAGES`.
2. Agency Settings -> Company -> Custom JS -> paste the entire file (including the `<script>` tags) -> Save.
3. Open a client sub-account and hard refresh (Ctrl+Shift+R).

## Part 4: Test
```
curl -X POST https://<service>.onrender.com/onboarding/complete \
  -H "Content-Type: application/json" \
  -d '{"locationId":"<CLIENT_LOCATION_ID>","stepId":"business-profile"}'
```
Expect `{"ok":true}` and the opportunity moving to that stage. If it returns "no onboarding opportunity",
the opportunity name does not contain the Location ID. Link it manually:
```
curl -X POST https://<service>.onrender.com/admin/map -H "x-admin-key: <ADMIN_KEY>" \
  -H "Content-Type: application/json" -d '{"locationId":"<CLIENT_LOCATION_ID>","opportunityId":"<OPP_ID>"}'
```

## Notes
- White-label domain: add it to `ALLOWED_ORIGINS` (comma-separated) or the browser will block the calls.
- Paths in the widget (`/settings/calendars` etc.) are appended to `/v2/location/<id>`. Check each one in your account.
- The browser sends the Location ID, so anyone who knows another location's ID could mark its steps done. Fine for onboarding, not for sensitive data.
- Completed steps are locked (no un-tick) so the stage cannot move backwards.
