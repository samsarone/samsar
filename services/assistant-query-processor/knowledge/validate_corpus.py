"""Validate the static corpus without a model, database connection or network."""
import argparse
import collections
import json
from pathlib import Path

from corpus import HERE, assert_safe, corpus_checksum, digest, read_jsonl


def validate(directory):
    manifest = json.loads((directory / "manifest.json").read_text())
    documents = read_jsonl(directory / "documents.jsonl")
    chunks = read_jsonl(directory / "chunks.jsonl")
    sources = json.loads((directory / "sources.json").read_text())
    source_ids = {row["id"] for row in sources}
    document_ids = {row["id"] for row in documents}
    if corpus_checksum(chunks, sources) != manifest["corpus_version"]:
        raise ValueError("Corpus/provenance checksum mismatch")
    for key, rows in [("documents", documents), ("chunks", chunks), ("sources", sources)]:
        if len(rows) != manifest[key] or len({row["id"] for row in rows}) != len(rows):
            raise ValueError(f"Invalid {key} count or duplicate IDs")
    for row in documents + chunks:
        if not row["source_ids"] or not set(row["source_ids"]).issubset(source_ids):
            raise ValueError("Incomplete source attribution")
        if row["audience"] not in {"public", "operator"} or row["freshness"] not in {"current", "editorial", "historical"}:
            raise ValueError("Invalid audience/freshness")
        assert_safe(row["text"], row["id"])
    for row in chunks:
        if row["document_id"] not in document_ids or digest(row["embedding_text"]) != row["input_sha256"]:
            raise ValueError("Invalid chunk parent or embedding input")
        if not row["embedding_text"].startswith(manifest["model"]["document_prefix"]):
            raise ValueError("Missing document prefix")
    allowed_paths = [row["path"] + "/" for row in manifest["production_projects"]]
    for source in sources:
        if source["kind"] == "code" and not any(source["path"].startswith(path) for path in allowed_paths):
            raise ValueError("Code source is outside production scope")
    return {"status": "valid", "documents": len(documents), "chunks": len(chunks), "sources": len(sources),
            "document_kinds": dict(collections.Counter(row["kind"] for row in documents)),
            "embedding_status": manifest["embedding_status"], "corpus_version": manifest["corpus_version"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, default=HERE / "snapshot")
    args = parser.parse_args()
    print(json.dumps(validate(args.corpus), indent=2))
