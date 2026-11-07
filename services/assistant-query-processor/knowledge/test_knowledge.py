"""Offline boundary tests. Synthetic test vectors exist only in temporary directories."""
import contextlib
import io
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


import corpus


class CorpusTests(unittest.TestCase):
    def test_fenced_headings_are_content(self):
        rows = list(corpus.sections("# Topic\nFirst\n```sh\n# comment\n```\n## Next\nLast", "Fallback"))
        self.assertEqual([r[0] for r in rows], ["Topic", "Topic > Next"])
        self.assertIn("# comment", rows[0][1])

    def test_multilingual_chunks_keep_all_text_within_budget(self):
        text = "ภาษาไทย 日本語の質問 English text. " * 30
        chunks = list(corpus.split_text(text, lambda s: len(s.encode()) <= 100))
        self.assertTrue(all(len(s.encode()) <= 100 for s in chunks))
        self.assertEqual("".join("".join(chunks).split()), "".join(text.split()))

    def test_table_rows_keep_column_meaning(self):
        text = "| Model | Credits/sec |\n| --- | ---: |\n| A | 36 |\n| B | 60 |"
        self.assertEqual(corpus.indexable_text(text), "Model: A; Credits/sec: 36\nModel: B; Credits/sec: 60")

    def test_provenance_is_part_of_release_identity(self):
        self.assertNotEqual(corpus.corpus_checksum([], [{"id": "s", "sha256": "old"}]),
                            corpus.corpus_checksum([], [{"id": "s", "sha256": "new"}]))

    def test_paths_cannot_escape_or_include_environment_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "root"
            root.mkdir()
            (Path(temp) / "outside.txt").write_text("outside")
            (root / "link").symlink_to(Path(temp) / "outside.txt")
            (root / "production.env").write_text("placeholder")
            for relative in ["../outside.txt", "link", "production.env"]:
                with self.assertRaises(ValueError):
                    corpus.safe_file(root, relative)

    def test_credential_scan_does_not_echo_credentials(self):
        credential = "sk-proj-" + "x" * 48
        with self.assertRaises(ValueError) as error:
            corpus.assert_safe(credential, "fixture")
        self.assertNotIn(credential, str(error.exception))

    def test_changed_or_out_of_scope_code_requires_review(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            workspace, production, here = root / "workspace", root / "production", root / "knowledge"
            for folder in [workspace / "samsar-docs/static", workspace / "samsar/pages", workspace / "samsar/docs",
                           production / "apps/blog", production / "services/processor", here / "sources"]:
                folder.mkdir(parents=True)
            (workspace / "samsar-docs/static/llms.txt").write_text("DOC_COUNT: 0")
            (workspace / "samsar/README.md").write_text("# Example\nPublic text")
            (workspace / "samsar/docs/runtime-modes.md").write_text("# Runtime\nOperator text")
            for name in ["README.md", "BLOG_SETUP.md"]:
                (production / "apps/blog" / name).write_text("Blog integration")
            (production / "SOURCE_MANIFEST.md").write_text("\n".join(
                f"| `{name}` | `{path}` | `commit` | `main` | clean |" for name, path in [
                    ("samsar-docs", "apps/docs"), ("samsar_blog", "apps/blog"), ("samsar_processor", "services/processor")]))
            (production / "services/processor/example.js").write_text("new implementation")
            corpus.write_json(here / "sources/blog.json", {"retrieved_at": "test", "articles": []})
            for path, error in [("services/processor/example.js", "needs review"), ("services/retired/example.js", "outside production")]:
                corpus.write_json(here / "sources/code-analysis.json", {"entries": [{"title": "Fact", "text": "Example",
                    "evidence": [{"path": path, "reviewed_sha256": "obsolete", "anchor": "implementation"}]}]})
                with patch.object(corpus, "HERE", here), self.assertRaisesRegex(ValueError, error):
                    corpus.build_corpus(workspace, production, root / "output")



if __name__ == "__main__":
    unittest.main()
