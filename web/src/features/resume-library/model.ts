import type { Resume } from "@/api/types";

/** Masters first, each followed by its tailored copies; orphaned tailored copies (master deleted) go last. */
export function orderResumes(library: Resume[]): Resume[] {
  const tailored = (parent: string) => library.filter((resume) => resume.kind === "tailored" && resume.parent_resume_id === parent);
  const masters = library.filter((resume) => resume.kind !== "tailored");
  const orphans = library.filter((resume) => resume.kind === "tailored" && !library.some((master) => master.id === resume.parent_resume_id));
  return [...masters.flatMap((master) => [master, ...tailored(master.id)]), ...orphans];
}

export const fileExtension = (resume: Pick<Resume, "original_filename">) => String(resume.original_filename || "").split(".").pop()?.toUpperCase() || "FILE";

export const isPdf = (resume: Pick<Resume, "original_filename">) => String(resume.original_filename || "").toLowerCase().endsWith(".pdf");

export const RESUME_CATEGORIES = ["Frontend Developer", "Full Stack Developer", "Backend Developer", "React Developer", "Angular Developer"];

export function deleteWarning(resume: Pick<Resume, "name" | "analysis_count">, assigned: number) {
  const parts = [`Delete ‘${resume.name}’ from the local resume library?`];
  if (assigned) parts.push(`${assigned} application(s) will show Resume Missing and must be reassigned.`);
  parts.push(
    resume.analysis_count
      ? `${resume.analysis_count} dependent analysis run(s) and all private resume versions will also be deleted.`
      : "All private resume versions will also be deleted.",
  );
  return parts.join(" ");
}
