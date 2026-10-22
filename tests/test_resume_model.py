import json
from pathlib import Path
import unittest

from applydock import resume_model


FIXTURE = Path(__file__).resolve().parent / "fixtures" / "sample_resume.json"


def sample():
    return resume_model.normalize(json.loads(FIXTURE.read_text(encoding="utf-8")))


class ResumeModelTests(unittest.TestCase):
    def test_normalize_assigns_stable_unique_ids(self):
        content = sample()
        again = resume_model.normalize(content)
        self.assertEqual(content, again)
        self.assertEqual(resume_model.content_hash(content), resume_model.content_hash(again))
        ids = [item["target_id"] for item in resume_model.iter_items(content) if item["target_id"] != "basics"]
        self.assertTrue(all(resume_model.ID_PATTERN.fullmatch(value) for value in ids))
        duplicated = json.loads(json.dumps(content))
        duplicated["work"][1]["id"] = duplicated["work"][0]["id"]
        fixed = resume_model.normalize(duplicated)
        self.assertNotEqual(fixed["work"][0]["id"], fixed["work"][1]["id"])
        self.assertEqual(fixed["work"][0]["id"], content["work"][0]["id"])

    def test_links_are_restricted_and_bare_domains_completed(self):
        content = resume_model.normalize({"basics": {"url": "github.com/someone", "profiles": [{"network": "Mail", "url": "me@example.com"}]}})
        self.assertEqual(content["basics"]["url"], "https://github.com/someone")
        self.assertEqual(content["basics"]["profiles"][0]["url"], "mailto:me@example.com")
        for bad in ("javascript:alert(1)", "file:///C:/secret", "data:text/html,hi"):
            with self.assertRaises(ValueError):
                resume_model.normalize({"basics": {"url": bad}})
            self.assertEqual(resume_model.normalize({"basics": {"url": bad}}, strict=False)["basics"]["url"], "")

    def test_empty_items_survive_editing_but_not_import(self):
        raw = {"work": [{"name": "", "highlights": [""]}], "skills": [{"name": "", "keywords": []}]}
        self.assertEqual(len(resume_model.normalize(raw)["work"]), 1)
        self.assertEqual(len(resume_model.normalize(raw)["work"][0]["highlights"]), 1)
        self.assertEqual(resume_model.normalize(raw, drop_empty=True)["work"], [])

    def test_limits_cap_sizes(self):
        content = resume_model.normalize({"basics": {"summary": "x" * 10000}, "work": [{"name": str(i)} for i in range(100)]})
        self.assertEqual(len(content["basics"]["summary"]), resume_model.LIMITS["summary"])
        self.assertEqual(len(content["work"]), resume_model.LIMITS["items"])

    def test_apply_edit_operations(self):
        content = sample()
        bullet = content["work"][0]["highlights"][0]
        replaced = resume_model.apply_edit(content, bullet["id"], "text", "replace", "Built reusable React components.")
        self.assertEqual(replaced["work"][0]["highlights"][0], {"id": bullet["id"], "text": "Built reusable React components."})
        self.assertEqual(content["work"][0]["highlights"][0]["text"], "Developed reusable React components for internal applications.")
        inserted = resume_model.apply_edit(content, bullet["id"], "text", "insert_after", "Added a line.")
        self.assertEqual(inserted["work"][0]["highlights"][1]["text"], "Added a line.")
        self.assertEqual(len(inserted["work"][0]["highlights"]), len(content["work"][0]["highlights"]) + 1)
        group = content["skills"][1]["id"]
        added = resume_model.apply_edit(content, group, "keywords", "add_keyword", "Vitest")
        self.assertIn("Vitest", added["skills"][1]["keywords"])
        with self.assertRaises(ValueError):
            resume_model.apply_edit(content, "w_doesnotexist", "text", "replace", "x")
        with self.assertRaises(ValueError):
            resume_model.apply_edit(content, content["education"][0]["id"], "text", "insert_after", "x")

    def test_diff_reports_added_removed_changed(self):
        before = sample()
        after = resume_model.apply_edit(before, before["work"][0]["highlights"][0]["id"], "text", "replace", "Changed text.")
        after["projects"] = []
        after = resume_model.apply_edit(after, after["skills"][0]["id"], "keywords", "add_keyword", "Go")
        changes = resume_model.diff(before, after)
        kinds = {(change["type"], change["field"]) for change in changes}
        self.assertIn(("changed", "text"), kinds)
        self.assertIn(("removed", "name"), kinds)
        self.assertIn(("changed", "keywords"), kinds)
        self.assertEqual(resume_model.diff(before, before), [])

    def test_heading_order_and_expected_strings(self):
        content = sample()
        self.assertEqual(resume_model.heading_order(content), ["Summary", "Skills", "Experience", "Projects", "Education", "Certifications"])
        expected = resume_model.expected_strings(content)
        self.assertIn("Developed reusable React components for internal applications.", expected)
        self.assertIn("IndexedDB", expected)
        self.assertNotIn("Mar 2022", expected)

    def test_fact_guard_flags_new_facts_only(self):
        corpus = "Developed reusable React components for internal applications. TypeScript Jest"
        flags = resume_model.fact_guard("Built React components with Next.js, cutting load time 40% for 12 teams.",
                                        "Developed reusable React components", corpus)
        values = {flag["value"] for flag in flags}
        self.assertTrue({"Next.js", "40%", "12"} <= values)
        self.assertEqual(resume_model.fact_guard("Built reusable React components with TypeScript.", "", corpus), [])
        terms = resume_model.requirement_terms("Performance optimization of React applications")
        flagged = resume_model.fact_guard("Built reusable React components and optimized rendering performance.",
                                          "Developed reusable React components for internal applications.", corpus, terms)
        self.assertEqual({flag["value"] for flag in flagged}, {"performance", "optimization"})

    def test_layout_defaults_and_clamping(self):
        content = sample()
        self.assertEqual(content["meta"]["layout"], resume_model.LAYOUT_PRESETS["ats-classic"])
        raw = json.loads(json.dumps(content))
        raw["meta"]["layout"].update(margin_x=2, font_size=40, font="Comic Sans", accent="red", header_align="left", bullet="–")
        layout = resume_model.normalize(raw)["meta"]["layout"]
        self.assertEqual((layout["margin_x"], layout["font_size"]), (5.0, 13.0))
        self.assertEqual(layout["font"], "Carlito")
        self.assertEqual(layout["accent"], resume_model.LAYOUT_PRESETS["ats-classic"]["accent"])
        self.assertEqual((layout["header_align"], layout["bullet"]), ("left", "–"))
        compact = resume_model.normalize({"meta": {"template": "compact"}})["meta"]["layout"]
        self.assertEqual(compact["font_size"], resume_model.LAYOUT_PRESETS["compact"]["font_size"])

    def test_json_resume_round_trip(self):
        content = sample()
        exported = resume_model.to_json_resume(content)
        self.assertEqual(exported["work"][0]["highlights"][0], "Developed reusable React components for internal applications.")
        self.assertNotIn("id", exported["work"][0])
        imported = resume_model.from_json_resume(exported)
        self.assertEqual([h["text"] for h in imported["work"][0]["highlights"]], [h["text"] for h in content["work"][0]["highlights"]])
        self.assertEqual(imported["basics"]["location"], "Austin, TX")


if __name__ == "__main__":
    unittest.main()
