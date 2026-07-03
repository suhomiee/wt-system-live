# TCMS Running WT Automation

This project publishes TCMS Running WT work orders through `tcms-wt-events.json`.
The live site reads that file with cache busting, so every file update becomes
visible after the GitHub Pages deploy finishes.

The browser also polls the configured TCMS feed every 60 seconds through
`data-wt-tcms-refresh-ms="60000"`. If Power Automate or GitHub Actions updates
the feed while the page is open, the WT Worksheet and calendar are refreshed
without a manual page reload.

## Refresh Contract

The cloud refresh workflow is `.github/workflows/refresh-tcms-wt-events.yml`.
It runs every 15 minutes and can also be triggered manually or by Power Automate.

Required repository secret:

- `TCMS_RUNNING_WT_SOURCE_URL`: HTTPS URL that returns the current TCMS Running
  WT incomplete list as JSON or TCMS XML text export.

Optional repository secret:

- `TCMS_RUNNING_WT_MIN_COUNT`: minimum accepted row count. The workflow fails
  instead of publishing an accidental empty feed when the source breaks.
- `TCMS_RUNNING_WT_CATEGORY`: category to apply when the TCMS source is already
  filtered to Running but does not include a category column. Default: `Running`.

The normalizer accepts either:

- a JSON array of TCMS WT rows, or
- the XML text export format from the TCMS grid.

The output item key is `tcmsWorkOrderNo`. If a WT order is newly registered, it
is added. If its manufacturing completion plan date changes, the same event ID
is regenerated with the new date.

Category handling is strict:

- when a source row includes `tcmsCategory` or `category`, that row value must
  contain `Running`;
- when the source has no category column, Power Automate or the workflow must
  pass `source_category: "Running"` to mark the source as the Running category;
- model names such as AIR MAX are never used to infer category.

## Power Automate Flow Shape

Use a scheduled cloud flow:

1. Trigger: `Recurrence`, every 15 minutes.
2. Read TCMS Running WT incomplete rows through an available TCMS API, SQL
   source, report endpoint, or on-premises data gateway.
3. Filter:
   - category is `Running`
   - work order number matches `WT###-###`
   - completion status is not complete/cancelled
4. Publish the rows as JSON/XML to the URL stored in
   `TCMS_RUNNING_WT_SOURCE_URL`, or call GitHub `repository_dispatch`:

```http
POST https://api.github.com/repos/suhomiee/wt-system-live/dispatches
Authorization: Bearer <github-token>
Accept: application/vnd.github+json

{
  "event_type": "tcms-running-wt-refresh",
  "client_payload": {
    "source_url": "https://<power-automate-or-tcms-source-url>",
    "source_category": "Running"
  }
}
```

GitHub then normalizes `tcms-wt-events.json`, commits only real changes, and the
existing Pages workflow deploys the live site.

## Local Validation Command

```bash
node tools/normalize-tcms-running-wt.mjs \
  --input ../tcms_wt_export.txt \
  --output tcms-wt-events.json \
  --year 2026 \
  --min-count 1 \
  --category Running
```
