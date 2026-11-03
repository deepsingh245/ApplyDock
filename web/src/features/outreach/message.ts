export interface MessageContact {
  full_name: string;
  company: string;
  job_title?: string;
  phone: string;
}

/** Variables a template may use, filled from the contact. Anything else is left in place and reported as missing. */
export function renderTemplate(body: string, contact?: MessageContact): { text: string; missing: string[] } {
  const values: Record<string, string> = {
    hr_name: contact?.full_name ?? "",
    full_name: contact?.full_name ?? "",
    company_name: contact?.company ?? "",
    company: contact?.company ?? "",
    job_title: contact?.job_title ?? "",
  };
  const missing = new Set<string>();
  const text = body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
    const value = values[key.toLowerCase()];
    if (value) return value;
    missing.add(key);
    return match;
  });
  return { text, missing: [...missing] };
}

/** A WhatsApp click-to-chat link. It only prefills the text; the user still attaches the resume and presses Send. */
export function whatsappLink(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
