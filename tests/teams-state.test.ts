import { describe, expect, test } from "bun:test";

import { type TeamsState, teamsStateAfterBootstrapFailure } from "../src/effect/services/Teams";

describe("Teams connection state", () => {
  test("preserves a connected session during a transient refresh failure", () => {
    const connected: TeamsState = {
      loading: false,
      signedIn: true,
      organizations: [
        { id: "reviewly", login: "reviewly", displayName: "Reviewly", role: "owner" },
      ],
    };

    expect(teamsStateAfterBootstrapFailure(connected)).toEqual(connected);
  });

  test("finishes the initial loading state without inventing a session", () => {
    expect(
      teamsStateAfterBootstrapFailure({ loading: true, signedIn: false, organizations: [] }),
    ).toEqual({ loading: false, signedIn: false, organizations: [] });
  });
});
