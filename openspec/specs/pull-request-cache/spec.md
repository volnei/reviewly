# Pull request cache specification

## Purpose

Define how Reviewly keeps watched pull requests available locally, refreshes them without unnecessary GitHub requests, and supplies review-size data used by prioritization and review-time estimates.

## Requirements

### Requirement: Watched repositories have a canonical local mirror

The application SHALL persist pull request summaries for watched repositories in SQLite and SHALL use that mirror as the native source for repository lists and Inbox membership.

#### Scenario: Complete open reconciliation

- **WHEN** a watched repository is synchronized without an existing watermark or with a forced refresh
- **THEN** the application fetches its complete open pull request set
- **AND** upserts the returned rows
- **AND** removes previously cached open rows that were absent from that reconciliation without removing rows written after the reconciliation began

#### Scenario: Incremental reconciliation

- **WHEN** a watched repository already has a synchronization watermark
- **THEN** the application fetches pull requests updated at or after that watermark
- **AND** includes all states so open-to-closed and open-to-merged transitions are persisted
- **AND** advances the watermark to the newest returned update

#### Scenario: Historical backfill

- **WHEN** a repository has not completed its bounded historical backfill
- **THEN** the application imports the supported recent history once
- **AND** records completion so later synchronization uses only incremental updates

### Requirement: Concurrent triggers coalesce

The application SHALL keep at most one pull request synchronization job active and SHALL collapse repositories reported during that job into a subsequent pass.

#### Scenario: Repository events arrive during synchronization

- **WHEN** one or more repository-change events arrive while synchronization is running
- **THEN** the affected repositories are accumulated
- **AND** one follow-up pass processes the accumulated set instead of starting overlapping jobs

### Requirement: Synchronization metadata uses partial atomic writes

The application SHALL update only the supplied synchronization fields and SHALL preserve every unspecified field without requiring a prerequisite read.

#### Scenario: Recording an error

- **WHEN** synchronization fails for one repository
- **THEN** the application updates that repository's error field
- **AND** preserves its existing watermark, backfill state, and last complete-open timestamp

### Requirement: Review sizes reuse existing responses

The application SHALL persist additions, deletions, and changed-file counts from responses that already contain those values before requesting separate enrichment.

#### Scenario: Dashboard synchronization

- **WHEN** the dashboard GraphQL query loads pull requests authored by or requesting review from the viewer
- **THEN** the same query includes additions, deletions, changed-file count, and update time
- **AND** those values are persisted with the Inbox signals
- **AND** no separate size request is required for those unchanged pull requests

#### Scenario: Opening a pull request

- **WHEN** an individual pull request detail response includes all three review-size values and the matching pull request revision exists in the local mirror
- **THEN** the application persists those values in the local mirror
- **AND** does not make another GitHub request solely to obtain them

#### Scenario: Stale detail response

- **WHEN** the detail response update time does not match the cached pull request update time
- **THEN** the application does not attach those size values to the newer cached revision

### Requirement: Missing review sizes are fetched in bounded batches

The application SHALL avoid one GitHub request per pull request when review-size values are missing.

#### Scenario: Fallback enrichment

- **WHEN** cached pull requests still lack current size values after dashboard and detail responses have been persisted
- **THEN** the application selects open pull requests first and then recent history
- **AND** limits one enrichment pass to 100 pull requests per repository
- **AND** queries GraphQL in batches of at most 25 pull requests
- **AND** writes all returned sizes for that repository with one SQLite update statement

#### Scenario: Pull request changes during enrichment

- **WHEN** a returned size record has an update time different from the current cached row
- **THEN** the application leaves the cached size fields unchanged so a later pass can enrich the current revision

### Requirement: Optional enrichment failures remain isolated

The application SHALL treat Inbox signals, stack membership, and review sizes as independent enrichment work after the canonical pull request rows are synchronized.

#### Scenario: One enrichment source fails

- **WHEN** one optional enrichment request fails
- **THEN** the other enrichment work can complete
- **AND** successfully synchronized pull request rows remain usable
