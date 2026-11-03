import { describe, expect, it } from "vitest";
import { renderTemplate, whatsappLink } from "./message";

const contact = { full_name: "Anandhi", company: "Tredence", phone: "+91 75502 24684" };

describe("renderTemplate", () => {
  it("fills known variables from the contact", () => {
    expect(renderTemplate("Hi {{hr_name}} at {{company_name}}", contact)).toEqual({ text: "Hi Anandhi at Tredence", missing: [] });
  });
  it("keeps and reports variables it cannot fill", () => {
    const result = renderTemplate("Role: {{job_title}} {{relevant_skills}}", contact);
    expect(result.text).toBe("Role: {{job_title}} {{relevant_skills}}");
    expect(result.missing).toEqual(["job_title", "relevant_skills"]);
  });
});

describe("whatsappLink", () => {
  it("uses digits only and encodes the message", () => {
    expect(whatsappLink("+91 75502 24684", "Hi & bye")).toBe("https://wa.me/917550224684?text=Hi%20%26%20bye");
  });
});
