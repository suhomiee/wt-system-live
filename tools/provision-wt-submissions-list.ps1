param(
  [string]$SiteUrl = "https://taekwangcom.sharepoint.com/sites/T2RL2",
  [string]$ListTitle = "WT_Submissions"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Module -ListAvailable -Name PnP.PowerShell)) {
  throw "PnP.PowerShell is required. Install-Module PnP.PowerShell -Scope CurrentUser"
}

Connect-PnPOnline -Url $SiteUrl -Interactive

$list = Get-PnPList -Identity $ListTitle -ErrorAction SilentlyContinue
if (-not $list) {
  New-PnPList -Title $ListTitle -Template GenericList -OnQuickLaunch:$false | Out-Null
}

Set-PnPList -Identity $ListTitle -EnableVersioning $true -EnableAttachments $false

$fields = @(
  @{ DisplayName = "Row Key"; InternalName = "RowKey"; Type = "Text" },
  @{ DisplayName = "Payload JSON"; InternalName = "PayloadJson"; Type = "Note" },
  @{ DisplayName = "Submitted At"; InternalName = "SubmittedAt"; Type = "DateTime" },
  @{ DisplayName = "Active"; InternalName = "IsActive"; Type = "Boolean" },
  @{ DisplayName = "Approval Status"; InternalName = "ApprovalStatus"; Type = "Choice"; Choices = @("Pending Review", "Approved", "Returned", "Withdrawn") },
  @{ DisplayName = "Approval Submitted At"; InternalName = "ApprovalSubmittedAt"; Type = "DateTime" },
  @{ DisplayName = "Approver Emails"; InternalName = "ApproverEmails"; Type = "Note" },
  @{ DisplayName = "Approval Comment"; InternalName = "ApprovalComment"; Type = "Note" },
  @{ DisplayName = "Approval Updated At"; InternalName = "ApprovalUpdatedAt"; Type = "DateTime" },
  @{ DisplayName = "Approved At"; InternalName = "ApprovedAt"; Type = "DateTime" },
  @{ DisplayName = "Approver Name"; InternalName = "ApproverName"; Type = "Text" },
  @{ DisplayName = "Approver Email"; InternalName = "ApproverEmail"; Type = "Text" },
  @{ DisplayName = "Submitted By Name"; InternalName = "SubmittedByName"; Type = "Text" },
  @{ DisplayName = "Submitted By Email"; InternalName = "SubmittedByEmail"; Type = "Text" },
  @{ DisplayName = "Notification Status"; InternalName = "NotificationStatus"; Type = "Text" },
  @{ DisplayName = "Approval Revision"; InternalName = "ApprovalRevision"; Type = "Number" }
)

foreach ($field in $fields) {
  $existing = Get-PnPField -List $ListTitle -Identity $field.InternalName -ErrorAction SilentlyContinue
  if ($existing) { continue }

  $parameters = @{
    List = $ListTitle
    DisplayName = $field.DisplayName
    InternalName = $field.InternalName
    Type = $field.Type
    AddToDefaultView = $true
  }
  if ($field.ContainsKey("Choices")) { $parameters.Choices = $field.Choices }
  Add-PnPField @parameters | Out-Null
}

Set-PnPField -List $ListTitle -Identity "Title" -Values @{ Required = $true }
Set-PnPField -List $ListTitle -Identity "RowKey" -Values @{ Required = $true; Indexed = $true; EnforceUniqueValues = $true }
Set-PnPField -List $ListTitle -Identity "ApprovalStatus" -Values @{ DefaultValue = "Pending Review"; Indexed = $true }
Set-PnPField -List $ListTitle -Identity "IsActive" -Values @{ DefaultValue = "1"; Indexed = $true }

Write-Host "Provisioned $ListTitle on $SiteUrl" -ForegroundColor Green
