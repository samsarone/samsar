"""Build a static, cited corpus. Never reads environment files or runs source code."""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCHEMA_VERSION = 1


def digest(value):
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def corpus_checksum(chunks, sources):
    # Provenance changes are releases too, even when the visible words are unchanged.
    return digest(canonical({"chunks": sorted(chunks, key=lambda row: row["id"]),
                             "sources": sorted(sources, key=lambda row: row["id"])}))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def read_jsonl(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def write_jsonl(path, records):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text("".join(canonical(row) + "\n" for row in records))
    temporary.replace(path)


def assert_safe(text, label):
    patterns = [r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
                r"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{30,}",
                r"\bAKIA[0-9A-Z]{16}\b",
                r"(?:mongodb(?:\+srv)?|https?)://[^\s/:]+:[^\s/@]+@"]
    if any(re.search(pattern, text) for pattern in patterns):
        raise ValueError(f"Potential credential material in {label}; content not printed")


def safe_file(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError(f"Source is not a regular file inside its allowed root: {relative}")
    if any(part in {"node_modules", ".git", "secrets", "credentials", "logs"}
           or part.startswith((".env", "env.")) or part.endswith(".env")
           for part in path.relative_to(root.resolve()).parts):
        raise ValueError(f"Excluded source path: {relative}")
    return path


def production_map(production):
    text = safe_file(production, "SOURCE_MANIFEST.md").read_text()
    rows = re.findall(r"^\| `([^`]+)` \| `([^`]+)` \| `([^`]+)` \| `([^`]+)` \| ([^|]+)\|", text, re.M)
    if not rows:
        raise ValueError("Production source manifest is empty or has an unknown format")
    mappings = [{"project": a, "path": b, "commit": c, "branch": d, "tree": e.strip()}
                for a, b, c, d, e in rows]
    if any(row["project"] in {"samsar_audiocraft_gen", "gentle-aligner", "Gentle"} for row in mappings):
        raise ValueError("Retired project unexpectedly present in production scope")
    return mappings, digest(text)


def clean_markdown(text):
    text = re.sub(r"\A---\n.*?\n---\n", "", text, flags=re.S)
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    # Discard presentation tags, retaining their visible words and Markdown bodies.
    text = re.sub(r"<picture>.*?</picture>", "", text, flags=re.S)
    text = re.sub(r"</?(?:details|summary|div|p|a|strong|br|img|source)\b[^>]*>", "", text)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    text = re.sub(r"/Users/[^\s)\"`]+", "[local-workspace-path]", text)
    return re.sub(r"\n{3,}", "\n\n", html.unescape(text)).strip()


def sections(text, fallback_title):
    """Headings inside fenced examples are data, not section boundaries."""
    stack, body, fence = [], [], None
    for line in text.splitlines():
        marker = re.match(r"^\s*(`{3,}|~{3,})", line)
        if marker:
            char = marker[1][0]
            fence = None if fence == char else (char if fence is None else fence)
        match = re.match(r"^(#{1,6})\s+(.+?)\s*#*\s*$", line) if fence is None else None
        if match:
            if "\n".join(body).strip():
                yield " > ".join(stack) or fallback_title, "\n".join(body).strip()
            level, title = len(match[1]), match[2]
            stack = stack[:level - 1] + [title]
            body = []
        else:
            body.append(line)
    if "\n".join(body).strip():
        yield " > ".join(stack) or fallback_title, "\n".join(body).strip()


def split_text(text, fits):
    """Lossless bounded splits, favoring paragraph, line, then word boundaries."""
    text = text.strip()
    while text:
        if fits(text):
            yield text
            return
        low, high = 1, len(text)
        while low < high:
            middle = (low + high + 1) // 2
            if fits(text[:middle]):
                low = middle
            else:
                high = middle - 1
        if not fits(text[:low]):
            raise ValueError("Embedding context prefix leaves no room for content")
        boundary = low
        for separator in ["\n\n", "\n", " "]:
            candidate = text.rfind(separator, low // 2, low)
            if candidate > 0:
                boundary = candidate
                break
        yield text[:boundary].strip()
        text = text[boundary:].strip()


def topic_tags(text):
    lower = text.lower()
    groups = {"vidgenie": ["vidgenie", "image-list", "text-to-video", "text_to_video"],
              "video": ["video", "scene", "render", "frame"],
              "image": ["image", "mask", "inpaint"],
              "audio": ["audio", "speech", "music", "sound", "voice"],
              "assistant": ["assistant", "chat", "streaming"],
              "billing": ["credit", "pricing", "billing", "idempotency"],
              "search": ["embedding", "search", "retrieval", "recommendation"],
              "deployment": ["docker", "deploy", "provider", "adapter"]}
    return [tag for tag, terms in groups.items() if any(term in lower for term in terms)]


def indexable_text(text):
    """Repeat table column meaning on every row so splits cannot detach prices from units."""
    lines, result, index = text.splitlines(), [], 0
    def cells(line):
        return [cell.strip() for cell in re.split(r"(?<!\\)\|", line.strip().strip("|"))]
    while index < len(lines):
        if index + 1 < len(lines) and "|" in lines[index]:
            separators = cells(lines[index + 1])
            headers = cells(lines[index])
            if len(headers) == len(separators) and all(re.fullmatch(r":?-{3,}:?", c) for c in separators):
                index += 2
                while index < len(lines) and "|" in lines[index] and lines[index].strip():
                    values = cells(lines[index])
                    if len(values) != len(headers):
                        raise ValueError("Malformed Markdown table; review before indexing")
                    result.append("; ".join(f"{key}: {value}" for key, value in zip(headers, values)))
                    index += 1
                continue
        result.append(lines[index])
        index += 1
    return "\n".join(result)


def source_record(uri, kind, data, **extra):
    return {"id": digest(uri)[:24], "uri": uri, "kind": kind, "sha256": digest(data), **extra}


def build_corpus(workspace, production, output, model_dir=None):
    mappings, manifest_hash = production_map(production)
    projects = {row["project"] for row in mappings}
    sources, documents = {}, []

    def add_source(record):
        sources[record["id"]] = record
        return record["id"]

    def add_document(title, body, refs, kind, authority, audience="public", freshness="current", **extra):
        body = clean_markdown(body)
        if not body:
            return
        assert_safe(body, title)
        identity = canonical([title, body, refs, audience, freshness])
        documents.append({"id": digest(identity)[:32], "title": title, "text": body,
                          "source_ids": refs, "kind": kind, "authority": authority,
                          "audience": audience, "freshness": freshness,
                          "tags": topic_tags(title + " " + body), **extra})

    # Use the documentation's existing MDX-to-text expansion, including shared tables.
    if "samsar-docs" not in projects or "samsar_blog" not in projects:
        raise ValueError("Expected documentation/blog projects are outside production scope")
    export = safe_file(workspace / "samsar-docs", "static/llms.txt").read_text()
    export_hash = digest(export)
    for block in export.split("=== DOCUMENT START ===")[1:]:
        relative = re.search(r"^SOURCE_PATH: (.+)$", block, re.M)[1]
        source = safe_file(workspace / "samsar-docs", relative)
        content = block.split("CONTENT_START\n", 1)[1].split("\nCONTENT_END", 1)[0]
        title = re.search(r"^PRIMARY_HEADING: (.+)$", block, re.M)[1]
        slug = re.search(r"^  slug: (.+)$", block, re.M)
        url = "https://docs.samsar.one" + (slug[1] if slug else "/")
        snap = production / "apps/docs" / relative
        ref = add_source(source_record(url, "docs", source.read_bytes(), path=f"samsar-docs/{relative}",
                         snapshot_match=snap.is_file() and digest(snap.read_bytes()) == digest(source.read_bytes()),
                         normalized_export_sha256=digest(content), project="samsar-docs"))
        add_document(title, content, [ref], "docs", 80)

    # Explicit first-party documentation only. Do not traverse vendored services.
    mono = workspace / "samsar"
    for path in [mono / "README.md", *sorted((mono / "pages").glob("*.md")), mono / "docs/runtime-modes.md"]:
        relative = path.relative_to(mono).as_posix()
        source = safe_file(mono, relative)
        ref = add_source(source_record(f"repo:samsar/{relative}", "monorepo_docs", source.read_bytes(),
                                      path=f"samsar/{relative}", project="samsar", scope="documentation_only"))
        for title, body in sections(clean_markdown(source.read_text()), source.stem):
            # Infrastructure guidance is retained for operators but never returned by default.
            operator = relative == "docs/runtime-modes.md" or relative in {
                "pages/setup-wizard.md", "pages/architecture.md"} or any(
                term in title.lower() for term in ["deployment", "local media", "docker", "quick start", "repository", "verification", "regression", "runtime", "maintenance"])
            add_document(title, body, [ref], "monorepo_docs", 70, "operator" if operator else "public")

    # Blog source repository metadata; Ghost internals and persisted user data are excluded.
    for relative in ["README.md", "BLOG_SETUP.md"]:
        path = safe_file(production / "apps/blog", relative)
        ref = add_source(source_record(f"repo:samsar_blog/{relative}", "project_docs", path.read_bytes(),
                                      path=f"apps/blog/{relative}", project="samsar_blog", scope="production_snapshot"))
        add_document(f"Blog integration: {relative}", path.read_text(), [ref], "project_docs", 75, "operator")

    blog = json.loads((HERE / "sources/blog.json").read_text())
    for entry in blog["articles"]:
        ref = add_source(source_record(entry["url"], "blog", canonical(entry),
                                      published_at=entry["published_at"], retrieved_at=blog["retrieved_at"],
                                      retrieval=entry.get("retrieval", "web")))
        # Summaries are deliberately bounded and reviewed; obsolete prices/models stay historical.
        add_document(entry["title"], entry["summary"], [ref], "blog_history", 25,
                     freshness="historical", published_at=entry["published_at"])
        if entry.get("evergreen_guidance"):
            add_document(entry["title"] + " — creative workflow guidance", entry["evergreen_guidance"],
                         [ref], "creative_guidance", 55, freshness="editorial")

    analysis = json.loads((HERE / "sources/code-analysis.json").read_text())
    for entry in analysis["entries"]:
        refs = []
        for evidence in entry["evidence"]:
            relative = evidence["path"]
            mapping = next((row for row in mappings if relative.startswith(row["path"] + "/")), None)
            if not mapping:
                raise ValueError(f"Code evidence outside production manifest: {relative}")
            path = safe_file(production, relative)
            data = path.read_bytes()
            if digest(data) != evidence["reviewed_sha256"]:
                raise ValueError(f"Code analysis needs review after source change: {relative}")
            text = data.decode()
            anchor = evidence["anchor"]
            if anchor not in text:
                raise ValueError(f"Missing evidence anchor: {relative}")
            line = text[:text.index(anchor)].count("\n") + 1
            source_path = mapping["project"] + relative[len(mapping["path"]):]
            current = workspace / source_path
            refs.append(add_source(source_record(f"production:{relative}", "code", data,
                        path=relative, project=mapping["project"], source_path=source_path,
                        recorded_commit=mapping["commit"], recorded_tree=mapping["tree"],
                        scope="production_snapshot",
                        current_source_matches_snapshot=current.is_file() and digest(current.read_bytes()) == digest(data))))
            evidence["line"] = line
        add_document(entry["title"], entry["text"], refs, "code_analysis", 100,
                     entry.get("audience", "public"), evidence=entry["evidence"])

    model = json.loads((HERE / "model.json").read_text())
    chunks = {}
    for doc in sorted(documents, key=lambda row: (-row["authority"], row["id"])):
        for heading, body in sections(doc["text"], doc["title"]):
            title = f"{doc['title']} | {heading}" if heading != doc["title"] else heading
            title = title[:220]
            prefix = model["document_prefix"] + title + "\n"
            fits = lambda value: len((prefix + value).encode()) <= 430
            for part in split_text(indexable_text(body), fits):
                # Scope is part of the identity: operator/history text cannot acquire public scope by deduplication.
                key = digest(canonical([re.sub(r"\s+", " ", part).strip(), doc["audience"], doc["freshness"]]))
                if key in chunks:
                    chunks[key]["source_ids"] = sorted(set(chunks[key]["source_ids"] + doc["source_ids"]))
                    continue
                embedding_text = prefix + part
                chunks[key] = {"id": key[:32], "document_id": doc["id"], "title": title,
                               "text": part, "embedding_text": embedding_text,
                               "input_sha256": digest(embedding_text), "source_ids": doc["source_ids"],
                               "kind": doc["kind"], "authority": doc["authority"],
                               "audience": doc["audience"], "freshness": doc["freshness"], "tags": doc["tags"]}
    corpus = sorted(chunks.values(), key=lambda row: row["id"])
    version = corpus_checksum(corpus, list(sources.values()))
    output.mkdir(parents=True, exist_ok=True)
    write_jsonl(output / "documents.jsonl", sorted(documents, key=lambda row: row["id"]))
    write_jsonl(output / "chunks.jsonl", corpus)
    write_json(output / "sources.json", sorted(sources.values(), key=lambda row: row["id"]))
    manifest = {"schema_version": SCHEMA_VERSION, "corpus_version": version,
                "built_at": datetime.now(timezone.utc).isoformat(), "documents": len(documents),
                "chunks": len(corpus), "sources": len(sources), "production_manifest_sha256": manifest_hash,
                "documentation_export_sha256": export_hash,
                "production_projects": mappings, "model": model,
                "chunking": "conservative_utf8_430",
                "embedding_status": "not_built", "audience_default": "public",
                "historical_default": False,
                "source_precedence": ["reviewed production code", "current docs", "monorepo docs", "creative guidance", "historical blog"],
                "exclusions": ["secrets and env files", "customer sessions and assets", "vendor/framework internals", "retired projects", "unreviewed raw source code", "page-specific system prompts"]}
    write_json(output / "manifest.json", manifest)
    overview = ["# Samsar assistant knowledge base", "",
                f"Corpus version: `{version}`", "",
                "Static reference material, not system instructions. Source priority is metadata for resolving conflicting factual claims; retrieval ranking alone does not guarantee conflict resolution. Historical blog summaries are excluded from default retrieval. Operator material requires an explicit audience selection.", "",
                "This assistant knowledge index uses local embeddings in both hosted and production deployments. Existing documentation about OpenAI-backed managed search APIs describes a separate product surface. No live session data, page-specific system prompts or runtime assistant integration is included here.", "",
                "The code analysis describes the checked production integration snapshot. Documentation may be newer; source hashes and snapshot-match flags preserve that distinction. The source manifest records dirty trees, so commit IDs alone are not sufficient provenance.", "",
                f"{len(documents)} documents; {len(corpus)} chunks; {len(sources)} sources.", "",
                "## Contents", ""]
    ordered = sorted(documents, key=lambda row: (-row["authority"], row["title"], row["id"]))
    for doc in ordered:
        overview.append(f"- [{doc['title']}](#document-{doc['id']}) · {doc['kind']} · {doc['audience']} · {doc['freshness']}")
    for doc in ordered:
        overview += ["", f'<a id="document-{doc["id"]}"></a>', f"## {doc['title']}", "",
                     f"Source class: {doc['kind']}; audience: {doc['audience']}; freshness: {doc['freshness']}.", "",
                     "Sources: " + "; ".join(sources[key]["uri"] for key in doc["source_ids"]), "", doc["text"], ""]
    (output / "knowledge-base.md").write_text("\n".join(line.rstrip() for line in "\n".join(overview).splitlines()) + "\n")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, default=HERE.parents[1])
    parser.add_argument("--production", type=Path)
    parser.add_argument("--output", type=Path, default=HERE / "snapshot")
    args = parser.parse_args()
    production = args.production or args.workspace.parent / "samsar-production"
    manifest = build_corpus(args.workspace.resolve(), production.resolve(), args.output, None)
    print(canonical({key: manifest[key] for key in ["corpus_version", "documents", "chunks", "sources", "chunking"]}))


if __name__ == "__main__":
    main()
