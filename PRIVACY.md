# Privacy Policy

_Last updated: October 29, 2026_

Reviewly (including the Mac App Store edition, "Reviewly for GitHub") is a desktop app for reviewing GitHub pull requests. It is built so that your data stays between you, GitHub, and the services you choose.

## What we collect

Nothing. Reviewly has no server, no accounts of its own, no analytics, no telemetry, and no advertising. The developer never receives your code, your pull requests, or any information about how you use the app.

## What the app stores on your Mac

- **Your GitHub sign-in token**, in the macOS Keychain.
- **A local cache** of the pull requests, reviews and comments you open, in a database inside the app's own container, so lists load instantly and survive a flaky connection.
- **Your preferences**, such as theme, watched repositories and AI settings.

Deleting the app removes all of it.

## Who the app talks to

- **GitHub** (github.com, or the GitHub Enterprise Server you sign in to), to list pull requests and to post the reviews and comments you write. GitHub's own privacy policy applies to that data.
- **The AI endpoint you configure, if any.** When you ask for an AI review or chat about a pull request, the diff and the conversation are sent to the OpenAI-compatible endpoint you entered in Settings — a model on your own machine (such as Ollama or LM Studio) or a provider you choose. Nothing is sent until you ask. That provider's privacy policy applies to what it receives.

No other network requests are made.

## Children

Reviewly is a developer tool and is not directed at children.

## Changes

If this policy changes, the new version will be published at this address with a new date.

## Contact

Questions: open an issue at https://github.com/volnei/reviewly/issues.
