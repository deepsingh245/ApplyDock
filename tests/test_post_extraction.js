const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "extension", "sidepanel.js"), "utf8");
const start = source.indexOf("function extractPage() {");
const end = source.indexOf("\nfunction showPreview(", start);
assert.ok(start >= 0 && end > start, "extractPage must be present");

const postText = "We are hiring engineers.\nSend a CV to Jobs@Example.com or team@example.com by Friday.\nRemote in India.";
const links = [
  {href: "mailto:jobs@example.com", innerText: "Email us"},
  {href: "mailto:onlylink@example.com", innerText: "Email us"}
];
const postRoot = {
  innerText: postText,
  querySelector: () => ({innerText: postText}),
  querySelectorAll: () => links
};
const document = {
  title: "Hiring engineers | LinkedIn",
  querySelector: selector => {
    if (selector.startsWith('[data-test-id="main-feed-activity-card"]')) return postRoot;
    if (selector === "h1") return {innerText: "Hiring engineers"};
    if (selector === "article") return postRoot;
    return null;
  },
  querySelectorAll: () => []
};
const context = {
  document,
  location: {hostname: "www.linkedin.com", pathname: "/posts/person_activity-123/", href: "https://www.linkedin.com/posts/person_activity-123/", search: ""},
  window: {getSelection: () => ({toString: () => ""})},
  URLSearchParams,
  URL
};
const result = vm.runInNewContext(source.slice(start, end) + "\nextractPage();", context);
assert.equal(result.kind, "post");
assert.equal(result.recipient, "jobs@example.com");
assert.equal(result.apply_method, "email");
assert.deepEqual(Array.from(result.contact_emails), ["jobs@example.com", "team@example.com", "onlylink@example.com"]);
assert.match(result.post_details, /Remote in India/);
assert.match(result.excerpt, /team@example.com/);
console.log("LinkedIn post extraction passed");

// Split view: a list of jobs with one open on the right. The page's JSON-LD still describes the job it first loaded,
// and no known description class matches; the open job's "About the job" section must be what is captured.
const jd = "We are looking for a Senior Frontend Engineer to build our React and TypeScript design system. You will own performance and accessibility across the product.";
const aboutSection = {innerText: "About the job\n" + jd, textContent: "About the job " + jd, parentElement: null};
const heading = {textContent: "About the job", parentElement: aboutSection};
const staleLd = {textContent: JSON.stringify({"@type": "JobPosting", title: "Old job", description: "<p>Stale description of another job.</p>", hiringOrganization: {name: "Other"}})};
const splitDocument = {
  title: "Senior Frontend Engineer | Initech | LinkedIn",
  querySelector: selector => {
    if (selector === ".job-details-jobs-unified-top-card__job-title") return {innerText: "Senior Frontend Engineer"};
    if (selector === ".job-details-jobs-unified-top-card__company-name") return {innerText: "Initech"};
    if (selector === "article") return {innerText: "A card from the job list"};
    return null;
  },
  querySelectorAll: selector => {
    if (selector.startsWith("script")) return [staleLd];
    if (selector === "h1, h2, h3, h4, strong, span") return [{textContent: "Jobs"}, heading];
    return [];
  }
};
const split = vm.runInNewContext(source.slice(start, end) + "\nextractPage();", {
  document: splitDocument,
  location: {hostname: "www.linkedin.com", pathname: "/jobs/search/", href: "https://www.linkedin.com/jobs/search/?currentJobId=4012345678", search: "?currentJobId=4012345678"},
  window: {getSelection: () => ({toString: () => ""})},
  DOMParser: class { parseFromString(html) { return {body: {textContent: html.replace(/<[^>]+>/g, " ")}}; } },
  URLSearchParams,
  URL
});
assert.equal(split.kind, "job");
assert.equal(split.url, "https://www.linkedin.com/jobs/view/4012345678/");
assert.equal(split.excerpt, jd);
console.log("LinkedIn split-view job extraction passed");
