# WT Schedule Approval Workflow

## Operating rule

- A new or revised schedule is submitted as `Pending Review`.
- Pending and returned submissions stay out of Dashboard and Calendar views.
- Only `Approved` submissions and legacy rows without an approval status are visible in schedule views.
- The Microsoft 365 manager and configured reviewer Outlook addresses can review.
- SharePoint `WT_Submissions` is the system of record for app and Outlook decisions.

## 1. Provision the SharePoint list

Run `tools/provision-wt-submissions-list.ps1` with a SharePoint owner account:

```powershell
pwsh ./tools/provision-wt-submissions-list.ps1
```

The script creates the list and the approval fields used by the app and Power Automate. It is idempotent and can be rerun after partial setup.

## 2. Configure fixed reviewers

Add one or more Outlook addresses to the SharePoint host, separated by semicolons:

```html
data-wt-approval-reviewers="reviewer1@company.com;reviewer2@company.com"
```

Power Automate adds the submitter's Microsoft 365 manager to these fixed reviewers. The app only exposes in-app decision controls to addresses listed in `ApproverEmails` or this configured reviewer list.

## 3. Build the Power Automate cloud flow

Create an automated cloud flow named `WT Schedule Approval` with the SharePoint trigger **When an item is created or modified**.

### Trigger

- Site: `https://taekwangcom.sharepoint.com/sites/T2RL2`
- List: `WT_Submissions`
- Trigger condition: `IsActive` equals `true`

### Branch A: create the Outlook approval

Condition:

- `ApprovalStatus` equals `Pending Review`
- `NotificationStatus` equals `Queued for Outlook`

Actions:

1. Office 365 Users: **Get manager (V2)** using `SubmittedByEmail`.
2. Compose a semicolon-separated recipient list from the manager mail and existing `ApproverEmails`; remove blanks and duplicates.
3. SharePoint: **Update item** with the composed `ApproverEmails` and `NotificationStatus = Approval email sent`.
4. Approvals: **Start and wait for an approval**.
5. Approval type: `Approve/Reject - First to respond`.
6. Assigned to: composed approver list.
7. Title: `WT Schedule Approval | {Title} | {ApprovalRevision}`.
8. Details: include model, season, gate, schedule date, type, PCC Developer, memo, and a link to Schedule Manager.
9. After the response, SharePoint: **Get item** again.
10. Continue only if the current `ApprovalStatus` is still `Pending Review`. This prevents a late Outlook response from overwriting an in-app decision.
11. On approve, update `ApprovalStatus = Approved`, reviewer fields, comment, `ApprovalUpdatedAt`, `ApprovedAt`, and `NotificationStatus = Completed`.
12. On reject, update `ApprovalStatus = Returned`, reviewer fields, comment, `ApprovalUpdatedAt`, and `NotificationStatus = Completed`.
13. Outlook: **Send an email (V2)** to `SubmittedByEmail` with the decision, comment, and Schedule Manager link.

### Branch B: notify after an in-app decision

Condition:

- `ApprovalStatus` is `Approved` or `Returned`
- `NotificationStatus` equals `Decision recorded; submitter email queued`

Actions:

1. Outlook: **Send an email (V2)** to `SubmittedByEmail` with the decision and `ApprovalComment`.
2. SharePoint: update `NotificationStatus = Completed`.

## 4. Permissions

- Submitters need create/read access and edit access to their own business fields.
- Reviewers need read access to all submissions.
- For a hard security boundary, approval field updates should run through Power Automate under the flow owner's connection, and ordinary members should not receive direct list permission to edit approval columns.
- Keep SharePoint version history enabled for audit evidence.

## 5. Acceptance test

1. Submit a schedule and confirm it appears under `Pending Review` only.
2. Confirm each assigned approver receives an Outlook approval card.
3. Confirm the pending schedule does not appear in Dashboard or Calendar.
4. Approve from Outlook and refresh Schedule Manager.
5. Confirm status is `Approved`, approver/comment/timestamp are recorded, and the schedule now appears in Dashboard and Calendar.
6. Submit another schedule, return it with a required comment, revise it, and confirm the revision returns to `Pending Review` with a higher `ApprovalRevision`.
