#!/usr/bin/env python3
"""Generate compact README diagrams as accessible, theme-specific SVGs.

Run from any directory with Python 3 (standard library only). Keep the stage
summaries aligned with pages/ and the current services. The README supplies
click-through links and expandable details; SVGs contain no scripts or fonts.
"""
from dataclasses import dataclass
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "docs" / "readme-diagrams"
WIDTH = 1200
MARGIN = 12
GAP = 30
TOP = 22
CARD_HEIGHT = 188


@dataclass(frozen=True)
class Stage:
    label: str
    title: str
    lines: tuple[str, ...]
    owner: str
    parallel: bool = False


@dataclass(frozen=True)
class Diagram:
    key: str
    title: str
    description: str
    stages: tuple[Stage, ...]
    note: str
    runtime: bool = False


DIAGRAMS = (
    Diagram(
        "architecture", "Standalone architecture",
        "Studio and SDK clients call the processor. Workers consume MongoDB-backed "
        "jobs and call model providers. The processor also calls providers directly "
        "for inference and embeddings. Services share state and media storage.",
        (
            Stage("INTERFACE", "Studio + SDK", ("Create, edit, automate", "Poll status or stream", "Preview and download"), "Browser / API client"),
            Stage("CONTROL", "Processor API", ("Auth, credits, validation", "Sessions and job state", "Search and assistants"), "processor"),
            Stage("EXECUTION", "Workers", ("Workflow coordination", "Image, audio and video", "Frames and final render"), "services/*"),
            Stage("MODELS", "Providers", ("Samsar managed API", "Native / partner APIs", "Custom model endpoints"), "Configured adapters"),
        ),
        "Shared: MongoDB state · Media volumes + object storage · Optional Loki / Grafana logs",
        runtime=True,
    ),
    Diagram(
        "text-to-video", "Text to video",
        "Validate a prompt, save a narrative plan, generate images and audio in "
        "parallel, animate and finish scenes, then render and deliver the video.",
        (
            Stage("01 / VALIDATE", "Request", ("Prompt and settings", "Auth, credits, models", "Return request ID"), "processor"),
            Stage("02 / PLAN", "Narrative", ("Theme and scene script", "Validate speech length", "Save scene + audio plan"), "processor builder"),
            Stage("03 / PARALLEL", "Generate", ("Scene images", "Speech", "Music"), "image + audio workers", True),
            Stage("04 / FINISH", "Animate", ("Image-to-video clips", "Optional lip sync / SFX", "Avatar and subtitles"), "AI video + listener"),
            Stage("05 / DELIVER", "Render", ("Frames + audio mix", "FFmpeg composition", "URL, status, webhook"), "frames + video workers"),
        ),
        "Motion waits for images, speech and music. Eligible finishing jobs overlap; final rendering joins them.",
    ),
    Diagram(
        "image-list-to-video", "Image list to video",
        "Prepare source images, plan scenes and optional CTA assets, prepare "
        "images and audio in parallel, animate eligible scenes, then render and deliver.",
        (
            Stage("01 / PREPARE", "Source images", ("Fetch and validate URLs", "Inspect / crop to fit", "Persist prepared copies"), "processor"),
            Stage("02 / PLAN", "Creative plan", ("Describe source images", "Narrative and scene plan", "Optional CTA / footer"), "processor builder"),
            Stage("03 / PARALLEL", "Prepare media", ("Images / edits", "Speech", "Music"), "image + audio workers", True),
            Stage("04 / FINISH", "Animate", ("Animate eligible scenes", "Optional lip sync / SFX", "Avatar and subtitles"), "AI video + listener"),
            Stage("05 / DELIVER", "Render", ("Frames + audio mix", "FFmpeg composition", "URL, status, webhook"), "frames + video workers"),
        ),
        "Supplied images anchor the scenes. Generated terminal outros skip AI motion; direct one-image clips use a separate API.",
    ),
    Diagram(
        "search", "Search and embeddings",
        "Index creation prepares and embeds records into a reusable MongoDB "
        "template. Later queries reuse that template, filter candidates and optionally rerank.",
        (
            Stage("INDEX / 01", "Prepare", ("JSON, text or URLs", "Normalize record fields", "Crawl URLs if supplied"), "processor / Firecrawl"),
            Stage("INDEX / 02", "Embed", ("Encode source content", "Preserve record IDs", "Attach filter metadata"), "OpenAI embeddings"),
            Stage("SHARED / 03", "Store", ("Reusable template", "Vectors + source records", "Return template ID"), "MongoDB"),
            Stage("QUERY / 04", "Search", ("Query + template ID", "Embed query and filter", "Retrieve candidates"), "processor + MongoDB"),
            Stage("QUERY / 05", "Rank", ("Similarity scores", "Optional LLM rerank", "Return matching records"), "processor"),
        ),
        "Index once, query many times. Retrieval uses vector search when available, with an in-memory cosine fallback.",
    ),
    Diagram(
        "recommendations", "Recommendations",
        "A text or structured reference is matched against an existing embedding "
        "template through the shared search implementation, returning compact ID and score pairs.",
        (
            Stage("01 / INPUT", "Reference", ("Text or structured item", "Existing template ID", "Limit and filters"), "API client"),
            Stage("02 / CONSTRAIN", "Match rules", ("Normalize the reference", "Apply configured filters", "Choose candidate count"), "processor"),
            Stage("03 / REUSE", "Shared search", ("Embed the reference", "Retrieve similar records", "Reuse the stored corpus"), "embeddings + MongoDB"),
            Stage("04 / RETURN", "Matches", ("Compact ID + score pairs", "No LLM reranking", "Related items / products"), "processor"),
        ),
        "Uses the same embedding templates as search. A recommendation request does not rebuild the index.",
    ),
)

THEMES = {
    "light": dict(bg="#ffffff", card="#f6f8fa", ink="#1f2328", muted="#59636e", border="#d1d9e0", line="#818b98", accents=("#0969da", "#8250df", "#1a7f37", "#9a6700", "#0969da")),
    "dark": dict(bg="#0d1117", card="#151b23", ink="#f0f6fc", muted="#b1bac4", border="#3d444d", line="#9198a1", accents=("#79c0ff", "#d2a8ff", "#7ee787", "#e3b341", "#79c0ff")),
}


def render(diagram: Diagram, theme: dict) -> str:
    height = 318 if diagram.runtime else 268
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{height}" viewBox="0 0 {WIDTH} {height}" role="img" aria-labelledby="title desc">',
        f'<title id="title">{escape(diagram.title)}</title>',
        f'<desc id="desc">{escape(diagram.description)}</desc>',
        '<defs>',
        f'<marker id="arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L8 4L0 8Z" fill="{theme["line"]}"/></marker>',
        '</defs>',
        f'<rect width="{WIDTH}" height="{height}" rx="12" fill="{theme["bg"]}"/>',
        '<g font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif">',
    ]

    def text(x, y, value, size=16, color=None, weight=400, anchor="start"):
        parts.append(f'<text x="{x:g}" y="{y:g}" font-size="{size}" font-weight="{weight}" fill="{color or theme["ink"]}" text-anchor="{anchor}">{escape(value)}</text>')

    def path(d, dashed=False, both=False):
        dash = ' stroke-dasharray="5 4"' if dashed else ''
        start = ' marker-start="url(#arrow)"' if both else ''
        parts.append(f'<path d="{d}" fill="none" stroke="{theme["line"]}" stroke-width="1.6"{dash}{start} marker-end="url(#arrow)"/>')

    count = len(diagram.stages)
    card_width = (WIDTH - MARGIN * 2 - GAP * (count - 1)) / count
    centers = []
    for i, stage in enumerate(diagram.stages):
        x = MARGIN + i * (card_width + GAP)
        centers.append(x + card_width / 2)
        accent = theme["accents"][i]
        parts.append(f'<rect x="{x:g}" y="{TOP}" width="{card_width:g}" height="{CARD_HEIGHT}" rx="10" fill="{theme["card"]}" stroke="{theme["border"]}"/>')
        text(x + 16, TOP + 27, stage.label, 12, accent, 650)
        text(x + 16, TOP + 59, stage.title, 23, weight=650)
        if stage.parallel:
            # Fork and join within a stage make concurrency visible without
            # adding a second workflow row or implying arbitrary job ordering.
            left, right = x + 19, x + card_width - 18
            parts.append(f'<path d="M{left + 7:g} {TOP + 83} H{left:g} V{TOP + 129} H{left + 7:g} M{right - 7:g} {TOP + 83} H{right:g} V{TOP + 129} H{right - 7:g}" fill="none" stroke="{accent}" stroke-width="1.5"/>')
            for j, line in enumerate(stage.lines):
                text(x + card_width / 2, TOP + 88 + j * 23, line, 16, anchor="middle")
        else:
            for j, line in enumerate(stage.lines):
                text(x + 16, TOP + 89 + j * 23, line, 16)
        parts.append(f'<path d="M{x + 16:g} {TOP + 151} H{x + card_width - 16:g}" stroke="{theme["border"]}"/>')
        text(x + 16, TOP + 174, stage.owner, 14, theme["muted"])
        if i < count - 1:
            y = TOP + 98
            path(f'M{x + card_width:g} {y} H{x + card_width + GAP:g}', dashed=diagram.key == "search" and i == 2, both=diagram.runtime)

    if diagram.runtime:
        path(f'M{centers[1]:g} {TOP + CARD_HEIGHT} V246 H{centers[3]:g} V{TOP + CARD_HEIGHT}', dashed=True)
        text((centers[1] + centers[3]) / 2, 238, "Direct inference + embeddings", 15, theme["muted"], anchor="middle")
    note_y = height - 20
    text(MARGIN + 4, note_y, diagram.note, 16, theme["muted"])
    parts.extend(['</g>', '</svg>', ''])
    return "\n".join(parts)


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for diagram in DIAGRAMS:
        for name, theme in THEMES.items():
            suffix = "-dark" if name == "dark" else ""
            output = OUTPUT_DIR / f"{diagram.key}{suffix}.svg"
            output.write_text(render(diagram, theme), encoding="utf-8")
            print(output.relative_to(ROOT))


if __name__ == "__main__":
    main()
