import { describe, expect, it } from "vitest";
import { agentIds, applicationIdentity } from "./agentIds";

describe("agent surface labels and selectors", () => {
  it("labels an application with company and role", () => {
    expect(applicationIdentity({ company: "Acme", title: "Engineer" })).toBe("Acme — Engineer");
  });

  it("uses post context when capture supplied only a generic title", () => {
    expect(applicationIdentity({ title: "Hiring post", url: "https://www.linkedin.com/posts/person_activity-123/" })).toBe("LinkedIn activity 123");
  });

  it("keeps selectors stable and unique in the registry", () => {
    const values = Object.values(agentIds);
    expect(new Set(values).size).toBe(values.length);
  });
});
