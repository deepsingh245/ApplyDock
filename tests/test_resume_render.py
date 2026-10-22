import hashlib
import io
import json
from pathlib import Path
import unittest

from applydock import resume_model, resume_render


FIXTURE = Path(__file__).resolve().parent / "fixtures" / "sample_resume.json"

try:
    import typst  # noqa: F401
    HAVE_TYPST = True
except ImportError:
    HAVE_TYPST = False


def sample(**meta):
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    data["meta"] = {**data.get("meta", {}), **meta}
    return resume_model.normalize(data)


def extract(pdf):
    from pypdf import PdfReader
    return "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(pdf)).pages)


@unittest.skipUnless(HAVE_TYPST, "typst is not installed")
class ResumeRenderTests(unittest.TestCase):
    def test_render_is_deterministic_and_valid_for_each_template(self):
        for template in resume_render.TEMPLATES:
            content = sample(template=template)
            first = resume_render.render(content)
            resume_render._CACHE.clear()
            second = resume_render.render(content)
            self.assertEqual(hashlib.sha256(first).hexdigest(), hashlib.sha256(second).hexdigest(), template)
            report = resume_render.validate(first, content)
            self.assertTrue(report["ok"], (template, report["warnings"]))
            self.assertEqual(report["page_count"], 1)
            self.assertEqual(report["unembedded_fonts"], [])
            self.assertTrue(all(font.startswith("Carlito") for font in report["fonts"]), report["fonts"])

    def test_markup_characters_render_literally(self):
        content = sample()
        content["basics"]["name"] = "Ana #Lee *Bold* $math$ @ref <tag> [x] _u_ \\ `code`"
        pdf = resume_render.render(content)
        self.assertIn("#Lee *Bold* $math$ @ref <tag> [x] _u_", extract(pdf))
        self.assertTrue(resume_render.validate(pdf, content)["ok"])

    def test_validation_detects_missing_text_and_page_overflow(self):
        content = sample()
        pdf = resume_render.render(content)
        changed = resume_model.apply_edit(content, content["work"][0]["highlights"][0]["id"], "text", "insert_after",
                                          "A bullet that was never rendered into this PDF.")
        report = resume_render.validate(pdf, changed)
        self.assertFalse(report["ok"])
        self.assertIn("A bullet that was never rendered into this PDF.", report["missing"])
        self.assertTrue(any("missing" in warning for warning in report["warnings"]))
        long = sample(page_limit=1)
        long["work"] = long["work"] * 1
        for index in range(12):
            long["work"].append({"name": f"Company {index}", "position": "Engineer", "startDate": "2010", "endDate": "2011",
                                 "highlights": [{"text": f"Delivered project number {index} with a long description of the work. " * 2}] * 3})
        long = resume_model.normalize(long)
        report = resume_render.validate(resume_render.render(long), long)
        self.assertGreater(report["page_count"], 1)
        self.assertFalse(report["page_limit_ok"])
        self.assertEqual(report["missing"], [])
        self.assertEqual(report["blank_pages"], [])
        self.assertTrue(report["order_ok"])

    def test_render_matrix_keeps_all_text(self):
        base = sample(page_limit=0)
        cases = {
            "long_summary": {"basics": {**base["basics"], "summary": "Detail-oriented engineer focused on reliable delivery. " * 30}},
            "long_project": {"projects": [{**base["projects"][0], "description": "A long project description that keeps going. " * 25}]},
            "long_url": {"basics": {**base["basics"], "url": "https://example.com/" + "very-long-path-segment/" * 12}},
            "two_pages": {"work": base["work"] * 1 + [{"name": f"Org {i}", "position": "Developer", "highlights": [{"text": "Shipped features. " * 6}] * 4} for i in range(8)]},
            "compact": {"meta": {**base["meta"], "template": "compact"}},
            "empty_sections": {"projects": [], "certificates": [], "awards": [], "custom": []},
        }
        for name, change in cases.items():
            content = resume_model.normalize({**base, **change})
            pdf = resume_render.render(content)
            report = resume_render.validate(pdf, content)
            self.assertEqual(report["missing"], [], name)
            self.assertEqual(report["blank_pages"], [], name)
            self.assertEqual(report["duplicates"], [], name)
            self.assertTrue(report["order_ok"], name)
            self.assertEqual(report["links_missing"], [], name)

    def test_design_settings_render_and_validate(self):
        base = sample()
        variants = [
            {"font": "Libertinus Serif", "accent": "#7a1f2b", "accent_headings": True, "accent_name": True, "header_align": "left"},
            {"font": "New Computer Modern", "date_position": "below", "skills_inline": True, "heading_upper": False, "heading_rule": False},
            {"margin_x": 30, "margin_y": 30, "bullet": "▪", "contact_separator": "•", "header_align": "right"},
        ]
        default_pdf = resume_render.render(base)
        for change in variants:
            raw = json.loads(json.dumps(base))
            raw["meta"]["layout"].update(change)
            content = resume_model.normalize(raw)
            pdf = resume_render.render(content)
            self.assertNotEqual(pdf, default_pdf, change)
            report = resume_render.validate(pdf, content)
            self.assertEqual(report["missing"], [], change)
            self.assertTrue(report["order_ok"], change)

    def test_fit_to_pages_tightens_layout_within_minimums(self):
        raw = json.loads(json.dumps(sample(page_limit=1)))
        raw["work"] += [{"name": f"Org {i}", "position": "Developer", "startDate": "2015", "endDate": "2016",
                         "highlights": [{"text": "Shipped features across the platform for many customers. " * 2}] * 3} for i in range(4)]
        content = resume_model.normalize(raw)
        self.assertGreater(resume_render.page_count(resume_render.render(content)), 1)
        result = resume_render.fit_to_pages(content, 1)
        self.assertTrue(result["fitted"])
        self.assertEqual(result["page_count"], 1)
        fitted = resume_model.normalize({**content, "meta": {**content["meta"], "layout": result["layout"]}})
        self.assertEqual(resume_render.page_count(resume_render.render(fitted)), 1)
        self.assertGreaterEqual(result["layout"]["font_size"], 9.0)
        huge = resume_model.normalize({**raw, "work": raw["work"] * 6})
        impossible = resume_render.fit_to_pages(huge, 1)
        self.assertFalse(impossible["fitted"])

    def test_section_order_follows_meta(self):
        content = sample(section_order=["education", "work", "skills"])
        pdf = resume_render.render(content)
        text = extract(pdf)
        self.assertLess(text.index("EDUCATION"), text.index("EXPERIENCE"))
        self.assertTrue(resume_render.validate(pdf, content)["order_ok"])


class FoldTests(unittest.TestCase):
    def test_fold_ignores_layout_artifacts(self):
        self.assertEqual(resume_render.fold("• Built  React­apps — fast"), resume_render.fold("Built React apps - fast"))


if __name__ == "__main__":
    unittest.main()
