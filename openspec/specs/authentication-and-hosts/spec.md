# Authentication and hosts specification

## Purpose

Define how Reviewly connects to GitHub.com or GitHub Enterprise while keeping credentials and host-scoped data safe.

## Requirements

### Requirement: Reviewly supports the available GitHub authentication paths

Reviewly SHALL provide this capability according to the scenarios below.

The application SHALL support GitHub device authorization, an authenticated `gh` CLI session, and personal access token authentication for a selected host.

#### Scenario: Device authorization

- **WHEN** the user starts GitHub device authorization
- **THEN** the application presents the verification URL and user code
- **AND** completes sign-in after GitHub authorizes the device

#### Scenario: Existing CLI session

- **WHEN** the user selects CLI authentication and `gh` is authenticated for the selected host
- **THEN** Reviewly uses that host session without asking for a token

#### Scenario: Personal access token

- **WHEN** the user supplies a valid token and host
- **THEN** Reviewly validates the identity before completing sign-in
- **AND** stores the credential in the operating-system credential store rather than application preferences

### Requirement: Authentication is host aware

Reviewly SHALL provide this capability according to the scenarios below.

The application SHALL normalize the selected GitHub host and SHALL use it for API and web links.

#### Scenario: GitHub Enterprise

- **WHEN** the user signs in to a GitHub Enterprise hostname
- **THEN** API requests, browser links, and CLI authentication target that host

#### Scenario: Host changes

- **WHEN** the authenticated host differs from the host associated with the local PR cache
- **THEN** Reviewly clears or reinitializes host-specific cached PR data before syncing
- **AND** does not mix records from both hosts

### Requirement: Sign-out removes active authentication state

Reviewly SHALL provide this capability according to the scenarios below.

#### Scenario: Signing out

- **WHEN** the user signs out
- **THEN** the active session is removed
- **AND** authenticated screens return to the connection flow
