import { describe, expect, it } from "vitest";
import type { Resume } from "@/api/types";
import { deleteWarning, fileExtension, orderResumes } from "./model";

const resume = (id: string, kind = "master", parent = ""): Resume => ({ id, kind, parent_resume_id: parent, name: id, original_filename: `${id}.pdf` }) as Resume;

describe("resume library model", () => {
  it("lists each master followed by its tailored copies, orphans last", () => {
    const library = [resume("t-orphan", "tailored", "gone"), resume("m1"), resume("t1", "tailored", "m1"), resume("m2"), resume("t2", "tailored", "m2")];
    expect(orderResumes(library).map((item) => item.id)).toEqual(["m1", "t1", "m2", "t2", "t-orphan"]);
  });

  it("names the file type and explains what a delete removes", () => {
    expect(fileExtension({ original_filename: "cv.docx" })).toBe("DOCX");
    expect(deleteWarning({ name: "CV", analysis_count: 2 }, 1)).toBe(
      "Delete ‘CV’ from the local resume library? 1 application(s) will show Resume Missing and must be reassigned. 2 dependent analysis run(s) and all private resume versions will also be deleted.",
    );
  });
});
