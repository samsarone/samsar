#!/usr/bin/env python3
from __future__ import annotations

import argparse
import email.message
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType
from unittest import mock


def load_provisioner() -> ModuleType:
    source = Path(__file__).with_name("provision.py")
    spec = importlib.util.spec_from_file_location("vast_flux2_provision_test", source)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load provision.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


provision = load_provisioner()


class FakeCreateApi:
    def __init__(self):
        self.paths: list[str] = []

    def request(self, method, path, payload=None):
        self.paths.append(path)
        if path == "/asks/1/":
            raise provision.VastHttpError(method, path, 409, "offer unavailable")
        return {"new_contract": 99}


class FakeUrlResponse:
    def __init__(self, status, body, content_type="application/json"):
        self.status = status
        self.body = body
        self.headers = email.message.Message()
        self.headers["Content-Type"] = content_type

    def read(self, _size=-1):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False


class ProvisionTests(unittest.TestCase):
    def test_parser_has_one_api_port_option(self):
        args = provision.build_parser().parse_args(["--api-port", "9000", "--plan"])
        self.assertEqual(args.api_port, 9000)

    def test_env_parser_does_not_execute_shell(self):
        with tempfile.TemporaryDirectory() as temp_name:
            path = Path(temp_name) / "vast.env"
            path.write_text("export VAST_API_KEY='secret'\nVALUE=$(not-executed)\n", encoding="utf-8")
            path.chmod(0o600)
            values = provision.parse_env_file(path)
            self.assertEqual(values["VAST_API_KEY"], "secret")
            self.assertEqual(values["VALUE"], "$(not-executed)")

    def test_offer_race_moves_to_next_candidate(self):
        api = FakeCreateApi()
        args = argparse.Namespace(
            image="image",
            label="label",
            disk_gb=80,
            api_port=8000,
            rental_type="ondemand",
            max_hourly_price=2.0,
        )
        instance_id, offer = provision.create_from_offers(
            api,
            [
                {"id": 1, "dph_total": 0.5},
                {"id": 2, "dph_total": 0.6},
            ],
            args,
        )
        self.assertEqual(instance_id, 99)
        self.assertEqual(offer["id"], 2)
        self.assertEqual(api.paths, ["/asks/1/", "/asks/2/"])

    def test_mapped_port_shapes(self):
        self.assertEqual(
            provision.parse_mapped_port(
                {"ports": {"8000/tcp": [{"HostIp": "0.0.0.0", "HostPort": "32100"}]}},
                8000,
            ),
            32100,
        )
        self.assertEqual(
            provision.parse_mapped_port({"extra_env": {"VAST_TCP_PORT_8000": "32101"}}, 8000),
            32101,
        )

    def test_account_preflight_rejects_missing_credit_or_ssh_key(self):
        class AccountApi:
            def __init__(self, response):
                self.response = response

            def request(self, method, path, payload=None):
                return self.response

        with self.assertRaisesRegex(provision.ProvisionError, "no billing credit"):
            provision.verify_account(AccountApi({"balance": 0, "ssh_key": "ssh-ed25519 AAAA"}))
        with self.assertRaisesRegex(provision.ProvisionError, "no SSH public key"):
            provision.verify_account(AccountApi({"balance": 10, "ssh_key": ""}))
        account = provision.verify_account(
            AccountApi({"balance": 10, "ssh_key": "ssh-ed25519 AAAA"})
        )
        self.assertEqual(account["balance"], 10)

    def test_account_preflight_prefers_spendable_credit_over_zero_balance(self):
        class AccountApi:
            def request(self, method, path, payload=None):
                return {
                    "credit": 25,
                    "balance": 0,
                    "ssh_key": "ssh-ed25519 AAAA",
                }

        account = provision.verify_account(AccountApi())
        self.assertEqual(account["credit"], 25)

    def test_generation_smoke_test_checks_full_contract(self):
        base_url = "https://flux.example"

        def fake_urlopen(request, timeout=None, context=None):
            url = request.full_url
            normalized_headers = {key.lower(): value for key, value in request.headers.items()}
            if "/image/" not in url:
                self.assertEqual(normalized_headers.get("x-test-key"), "test-secret")
            if request.get_method() == "POST" and url.endswith("/generate"):
                return FakeUrlResponse(202, json.dumps({"request_id": "smoke-1"}).encode())
            if url.endswith("/status"):
                return FakeUrlResponse(
                    200,
                    json.dumps({"request_id": "smoke-1", "status": "COMPLETED"}).encode(),
                )
            if url.endswith("/result"):
                return FakeUrlResponse(
                    200,
                    json.dumps(
                        {
                            "status": "COMPLETED",
                            "image": {
                                "url": f"{base_url}/generate/smoke-1/image/0?token=signed"
                            },
                        }
                    ).encode(),
                )
            if "/image/0?token=signed" in url:
                return FakeUrlResponse(200, b"\x89PNG\r\n\x1a\n" + b"demo-image", "image/png")
            raise AssertionError(f"Unexpected smoke-test URL: {url}")

        with mock.patch.object(provision.urllib.request, "urlopen", side_effect=fake_urlopen):
            result = provision.run_generation_smoke_test(
                base_url,
                "X-Test-Key",
                "test-secret",
                5,
            )
            self.assertEqual(result["status"], "passed")
            self.assertEqual(result["request_id"], "smoke-1")


if __name__ == "__main__":
    unittest.main()
