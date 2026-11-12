# Local repository workspace specification

## Purpose

Define the local Git workspace used to inspect changes, prepare commits, browse history, and manage branches without leaving Reviewly.

## Requirements

### Requirement: Users control which local repositories Reviewly can access

The application SHALL operate only on local repositories explicitly added by the user and SHALL allow those repositories to be removed from Reviewly without deleting the checkout.

#### Scenario: Adding a repository

- **WHEN** the user selects a valid local Git repository
- **THEN** it appears in Local and becomes available to local-only workflows

#### Scenario: Removing a repository

- **WHEN** the user removes a repository from Reviewly
- **THEN** its path is removed from application preferences
- **AND** files in the checkout are not deleted

### Requirement: Local repositories expose navigation and editor entry points

The application SHALL support repository search, file browsing, quick open, and configured external-editor actions for available local paths.

#### Scenario: Opening a local file

- **WHEN** the user selects a repository file or quick-open result
- **THEN** Reviewly opens the file in the local workspace or the configured editor target
- **AND** rejects paths that escape the selected repository root

### Requirement: Repository work is separated into focused views

The local repository workspace SHALL expose Changes, History, and Branches views while retaining repository identity, current branch, and upstream status in the page header.

#### Scenario: Opening a repository

- **WHEN** a local repository is opened
- **THEN** the Changes view is selected
- **AND** the page shows the repository name, path, current branch, and available ahead or behind status

#### Scenario: Switching views from an externally opened file

- **WHEN** the reviewer switches to History or Branches while a repository file is open from another Reviewly surface
- **THEN** the file route state is cleared
- **AND** the selected repository view is displayed

### Requirement: Changed files remain navigable and actionable

The Changes view SHALL separate staged and unstaged files, support filtering by path, and keep stage, unstage, discard, and bulk stage actions adjacent to the affected files.

#### Scenario: Filtering changed files

- **WHEN** the reviewer types in the changed-file filter
- **THEN** staged and unstaged sections show only paths containing that text without case sensitivity
- **AND** an explicit empty result is shown when no file matches

#### Scenario: Selecting a nested file

- **WHEN** a changed path contains directories
- **THEN** its basename is the primary label
- **AND** its containing directory is shown separately
- **AND** the selected row exposes its current state accessibly

#### Scenario: Selecting an untracked directory

- **WHEN** Git reports an untracked directory path with a trailing separator
- **THEN** the row shows the directory name instead of a blank basename
- **AND** identifies it as an untracked directory
- **AND** the detail pane explains that staging it will reveal the files Git can include

#### Scenario: Keyboard navigation

- **WHEN** focus is not captured by a dialog or text entry
- **THEN** `j` and `k` move through the filtered changed-file set
- **AND** Space toggles the selected file between staged and unstaged
- **AND** `c` focuses the commit message

### Requirement: File details distinguish unavailable diff states

The Changes view SHALL distinguish loading, read failure, untracked content, untracked directories, and non-text or empty diffs instead of presenting them as the same state.

#### Scenario: New text file without a generated diff

- **WHEN** an untracked file can be read but no unified diff is returned
- **THEN** the application shows a file preview

#### Scenario: Non-textual change

- **WHEN** a changed file returns no displayable text diff
- **THEN** the application explains that the change may be binary, a rename, or a file-mode change

### Requirement: Commit preparation remains available beside changes

The Changes view SHALL keep commit composition available beside the staged and unstaged lists.

#### Scenario: Creating a commit

- **WHEN** at least one file is staged and the reviewer supplies a non-empty message
- **THEN** the reviewer can create a commit
- **AND** successful completion clears the message and refreshes repository state

#### Scenario: Amending a commit

- **WHEN** the reviewer enables amend
- **THEN** the last commit subject is offered when the message is empty
- **AND** the commit action amends the previous commit

#### Scenario: Drafting a commit message with AI

- **WHEN** staged changes exist and the reviewer requests an AI draft
- **THEN** only the staged diff is used to draft the message
- **AND** the draft is placed in the editable commit message field

### Requirement: History and branches provide repository management context

The History view SHALL show recent commits and the branch's file changes against its base, and the Branches view SHALL allow switching, creation, deletion, and worktree inspection.

#### Scenario: Deleting an unmerged branch

- **WHEN** normal branch deletion fails because the branch is not fully merged
- **THEN** the application asks for explicit confirmation before attempting forced deletion

### Requirement: Repository actions report outcomes

Fetch, pull, push, stage, unstage, discard, commit, branch, editor, and pull-request actions SHALL refresh relevant repository data after success and SHALL show an actionable failure when they do not complete.

#### Scenario: Repository action completes

- **WHEN** a repository action succeeds
- **THEN** the application refreshes the affected repository data
- **AND** reports the successful outcome when the action has a user-facing completion message

#### Scenario: Repository action fails

- **WHEN** a repository action fails
- **THEN** the application keeps the workspace available
- **AND** reports which action did not complete with the underlying error context
