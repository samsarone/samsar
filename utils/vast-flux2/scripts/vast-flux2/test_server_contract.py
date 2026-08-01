#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import time
from pathlib import Path
from types import ModuleType

from fastapi.testclient import TestClient
from PIL import Image


def load_server(output_dir: Path) -> ModuleType:
    os.environ["FLUX_API_HEADER"] = "X-Demo-Key"
    os.environ["FLUX_API_HEADER_VALUE"] = "test-secret"
    os.environ["FLUX_OUTPUT_DIR"] = str(output_dir)
    server_path = Path(__file__).with_name("server.py")
    spec = importlib.util.spec_from_file_location("vast_flux2_server_contract_test", server_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load server.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="vast-flux2-contract-") as temp_name:
        output_dir = Path(temp_name)
        server = load_server(output_dir)

        def fake_load_pipeline():
            server.PIPELINE_READY_AT = time.time()
            return object()

        def fake_run_job(job):
            output_path = output_dir / f"{job.request_id}-0.png"
            Image.new("RGB", (32, 32), "purple").save(output_path)
            with server.JOBS_LOCK:
                job.output_files = [str(output_path)]
                job.status = "COMPLETED"
                job.completed_at = time.time()
                job.updated_at = job.completed_at

        server._load_pipeline = fake_load_pipeline
        server._run_job = fake_run_job
        headers = {"X-Demo-Key": "test-secret"}

        with TestClient(server.app, base_url="https://flux.example") as client:
            assert client.get("/health").status_code == 200
            assert client.post("/generate", json={"input": {"prompt": "demo"}}).status_code == 401

            submitted = client.post(
                "/generate",
                headers=headers,
                json={
                    "input": {
                        "prompt": "A purple demo tile",
                        "image_size": {"width": 1024, "height": 1024},
                        "num_images": 1,
                        "guidance_scale": 1,
                        "num_inference_steps": 4,
                    }
                },
            )
            assert submitted.status_code == 202, submitted.text
            submission = submitted.json()
            request_id = submission["request_id"]
            assert submission["status_url"].endswith(f"/generate/{request_id}/status")
            assert submission["result_url"].endswith(f"/generate/{request_id}/result")

            status = None
            for _ in range(50):
                polled = client.get(f"/generate/{request_id}/status", headers=headers)
                assert polled.status_code == 200, polled.text
                status = polled.json()["status"]
                if status == "COMPLETED":
                    break
                time.sleep(0.02)
            assert status == "COMPLETED"

            result = client.get(f"/generate/{request_id}/result", headers=headers)
            assert result.status_code == 200, result.text
            image_url = result.json()["image"]["url"]
            image_response = client.get(image_url)
            assert image_response.status_code == 200
            assert image_response.headers["content-type"] == "image/png"
            assert client.get(image_url.replace("token=", "token=bad")).status_code == 401

    print("FLUX.2 API contract test passed")


if __name__ == "__main__":
    main()
