"""Dependency-free checks for the setup wizard's Carbon catalog contract."""

import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from app.catalog import CatalogConfigurationError, load_model_catalog


class CarbonCatalogTests(unittest.TestCase):
    def load(self, *, text="google/gemini-4-carbon", vision=None, key="gemini-4-carbon"):
        # Matches buildGmiCloudRuntimeCatalog's credential-bound object schema.
        with TemporaryDirectory() as directory:
            path = Path(directory) / "catalog.json"
            path.write_text(json.dumps({
                "version": 1,
                "provider": "gmicloud",
                "credentialFingerprint": hashlib.sha256(b"carbon-test-key").hexdigest(),
                "models": {key: {
                    "text": {"modelId": text, "operation": "chat.completions"},
                    "vision": {"modelId": vision or text, "operation": "chat.completions"},
                }},
            }))
            return load_model_catalog(str(path), gmi_api_key="carbon-test-key")

    def test_setup_carbon_catalog_preserves_text_vision_and_public_model_id(self):
        catalog = self.load()
        route = catalog.resolve("gemini-4-carbon", modality="text")
        self.assertEqual(route.gmi_model, "google/gemini-4-carbon")
        self.assertEqual(route.gmi_vision_model, "google/gemini-4-carbon")
        self.assertEqual(catalog.openai_model_list()["data"][0]["id"], "gemini-4-carbon")

    def test_verified_carbon_owner_prefix_and_case_are_preserved(self):
        upstream = "tenant/google/GEMINI-4-CARBON"
        route = self.load(text=upstream).resolve("gemini-4-carbon")
        self.assertEqual(route.gmi_model, upstream)
        self.assertEqual(route.gmi_vision_model, upstream)

    def test_carbon_rejects_legacy_and_other_version_text_mappings(self):
        for upstream in [
            "google/gemini-4-argon",
            "google/gemini-3.1-pro",
            "google/gemini-4-carbon-preview",
        ]:
            with self.subTest(upstream=upstream):
                with self.assertRaisesRegex(CatalogConfigurationError, "unsupported GMICloud modelId"):
                    self.load(text=upstream, vision="google/gemini-4-carbon")

    def test_carbon_rejects_legacy_and_other_version_vision_mappings(self):
        for upstream in [
            "google/gemini-4-argon",
            "google/gemini-3.1-pro",
            "google/gemini-4-carbon-preview",
        ]:
            with self.subTest(upstream=upstream):
                with self.assertRaisesRegex(CatalogConfigurationError, "unsupported GMICloud modelId"):
                    self.load(vision=upstream)

    def test_legacy_argon_catalog_key_requires_revalidation_as_carbon(self):
        with self.assertRaisesRegex(CatalogConfigurationError, "unsupported Samsar model id"):
            self.load(text="google/gemini-4-argon", key="gemini-4-argon")
