import { describe, expect, it } from "vitest";
import { isWaiting, timing } from "./reminders";

const at = "2030-01-07T04:00:00.000Z";
const t = new Date(at).getTime();
const minute = 60000;

describe("timing", () => {
  it("is later until five minutes before", () => {
    expect(timing(at, t - 10 * minute)).toBe("later");
    expect(timing(at, t - 4 * minute)).toBe("upcoming");
  });
  it("is due from the scheduled minute until the grace period ends", () => {
    expect(timing(at, t)).toBe("due");
    expect(timing(at, t + 29 * minute)).toBe("due");
  });
  it("is missed after thirty minutes", () => {
    expect(timing(at, t + 30 * minute)).toBe("missed");
  });
  it("ignores unparsable times", () => {
    expect(timing("nope", t)).toBe("later");
  });
});

describe("isWaiting", () => {
  it("covers only unacted statuses", () => {
    expect(isWaiting("scheduled")).toBe(true);
    expect(isWaiting("awaiting_confirmation")).toBe(false);
    expect(isWaiting("sent")).toBe(false);
  });
});
