#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shlex
import shutil
import ssl
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


VAST_API_BASE = "https://console.vast.ai/api/v0"
DEFAULT_MODEL = "black-forest-labs/FLUX.2-klein-4B"
DEFAULT_IMAGE = "pytorch/pytorch:2.9.1-cuda12.8-cudnn9-runtime"
ASSET_DIR = Path(__file__).resolve().parent


class ProvisionError(RuntimeError):
    pass


class VastHttpError(ProvisionError):
    def __init__(self, method: str, path: str, status: int, response_text: str):
        super().__init__(f"Vast API {method} {path} failed ({status}): {response_text}")
        self.status = status


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    if os.name != "nt" and stat.S_IMODE(path.stat().st_mode) & 0o077:
        raise ProvisionError(
            f"Credential file permissions are too broad: {path}. Run: chmod 600 {shlex.quote(str(path))}"
        )
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            raise ProvisionError(f"Invalid environment line {line_number} in {path}")
        key, raw_value = line.split("=", 1)
        key = key.strip()
        if not key.replace("_", "").isalnum() or key[0].isdigit():
            raise ProvisionError(f"Invalid environment key on line {line_number} in {path}")
        raw_value = raw_value.strip()
        if raw_value and raw_value[0] in {"'", '"'}:
            try:
                parsed = shlex.split(raw_value, comments=False, posix=True)
            except ValueError as exc:
                raise ProvisionError(f"Invalid quoting on line {line_number} in {path}: {exc}") from exc
            if len(parsed) != 1:
                raise ProvisionError(f"Environment values cannot contain shell expressions: {path}:{line_number}")
            value = parsed[0]
        else:
            value = raw_value
        values[key] = value
    return values


def resolve_credentials(env_file: Path | None) -> dict[str, str]:
    file_values = parse_env_file(env_file) if env_file else {}
    resolved = dict(file_values)
    resolved.update({key: value for key, value in os.environ.items() if value})

    if not resolved.get("VAST_API_KEY"):
        config_home = Path(os.getenv("XDG_CONFIG_HOME", "~/.config")).expanduser()
        official_key_file = config_home / "vastai" / "vast_api_key"
        if official_key_file.is_file():
            if os.name != "nt" and stat.S_IMODE(official_key_file.stat().st_mode) & 0o077:
                raise ProvisionError(
                    "Vast's stored API key is readable by other users. Run: "
                    f"chmod 600 {shlex.quote(str(official_key_file))}"
                )
            resolved["VAST_API_KEY"] = official_key_file.read_text(encoding="utf-8").strip()
    if not resolved.get("VAST_API_KEY"):
        location = env_file or Path("~/.config/samsar/vast.env").expanduser()
        raise ProvisionError(
            "VAST_API_KEY is required. Export it in the shell or add it to "
            f"{location} with file mode 600."
        )
    return resolved


class VastApi:
    def __init__(self, api_key: str):
        self.api_key = api_key

    def request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(
            f"{VAST_API_BASE}{path}",
            data=body,
            method=method,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Accept": "application/json",
                "Content-Type": "application/json",
                "User-Agent": "samsar-vast-flux2-provisioner/1.0",
            },
        )
        attempts = 4 if method in {"GET", "POST"} else 1
        for attempt in range(1, attempts + 1):
            try:
                with urllib.request.urlopen(request, timeout=45) as response:
                    content = response.read().decode("utf-8")
                    return json.loads(content) if content else {}
            except urllib.error.HTTPError as exc:
                response_text = exc.read().decode("utf-8", errors="replace")[:2000]
                retryable = exc.code in {429, 500, 502, 503, 504} and attempt < attempts
                if not retryable:
                    raise VastHttpError(method, path, exc.code, response_text) from exc
            except urllib.error.URLError as exc:
                if attempt >= attempts:
                    raise ProvisionError(f"Could not reach the Vast API: {exc.reason}") from exc
            time.sleep(min(2 ** attempt, 10))
        raise ProvisionError(f"Vast API {method} {path} failed after {attempts} attempts")


def require_local_tools() -> None:
    missing = [name for name in ("ssh", "scp") if shutil.which(name) is None]
    if missing:
        raise ProvisionError(f"Missing required local command(s): {', '.join(missing)}")


def extract_offers(response: Any) -> list[dict[str, Any]]:
    if isinstance(response, list):
        return [item for item in response if isinstance(item, dict)]
    if isinstance(response, dict):
        for key in ("offers", "bundles", "results"):
            value = response.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
    raise ProvisionError("Vast offer search returned an unrecognized response")


def offer_price(offer: dict[str, Any]) -> float:
    try:
        return float(offer.get("dph_total", offer.get("dph", float("inf"))))
    except (TypeError, ValueError):
        return float("inf")


def search_offers(api: VastApi, args: argparse.Namespace) -> list[dict[str, Any]]:
    query: dict[str, Any] = {
        "gpu_name": {"in": [args.gpu]},
        "num_gpus": {"eq": 1},
        "gpu_ram": {"gte": args.min_gpu_ram},
        "reliability": {"gte": args.min_reliability},
        "verified": {"eq": True},
        "rentable": {"eq": True},
        "disk_space": {"gte": args.disk_gb},
        "type": args.rental_type,
        "limit": args.offer_limit,
    }
    if args.max_hourly_price is not None:
        query["dph_total"] = {"lte": args.max_hourly_price}
    offers = extract_offers(api.request("POST", "/bundles/", query))
    offers.sort(key=lambda offer: (-float(offer.get("reliability", 0) or 0), offer_price(offer)))
    if not offers:
        raise ProvisionError(
            f"No rentable verified {args.gpu} offer matched the filters. "
            "Try increasing --max-hourly-price or lowering --min-reliability."
        )
    return offers


def get_specific_offer(api: VastApi, offer_id: int) -> dict[str, Any]:
    offers = extract_offers(
        api.request(
            "POST",
            "/bundles/",
            {
                "id": {"eq": offer_id},
                "rentable": {"eq": True},
                "limit": 1,
            },
        )
    )
    if not offers:
        raise ProvisionError(f"Vast offer {offer_id} is not currently rentable")
    return offers[0]


def verify_account(api: VastApi) -> dict[str, Any]:
    account = api.request("GET", "/users/current/")
    if not isinstance(account, dict):
        raise ProvisionError("Vast account preflight returned an unrecognized response")

    # Vast's current user response exposes spendable funds as `credit`. Some
    # responses also contain a separate `balance` field that can legitimately
    # be zero even when the account has credit, so only use it as a legacy
    # fallback when `credit` is absent.
    balance_value = account.get("credit")
    if balance_value is None:
        balance_value = account.get("balance")
    if balance_value is not None:
        try:
            if float(balance_value) <= 0:
                raise ProvisionError("The Vast account has no billing credit; add credit before provisioning")
        except (TypeError, ValueError) as exc:
            raise ProvisionError("Vast returned an invalid account balance during preflight") from exc

    if "ssh_key" in account and not str(account.get("ssh_key") or "").strip():
        raise ProvisionError(
            "The Vast account has no SSH public key. Add one on the Vast Keys page before provisioning."
        )
    return account


def verify_hugging_face_model(model_id: str, token: str = "") -> None:
    encoded_model = urllib.parse.quote(model_id, safe="/")
    request = urllib.request.Request(
        f"https://huggingface.co/api/models/{encoded_model}",
        headers={
            "Accept": "application/json",
            "User-Agent": "samsar-vast-flux2-provisioner/1.0",
            **({"Authorization": f"Bearer {token}"} if token else {}),
        },
    )
    last_error = "unknown error"
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                model = json.loads(response.read().decode("utf-8"))
                if response.status == 200 and isinstance(model, dict) and model.get("id"):
                    return
                last_error = "model metadata response was incomplete"
        except urllib.error.HTTPError as exc:
            if exc.code in {401, 403, 404}:
                token_hint = " Set HF_TOKEN if this is a gated or private model." if not token else ""
                raise ProvisionError(
                    f"Hugging Face model preflight failed for {model_id} (HTTP {exc.code}).{token_hint}"
                ) from exc
            last_error = f"HTTP {exc.code}"
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = str(exc)
        if attempt < 3:
            time.sleep(2 ** attempt)
    raise ProvisionError(f"Could not verify Hugging Face model {model_id}: {last_error}")


def extract_instance_id(response: Any) -> int:
    candidates: list[Any] = []
    if isinstance(response, dict):
        candidates.extend((response.get("new_contract"), response.get("instance_id"), response.get("id")))
        if isinstance(response.get("instance"), dict):
            candidates.append(response["instance"].get("id"))
    for candidate in candidates:
        try:
            if candidate is not None:
                return int(candidate)
        except (TypeError, ValueError):
            continue
    raise ProvisionError(f"Vast did not return a new instance ID: {json.dumps(response)[:1000]}")


def create_instance(api: VastApi, offer: dict[str, Any], args: argparse.Namespace) -> int:
    offer_id = offer.get("id") or offer.get("ask_contract_id")
    if offer_id is None:
        raise ProvisionError("Selected Vast offer does not contain an offer ID")
    payload = {
        "client_id": "me",
        "image": args.image,
        "label": args.label,
        "disk": args.disk_gb,
        "runtype": "ssh_direct",
        "cancel_unavail": True,
        "env": {
            f"-p {args.api_port}:{args.api_port}": "1",
            "OPEN_BUTTON_PORT": str(args.api_port),
        },
        "onstart": (
            "mkdir -p /workspace/flux2-api; env > /etc/environment; "
            "if [ -x /workspace/flux2-api/start.sh ]; then "
            "/workspace/flux2-api/start.sh >/workspace/flux2-api/onstart.log 2>&1; fi"
        ),
    }
    if args.rental_type == "bid":
        payload["price"] = args.max_hourly_price
    response = api.request("PUT", f"/asks/{offer_id}/", payload)
    return extract_instance_id(response)


def create_from_offers(
    api: VastApi,
    offers: list[dict[str, Any]],
    args: argparse.Namespace,
) -> tuple[int, dict[str, Any]]:
    failures: list[str] = []
    for index, offer in enumerate(offers):
        offer_id = offer.get("id") or offer.get("ask_contract_id")
        price = offer_price(offer)
        price_text = "unknown" if price == float("inf") else f"${price:.3f}/hour"
        rental_label = "on-demand" if args.rental_type == "ondemand" else "bid"
        article = "an" if rental_label[0].lower() in "aeiou" else "a"
        log(
            f"Creating {article} {rental_label} instance from offer {offer_id} "
            f"({price_text}; candidate {index + 1}/{len(offers)})..."
        )
        try:
            return create_instance(api, offer, args), offer
        except VastHttpError as exc:
            # Marketplace offers can be rented between search and create. Only
            # move to another offer for definite offer/contract conflicts; a
            # network or server timeout could hide a successful creation.
            if exc.status not in {400, 404, 409, 410} or len(offers) == 1:
                raise
            failures.append(f"offer {offer_id}: HTTP {exc.status}")
            log(f"Offer {offer_id} became unavailable; trying the next matching offer...")
    raise ProvisionError(f"All matching Vast offers became unavailable ({'; '.join(failures)})")


def normalize_instance(response: Any) -> dict[str, Any]:
    if isinstance(response, dict):
        instance = response.get("instances", response.get("instance", response))
        if isinstance(instance, list):
            if not instance:
                raise ProvisionError("Vast returned an empty instance list")
            instance = instance[0]
        if isinstance(instance, dict):
            return instance
    raise ProvisionError("Vast returned an unrecognized instance response")


def get_instance(api: VastApi, instance_id: int) -> dict[str, Any]:
    return normalize_instance(api.request("GET", f"/instances/{instance_id}/"))


def wait_for_instance(api: VastApi, instance_id: int, timeout: int) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last_status = "unknown"
    while time.monotonic() < deadline:
        try:
            instance = get_instance(api, instance_id)
        except VastHttpError as exc:
            if exc.status == 404:
                time.sleep(5)
                continue
            raise
        status = str(instance.get("actual_status") or instance.get("status") or "unknown")
        if status != last_status:
            log(f"Vast instance {instance_id}: {status}")
            last_status = status
        ssh_host = instance.get("ssh_host")
        ssh_port = instance.get("ssh_port")
        if status.lower() == "running" and ssh_host and ssh_port:
            return instance
        if status.lower() in {"error", "failed", "exited", "destroyed"}:
            raise ProvisionError(f"Vast instance {instance_id} entered terminal status {status}")
        time.sleep(10)
    raise ProvisionError(f"Timed out after {timeout}s waiting for Vast instance {instance_id}")


@dataclass
class SshTarget:
    host: str
    port: int
    user: str
    known_hosts: Path
    identity_file: Path | None

    def common_options(self) -> list[str]:
        options = [
            "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=15",
            "-o", "ServerAliveInterval=15",
            "-o", "ServerAliveCountMax=4",
            "-o", "StrictHostKeyChecking=accept-new",
            "-o", f"UserKnownHostsFile={self.known_hosts}",
        ]
        if self.identity_file:
            options.extend(("-i", str(self.identity_file)))
        return options

    def ssh_command(self, remote_command: str) -> list[str]:
        return ["ssh", *self.common_options(), "-p", str(self.port), f"{self.user}@{self.host}", remote_command]

    def scp_command(self, sources: list[Path], destination: str) -> list[str]:
        return [
            "scp", *self.common_options(), "-P", str(self.port),
            *(str(source) for source in sources),
            f"{self.user}@{self.host}:{destination}",
        ]


def run_checked(command: list[str], *, capture: bool = False, timeout: int | None = None) -> str:
    result = subprocess.run(
        command,
        check=False,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
        timeout=timeout,
    )
    if result.returncode != 0:
        detail = (result.stderr or "").strip()[-2000:] if capture else "see command output above"
        raise ProvisionError(f"Command failed with exit code {result.returncode}: {detail}")
    return (result.stdout or "").strip()


def wait_for_ssh(target: SshTarget, timeout: int) -> None:
    deadline = time.monotonic() + timeout
    last_error = ""
    while time.monotonic() < deadline:
        result = subprocess.run(
            target.ssh_command("true"),
            check=False,
            text=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        if result.returncode == 0:
            return
        last_error = (result.stderr or "").strip()[-1000:]
        time.sleep(10)
    raise ProvisionError(
        f"SSH did not become available at {target.host}:{target.port}. "
        "Confirm that your public SSH key is registered in Vast. "
        f"Last error: {last_error}"
    )


def shell_env(values: dict[str, str]) -> str:
    return "".join(f"export {key}={shlex.quote(value)}\n" for key, value in values.items())


def install_remote(target: SshTarget, runtime_values: dict[str, str], temporary_dir: Path) -> None:
    runtime_path = temporary_dir / "runtime.env"
    runtime_path.write_text(shell_env(runtime_values), encoding="utf-8")
    runtime_path.chmod(0o600)

    log("Uploading the FLUX.2 API service without placing secrets on the command line...")
    run_checked(target.ssh_command("mkdir -p /workspace/flux2-api && chmod 700 /workspace/flux2-api"))
    sources = [
        ASSET_DIR / "server.py",
        ASSET_DIR / "requirements.txt",
        ASSET_DIR / "bootstrap.sh",
        ASSET_DIR / "start.sh",
        runtime_path,
    ]
    run_checked(target.scp_command(sources, "/workspace/flux2-api/"))
    run_checked(
        target.ssh_command(
            "chmod 600 /workspace/flux2-api/runtime.env && "
            "chmod 700 /workspace/flux2-api/bootstrap.sh /workspace/flux2-api/start.sh && "
            "/workspace/flux2-api/bootstrap.sh"
        )
    )


def print_remote_diagnostics(target: SshTarget) -> None:
    command = (
        "for file in /workspace/flux2-api/logs/server.log "
        "/workspace/flux2-api/logs/cloudflared.log /workspace/flux2-api/onstart.log; do "
        "if [ -f \"$file\" ]; then echo \"===== $file =====\"; tail -n 80 \"$file\"; fi; done"
    )
    try:
        output = run_checked(target.ssh_command(command), capture=True, timeout=45)
        if output:
            log("Remote diagnostics:\n" + output[-12000:])
    except Exception as exc:
        log(f"Could not collect remote diagnostics: {exc}")


def read_remote_public_url(target: SshTarget, timeout: int = 240) -> str:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = subprocess.run(
            target.ssh_command("cat /workspace/flux2-api/public-url.txt 2>/dev/null || true"),
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        url = result.stdout.strip()
        if result.returncode == 0 and url.startswith("https://"):
            return url.rstrip("/")
        time.sleep(5)
    raise ProvisionError("Timed out waiting for the HTTPS quick-tunnel URL")


def parse_mapped_port(instance: dict[str, Any], internal_port: int) -> int | None:
    ports = instance.get("ports")
    if isinstance(ports, str):
        try:
            ports = json.loads(ports)
        except json.JSONDecodeError:
            ports = None
    if isinstance(ports, dict):
        entry = ports.get(f"{internal_port}/tcp") or ports.get(str(internal_port))
        if isinstance(entry, list) and entry:
            entry = entry[0]
        if isinstance(entry, dict):
            for key in ("HostPort", "host_port", "public_port", "port"):
                try:
                    if entry.get(key) is not None:
                        return int(entry[key])
                except (TypeError, ValueError):
                    continue
        try:
            if entry is not None:
                return int(entry)
        except (TypeError, ValueError):
            pass
    for container in (instance, instance.get("extra_env"), instance.get("env")):
        if isinstance(container, dict):
            value = container.get(f"VAST_TCP_PORT_{internal_port}")
            try:
                if value is not None:
                    return int(value)
            except (TypeError, ValueError):
                pass
    return None


def mapped_base_url(api: VastApi, instance_id: int, internal_port: int) -> str:
    instance = get_instance(api, instance_id)
    host = instance.get("public_ipaddr") or instance.get("ssh_host")
    port = parse_mapped_port(instance, internal_port)
    if not host or not port:
        raise ProvisionError(
            f"Could not resolve Vast's public mapping for container port {internal_port}. "
            "Use the default --public-mode cloudflare or inspect the instance networking page."
        )
    return f"http://{host}:{port}"


def wait_for_health(base_url: str, timeout: int) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    next_update = 0.0
    last_error = "not started"
    context = ssl.create_default_context()
    while time.monotonic() < deadline:
        try:
            request = urllib.request.Request(f"{base_url}/health", headers={"Accept": "application/json"})
            with urllib.request.urlopen(request, timeout=30, context=context) as response:
                body = json.loads(response.read().decode("utf-8"))
                if response.status == 200 and body.get("status") == "ready":
                    return body
                last_error = f"health returned {response.status}: {body}"
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = str(exc)
        now = time.monotonic()
        if now >= next_update:
            elapsed = int(timeout - max(0, deadline - now))
            log(f"Waiting for FLUX.2 model readiness ({elapsed}s elapsed; downloads can take several minutes)...")
            next_update = now + 60
        time.sleep(10)
    raise ProvisionError(f"Timed out after {timeout}s waiting for {base_url}/health. Last error: {last_error}")


def request_json(
    url: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    expected_statuses: tuple[int, ...] = (200,),
    timeout: int = 60,
) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={
            "Accept": "application/json",
            **({"Content-Type": "application/json"} if payload is not None else {}),
            **(headers or {}),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout, context=ssl.create_default_context()) as response:
            response_body = response.read().decode("utf-8")
            if response.status not in expected_statuses:
                raise ProvisionError(f"API smoke test received HTTP {response.status} from {url}")
            parsed = json.loads(response_body)
            if not isinstance(parsed, dict):
                raise ProvisionError(f"API smoke test received a non-object JSON response from {url}")
            return parsed
    except urllib.error.HTTPError as exc:
        response_text = exc.read().decode("utf-8", errors="replace")[:2000]
        raise ProvisionError(f"API smoke test failed at {url} (HTTP {exc.code}): {response_text}") from exc
    except urllib.error.URLError as exc:
        raise ProvisionError(f"API smoke test could not reach {url}: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise ProvisionError(f"API smoke test received invalid JSON from {url}") from exc


def run_generation_smoke_test(
    base_url: str,
    header_key: str,
    header_value: str,
    timeout: int,
) -> dict[str, Any]:
    auth_headers = {header_key: header_value}
    submission = request_json(
        f"{base_url}/generate",
        method="POST",
        payload={
            "input": {
                "prompt": "A clean purple circle centered on a white background, demo readiness check",
                "image_size": {"width": 512, "height": 512},
                "num_images": 1,
                "guidance_scale": 1.0,
                "num_inference_steps": 4,
                "seed": 42,
            }
        },
        headers=auth_headers,
        expected_statuses=(200, 202),
    )
    request_id = str(submission.get("request_id") or "").strip()
    if not request_id:
        raise ProvisionError("API smoke test submission did not return request_id")

    status_url = f"{base_url}/generate/{urllib.parse.quote(request_id, safe='')}/status"
    result_url = f"{base_url}/generate/{urllib.parse.quote(request_id, safe='')}/result"
    deadline = time.monotonic() + timeout
    last_status = "IN_QUEUE"
    while time.monotonic() < deadline:
        status_payload = request_json(status_url, headers=auth_headers)
        last_status = str(status_payload.get("status") or "").upper()
        if last_status == "COMPLETED":
            break
        if last_status == "FAILED":
            raise ProvisionError(
                f"FLUX.2 smoke generation failed: {status_payload.get('error') or 'unknown inference error'}"
            )
        time.sleep(3)
    else:
        raise ProvisionError(f"FLUX.2 smoke generation did not complete within {timeout}s (last status: {last_status})")

    result_payload = request_json(result_url, headers=auth_headers)
    image_entry = result_payload.get("image")
    image_url = image_entry.get("url") if isinstance(image_entry, dict) else image_entry
    if not isinstance(image_url, str) or not image_url.startswith(f"{base_url}/generate/"):
        raise ProvisionError("FLUX.2 smoke result did not return an expected signed image URL")

    try:
        request = urllib.request.Request(image_url, headers={"Accept": "image/*"})
        with urllib.request.urlopen(request, timeout=60, context=ssl.create_default_context()) as response:
            signature = response.read(16)
            content_type = response.headers.get_content_type()
            if response.status != 200 or content_type != "image/png" or not signature.startswith(b"\x89PNG"):
                raise ProvisionError("FLUX.2 smoke result was not a valid PNG response")
    except urllib.error.HTTPError as exc:
        raise ProvisionError(f"FLUX.2 smoke image download failed (HTTP {exc.code})") from exc
    except urllib.error.URLError as exc:
        raise ProvisionError(f"FLUX.2 smoke image download failed: {exc.reason}") from exc

    return {"status": "passed", "request_id": request_id}


def write_secure_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(4)}.tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(path)


def save_configuration(
    args: argparse.Namespace,
    instance_id: int,
    offer: dict[str, Any],
    base_url: str,
    header_value: str,
    health: dict[str, Any],
) -> tuple[Path, Path, Path]:
    output_dir = args.output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    output_dir.chmod(0o700)

    generate_url = f"{base_url}/generate"
    status_url = f"{base_url}/generate/{{request_id}}/status"
    result_url = f"{base_url}/generate/{{request_id}}/result"
    prefix = output_dir / f"instance-{instance_id}"
    env_path = prefix.with_suffix(".env")
    adapter_path = prefix.with_suffix(".adapter.json")
    state_path = prefix.with_suffix(".json")

    environment = {
        "VAST_INSTANCE_ID": str(instance_id),
        "SAMSAR_FLUX2_MODEL_NAME": args.adapter_name,
        "SAMSAR_FLUX2_GENERATE_URL": generate_url,
        "SAMSAR_FLUX2_STATUS_URL": status_url,
        "SAMSAR_FLUX2_RESULT_URL": result_url,
        "SAMSAR_FLUX2_HEADER_KEY": args.api_header,
        "SAMSAR_FLUX2_HEADER_VALUE": header_value,
    }
    adapter = {
        "id": "vast_flux2_klein_4b",
        "model_key": "CUSTOM_TEXT_TO_IMAGE:vast_flux2_klein_4b",
        "name": args.adapter_name,
        "provider": "custom",
        "operation": "text_to_image",
        "generate_url": generate_url,
        "status_url": status_url,
        "result_url": result_url,
        "header_key": args.api_header,
        "header_value": header_value,
    }
    state = {
        "instance_id": instance_id,
        "offer_id": offer.get("id") or offer.get("ask_contract_id"),
        "gpu": offer.get("gpu_name") or args.gpu,
        "hourly_price": offer_price(offer),
        "model": args.model,
        "base_url": base_url,
        "generate_url": generate_url,
        "status_url": status_url,
        "result_url": result_url,
        "header_key": args.api_header,
        "credential_file": str(env_path),
        "adapter_file": str(adapter_path),
        "health": health,
        "created_at": int(time.time()),
    }

    write_secure_file(env_path, shell_env(environment))
    write_secure_file(adapter_path, json.dumps(adapter, indent=2) + "\n")
    write_secure_file(state_path, json.dumps(state, indent=2) + "\n")
    write_secure_file(output_dir / "latest.env", shell_env(environment))
    write_secure_file(output_dir / "latest.adapter.json", json.dumps(adapter, indent=2) + "\n")
    write_secure_file(output_dir / "latest.json", json.dumps(state, indent=2) + "\n")
    return env_path, adapter_path, state_path


def print_result(
    args: argparse.Namespace,
    instance_id: int,
    offer: dict[str, Any],
    base_url: str,
    header_value: str,
    env_path: Path,
    adapter_path: Path,
    state_path: Path,
) -> None:
    result = {
        "instance_id": instance_id,
        "model": args.model,
        "gpu": offer.get("gpu_name") or args.gpu,
        "hourly_price": offer_price(offer),
        "generate_url": f"{base_url}/generate",
        "poll_url": f"{base_url}/generate/{{request_id}}/status",
        "result_url": f"{base_url}/generate/{{request_id}}/result",
        "header_key": args.api_header,
        "credential_file": str(env_path),
        "adapter_file": str(adapter_path),
        "state_file": str(state_path),
    }
    if args.show_secret:
        result["header_value"] = header_value

    if args.json:
        print(json.dumps(result, indent=2))
        return

    print("FLUX.2 API is live")
    print(f"Instance ID: {instance_id}")
    print(f"Generate URL: {result['generate_url']}")
    print(f"Poll URL:     {result['poll_url']}")
    print(f"Result URL:   {result['result_url']}")
    print(f"Header key:   {args.api_header}")
    if args.show_secret:
        print(f"Header value: {header_value}")
    else:
        print(f"Header value: stored as SAMSAR_FLUX2_HEADER_VALUE in {env_path}")
    print(f"Samsar adapter JSON (contains the credential): {adapter_path}")
    print(f"Load shell values: source {shlex.quote(str(env_path))}")
    print()
    print("Billing continues until the Vast instance is destroyed.")
    print(f"Destroy it when the demo is over: {Path(sys.argv[0]).name} --destroy {instance_id}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Provision an authenticated FLUX.2 Klein API on Vast.ai and wait until it is ready.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Hugging Face model ID")
    parser.add_argument("--gpu", default="RTX 5090", help="Exact Vast GPU model name")
    parser.add_argument("--min-gpu-ram", type=int, default=30000, help="Minimum GPU RAM in MB")
    parser.add_argument("--min-reliability", type=float, default=0.98)
    parser.add_argument("--max-hourly-price", type=float, default=2.0, help="USD/hour ceiling; use 0 to disable")
    parser.add_argument("--offer-limit", type=int, default=20)
    parser.add_argument("--offer-id", type=int, help="Use a specific Vast offer instead of searching")
    parser.add_argument("--instance-id", type=int, help="Reuse and reconfigure an existing Vast instance")
    parser.add_argument("--image", default=DEFAULT_IMAGE, help="Vast container image")
    parser.add_argument("--disk-gb", type=float, default=80)
    parser.add_argument("--rental-type", choices=("ondemand", "bid"), default="ondemand")
    parser.add_argument("--label", default="samsar-flux2-klein-api")
    parser.add_argument("--adapter-name", default="FLUX.2 Klein 4B (Vast.ai)")
    parser.add_argument("--api-header", default="Authorization")
    parser.add_argument("--api-port", type=int, default=8000)
    parser.add_argument("--public-mode", choices=("cloudflare", "mapped"), default="cloudflare")
    parser.add_argument("--ssh-user", default="root")
    parser.add_argument("--ssh-key", type=Path, help="Private SSH key; otherwise use ssh-agent/default keys")
    parser.add_argument("--instance-timeout", type=int, default=900)
    parser.add_argument("--ready-timeout", type=int, default=3600)
    parser.add_argument("--smoke-timeout", type=int, default=600)
    parser.add_argument(
        "--env-file",
        type=Path,
        default=Path(os.getenv("VAST_ENV_FILE", "~/.config/samsar/vast.env")).expanduser(),
        help="Non-executable KEY=value secret file",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("~/.config/samsar/vast-flux2").expanduser(),
    )
    parser.add_argument("--diffusers-spec", default="git+https://github.com/huggingface/diffusers.git")
    parser.add_argument("--cpu-offload", action="store_true", help="Lower VRAM usage at the cost of speed")
    parser.add_argument("--skip-smoke-test", action="store_true", help="Skip the post-readiness inference test")
    parser.add_argument(
        "--configure-samsar",
        action="store_true",
        help="Also save the adapter to the local standalone Samsar user and set the Agent image default",
    )
    parser.add_argument("--samsar-user-email", help="Target this local Samsar user when configuring")
    parser.add_argument("--samsar-processor-container", default="samsar-processor-1")
    parser.add_argument("--destroy-on-failure", action="store_true")
    parser.add_argument("--destroy", type=int, metavar="INSTANCE_ID", help="Destroy a provisioned instance and exit")
    parser.add_argument("--plan", action="store_true", help="Print the resolved non-secret plan without provisioning")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate credentials, billing, SSH setup, model access, and offer availability without provisioning",
    )
    parser.add_argument("--json", action="store_true", help="Print the final non-secret result as JSON")
    parser.add_argument("--show-secret", action="store_true", help="Also print the generated API header value")
    return parser


def validate_args(args: argparse.Namespace) -> None:
    if args.max_hourly_price == 0:
        args.max_hourly_price = None
    if args.max_hourly_price is not None and args.max_hourly_price <= 0:
        raise ProvisionError("--max-hourly-price must be positive, or 0 to disable the ceiling")
    if not 0 < args.min_reliability <= 1:
        raise ProvisionError("--min-reliability must be greater than 0 and at most 1")
    if args.rental_type == "bid" and args.max_hourly_price is None:
        raise ProvisionError("Bid instances require a non-zero --max-hourly-price")
    if args.disk_gb < 40:
        raise ProvisionError("--disk-gb must be at least 40 for the model, cache, and dependencies")
    if not 1024 <= args.api_port <= 65535:
        raise ProvisionError("--api-port must be between 1024 and 65535")
    if args.ssh_key:
        args.ssh_key = args.ssh_key.expanduser().resolve()
        if not args.ssh_key.is_file():
            raise ProvisionError(f"SSH private key does not exist: {args.ssh_key}")
    if args.instance_id and args.offer_id:
        raise ProvisionError("--instance-id and --offer-id cannot be combined")
    if not args.model.strip():
        raise ProvisionError("--model cannot be empty")
    if not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", args.api_header):
        raise ProvisionError("--api-header is not a valid HTTP header name")
    for label, value in (
        ("--instance-timeout", args.instance_timeout),
        ("--ready-timeout", args.ready_timeout),
        ("--smoke-timeout", args.smoke_timeout),
        ("--offer-limit", args.offer_limit),
    ):
        if value <= 0:
            raise ProvisionError(f"{label} must be positive")


def print_plan(args: argparse.Namespace) -> None:
    plan = {
        "action": "reconfigure" if args.instance_id else "provision",
        "instance_id": args.instance_id,
        "model": args.model,
        "gpu": args.gpu,
        "min_gpu_ram_mb": args.min_gpu_ram,
        "max_hourly_price": args.max_hourly_price,
        "container_image": args.image,
        "disk_gb": args.disk_gb,
        "rental_type": args.rental_type,
        "public_mode": args.public_mode,
        "credential_output_dir": str(args.output_dir.expanduser()),
        "api_contract": {
            "generate": "POST <base>/generate",
            "poll": "GET <base>/generate/{request_id}/status",
            "result": "GET <base>/generate/{request_id}/result",
        },
    }
    print(json.dumps(plan, indent=2))


def run_preflight(api: VastApi, credentials: dict[str, str], args: argparse.Namespace) -> list[dict[str, Any]]:
    require_local_tools()
    log("Checking Vast API access, billing credit, and account SSH configuration...")
    verify_account(api)
    log(f"Checking access to Hugging Face model {args.model}...")
    verify_hugging_face_model(args.model, credentials.get("HF_TOKEN", ""))
    if args.instance_id:
        get_instance(api, args.instance_id)
        return []
    if args.offer_id:
        return [get_specific_offer(api, args.offer_id)]
    log(f"Searching Vast for a verified {args.gpu} with at least {args.min_gpu_ram} MB VRAM...")
    return search_offers(api, args)


def configure_local_samsar(args: argparse.Namespace, adapter_path: Path) -> None:
    script_path = ASSET_DIR.parent.parent / "configure-samsar-custom-image-model.sh"
    command = [
        str(script_path),
        "--adapter-file",
        str(adapter_path),
        "--container",
        args.samsar_processor_container,
    ]
    if args.samsar_user_email:
        command.extend(("--user-email", args.samsar_user_email))
    log("Saving the custom image model to the local standalone Samsar user...")
    run_checked(command)


def destroy_instance(api: VastApi, instance_id: int) -> None:
    api.request("DELETE", f"/instances/{instance_id}/")
    print(f"Vast instance {instance_id} was destroyed. Its API URL is no longer available.")


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        validate_args(args)
        if args.plan:
            print_plan(args)
            return 0

        credentials = resolve_credentials(args.env_file)
        api = VastApi(credentials["VAST_API_KEY"])
        if args.destroy:
            destroy_instance(api, args.destroy)
            return 0

        offers = run_preflight(api, credentials, args)
        if args.check:
            result: dict[str, Any] = {
                "status": "ready_to_provision",
                "model": args.model,
                "gpu": args.gpu,
                "instance_id": args.instance_id,
            }
            if offers:
                result["matching_offers"] = len(offers)
                result["selected_offer_id"] = offers[0].get("id")
                result["selected_offer_hourly_price"] = offer_price(offers[0])
            print(json.dumps(result, indent=2))
            return 0

        header_value = (
            credentials.get("FLUX2_API_HEADER_VALUE") or f"Bearer {secrets.token_urlsafe(48)}"
        ).strip()
        if not header_value or "\r" in header_value or "\n" in header_value or len(header_value) > 8192:
            raise ProvisionError("FLUX2_API_HEADER_VALUE is not a valid HTTP header value")
        instance_id: int | None = args.instance_id
        offer: dict[str, Any]

        if instance_id:
            instance = get_instance(api, instance_id)
            offer = {
                "id": instance.get("ask_contract_id") or instance.get("machine_id"),
                "gpu_name": instance.get("gpu_name") or args.gpu,
                "dph_total": instance.get("dph_total", instance.get("dph_base", 0)),
            }
            log(f"Reconfiguring existing Vast instance {instance_id}...")
        else:
            instance_id, offer = create_from_offers(api, offers, args)
            log(f"Created Vast instance {instance_id}. Billing has started.")

        assert instance_id is not None
        target: SshTarget | None = None
        try:
            instance = wait_for_instance(api, instance_id, args.instance_timeout)
            ssh_host = str(instance["ssh_host"])
            ssh_port = int(instance["ssh_port"])
            with tempfile.TemporaryDirectory(prefix="samsar-vast-flux2-") as temporary_name:
                temporary_dir = Path(temporary_name)
                target = SshTarget(
                    host=ssh_host,
                    port=ssh_port,
                    user=args.ssh_user,
                    known_hosts=temporary_dir / "known_hosts",
                    identity_file=args.ssh_key,
                )
                log(f"Waiting for SSH on {ssh_host}:{ssh_port}...")
                wait_for_ssh(target, min(args.instance_timeout, 600))
                runtime_values = {
                    "FLUX_MODEL_ID": args.model,
                    "FLUX_API_HEADER": args.api_header,
                    "FLUX_API_HEADER_VALUE": header_value,
                    "FLUX_PORT": str(args.api_port),
                    "FLUX_PUBLIC_MODE": args.public_mode,
                    "FLUX_DIFFUSERS_SPEC": args.diffusers_spec,
                    "FLUX_CPU_OFFLOAD": "1" if args.cpu_offload else "0",
                    "HF_HOME": "/workspace/.cache/huggingface",
                    "HF_TOKEN": credentials.get("HF_TOKEN", ""),
                }
                try:
                    log("Installing runtime dependencies and starting the API service...")
                    install_remote(target, runtime_values, temporary_dir)
                    if args.public_mode == "cloudflare":
                        base_url = read_remote_public_url(target)
                    else:
                        log("WARNING: mapped mode uses plain HTTP; API credentials are not encrypted in transit.")
                        base_url = mapped_base_url(api, instance_id, args.api_port)

                    log(f"Public API endpoint created at {base_url}; waiting for the model to load...")
                    health = wait_for_health(base_url, args.ready_timeout)
                    if not args.skip_smoke_test:
                        log("Running an authenticated 512px FLUX.2 inference smoke test...")
                        health["smoke_test"] = run_generation_smoke_test(
                            base_url,
                            args.api_header,
                            header_value,
                            args.smoke_timeout,
                        )
                except Exception:
                    print_remote_diagnostics(target)
                    raise

            env_path, adapter_path, state_path = save_configuration(
                args, instance_id, offer, base_url, header_value, health
            )
            configuration_error: Exception | None = None
            if args.configure_samsar:
                try:
                    configure_local_samsar(args, adapter_path)
                except (ProvisionError, subprocess.TimeoutExpired) as exc:
                    configuration_error = exc
            print_result(
                args, instance_id, offer, base_url, header_value, env_path, adapter_path, state_path
            )
            if configuration_error is not None:
                log(
                    "ERROR: The FLUX.2 API is live, but local Samsar configuration failed: "
                    f"{configuration_error}"
                )
                log(
                    "The Vast instance was left running. Retry local configuration with: "
                    f"{ASSET_DIR.parent.parent / 'configure-samsar-custom-image-model.sh'} "
                    f"--adapter-file {adapter_path}"
                )
                return 1
            return 0
        except Exception:
            log(f"Provisioning did not finish. Vast instance {instance_id} may still be billable.")
            if args.destroy_on_failure and not args.instance_id:
                log(f"--destroy-on-failure is set; destroying instance {instance_id}...")
                api.request("DELETE", f"/instances/{instance_id}/")
            else:
                log(f"After inspecting it, destroy with: {Path(sys.argv[0]).name} --destroy {instance_id}")
            raise
    except (ProvisionError, subprocess.TimeoutExpired) as exc:
        log(f"ERROR: {exc}")
        return 1
    except KeyboardInterrupt:
        log("Interrupted. Any created Vast instance remains running and billable until explicitly destroyed.")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
