import { describe, expect, test } from "bun:test";
import { Schema } from "effect";

import { TeamsLinkPoll, TeamsStatus } from "../src/effect/schema";

const organization = {
  id: "organization-id",
  login: "reviewly",
  displayName: "Reviewly",
  role: "owner",
};

describe("Teams command schemas", () => {
  test("decodes the camelCase organization returned by Tauri", () => {
    expect(
      Schema.decodeUnknownSync(TeamsStatus)({
        signed_in: true,
        organizations: [organization],
      }),
    ).toEqual({ signed_in: true, organizations: [organization] });

    expect(
      Schema.decodeUnknownSync(TeamsLinkPoll)({
        status: "authorized",
        organizations: [organization],
      }),
    ).toEqual({ status: "authorized", organizations: [organization] });
  });
});
