export function dateLabel(iso?: string | null): string {
  if (!iso) return "Not set";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Not set" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function shortDate(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** ISO timestamp → value for <input type="datetime-local"> in local time. */
export function localInput(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function todayInput(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function usableLink(value?: string | null): string {
  try {
    const url = new URL(value ?? "");
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

export const plural = (count: number, word: string, many = word + "s") => (count === 1 ? word : many);

export const countLabel = (count: number, word: string, many?: string) => `${count} ${plural(count, word, many)}`;

export function bytesLabel(value?: number | null): string {
  const size = Number(value || 0);
  return size < 1_000_000 ? `${Math.max(1, Math.round(size / 1000))} KB` : `${(size / 1_000_000).toFixed(1)} MB`;
}

export function scoreLabel(value?: number | null): string {
  return value === null || value === undefined || Number.isNaN(Number(value)) ? "—" : Number(value).toFixed(1);
}

/** Read a chosen file as the {filename, content(base64)} payload the helper expects for uploads. */
export async function filePayload(file?: File | null, maxBytes = 8_000_000) {
  if (!file || file.size > maxBytes) throw new Error("Choose a PDF or DOCX resume under 8 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return { filename: file.name, content: btoa(binary) };
}
