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
