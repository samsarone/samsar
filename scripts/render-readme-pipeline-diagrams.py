#!/usr/bin/env python3
"""Render the README architecture diagrams.

The README uses PNGs because GitHub renders wide raster diagrams more
predictably than SVG. Keep this script as the source of truth for those assets.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"

WIDTH = 2000
VIDEO_HEIGHT = 940
EMBEDDING_HEIGHT = 700

BG = "#ffffff"
INK = "#151a20"
TEXT = "#242932"
MUTED = "#5f6975"
LIGHT_LINE = "#d8dde3"
RETRY = "#d14b00"
ARROW = "#2d3540"

BLUE = "#0b66d0"
PURPLE = "#8a5cf6"
TEAL = "#0b8299"
ORANGE = "#c6530d"
GREEN = "#18843c"
RED = "#d9193f"
GOLD = "#9c6a00"
GRAY = "#5e6875"


FONT_CANDIDATES = {
    "bold": [
        "/Library/Fonts/Inter.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ],
    "regular": [
        "/Library/Fonts/Inter.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ],
}


def font(size: int, weight: str = "bold") -> ImageFont.ImageFont:
    for candidate in FONT_CANDIDATES[weight]:
        path = Path(candidate)
        if path.exists():
            try:
                return ImageFont.truetype(str(path), size=size)
            except OSError:
                continue
    return ImageFont.load_default(size=size)


TITLE_FONT = font(62)
SECTION_FONT = font(30)
INDEX_FONT = font(13)
NODE_FONT = font(25)
NODE_SMALL_FONT = font(23)
NOTE_FONT = font(13)
CONTINUE_FONT = font(13)


def text_size(draw: ImageDraw.ImageDraw, value: str, text_font: ImageFont.ImageFont) -> tuple[int, int]:
    box = draw.textbbox((0, 0), value, font=text_font)
    return box[2] - box[0], box[3] - box[1]


def draw_centered_text(
    draw: ImageDraw.ImageDraw,
    center: tuple[float, float],
    label: str | list[str],
    text_font: ImageFont.ImageFont = NODE_FONT,
    fill: str = TEXT,
    line_gap: int = 7,
) -> None:
    lines = label if isinstance(label, list) else str(label).split("\n")
    metrics = [text_size(draw, line, text_font) for line in lines]
    total_h = sum(h for _, h in metrics) + line_gap * (len(lines) - 1)
    y = center[1] - total_h / 2
    for line, (w, h) in zip(lines, metrics):
        draw.text((center[0] - w / 2, y), line, font=text_font, fill=fill)
        y += h + line_gap


def hex_points(cx: float, cy: float, w: float, h: float) -> list[tuple[float, float]]:
    x = cx - w / 2
    y = cy - h / 2
    cut = min(32, h * 0.42, w * 0.16)
    return [
        (x + cut, y),
        (x + w - cut, y),
        (x + w, y + h / 2),
        (x + w - cut, y + h),
        (x + cut, y + h),
        (x, y + h / 2),
    ]


def draw_node(
    draw: ImageDraw.ImageDraw,
    cx: float,
    cy: float,
    w: float,
    h: float,
    label: str | list[str],
    text_font: ImageFont.ImageFont = NODE_FONT,
    stroke: int = 4,
) -> None:
    points = hex_points(cx, cy, w, h)
    draw.polygon(points, fill=BG)
    draw.line(points + [points[0]], fill=INK, width=stroke, joint="curve")
    draw_centered_text(draw, (cx, cy), label, text_font=text_font)


def draw_group(draw: ImageDraw.ImageDraw, x: float, y: float, w: float, h: float) -> None:
    draw.rounded_rectangle((x, y, x + w, y + h), radius=7, outline=INK, width=2, fill=BG)


def draw_connector(draw: ImageDraw.ImageDraw, x: float, y: float) -> None:
    draw.rounded_rectangle((x, y, x + 40, y + 88), radius=10, outline=INK, width=2, fill=BG)


def draw_arrow(
    draw: ImageDraw.ImageDraw,
    start: tuple[float, float],
    end: tuple[float, float],
    color: str = ARROW,
    width: int = 3,
    head: int = 12,
) -> None:
    segment = math.hypot(end[0] - start[0], end[1] - start[1])
    if segment < 2:
        return
    head = min(head, max(5, int(segment * 0.38)))
    draw.line((start[0], start[1], end[0], end[1]), fill=color, width=width)
    angle = math.atan2(end[1] - start[1], end[0] - start[0])
    left = (
        end[0] - head * math.cos(angle - math.pi / 6),
        end[1] - head * math.sin(angle - math.pi / 6),
    )
    right = (
        end[0] - head * math.cos(angle + math.pi / 6),
        end[1] - head * math.sin(angle + math.pi / 6),
    )
    draw.polygon([end, left, right], fill=color)


def draw_h_arrow(
    draw: ImageDraw.ImageDraw,
    source_right: float,
    y: float,
    target_left: float,
    pad: int = 4,
) -> None:
    gap = target_left - source_right
    if gap <= 0:
        return
    local_pad = min(pad, max(1, int((gap - 8) / 2)))
    draw_arrow(draw, (source_right + local_pad, y), (target_left - local_pad, y), head=10)


def draw_v_arrow_up(
    draw: ImageDraw.ImageDraw,
    x: float,
    source_top: float,
    target_bottom: float,
    pad: int = 4,
) -> None:
    gap = source_top - target_bottom
    if gap <= 0:
        return
    local_pad = min(pad, max(1, int((gap - 8) / 2)))
    draw_arrow(draw, (x, source_top - local_pad), (x, target_bottom + local_pad), head=10)


def draw_v_arrow_down(
    draw: ImageDraw.ImageDraw,
    x: float,
    source_bottom: float,
    target_top: float,
    pad: int = 4,
) -> None:
    gap = target_top - source_bottom
    if gap <= 0:
        return
    local_pad = min(pad, max(1, int((gap - 8) / 2)))
    draw_arrow(draw, (x, source_bottom + local_pad), (x, target_top - local_pad), head=10)


def draw_elbow_arrow(
    draw: ImageDraw.ImageDraw,
    start: tuple[float, float],
    mid: tuple[float, float],
    end: tuple[float, float],
    color: str = ARROW,
    width: int = 3,
) -> None:
    draw.line((start[0], start[1], mid[0], mid[1], end[0], end[1]), fill=color, width=width)
    draw_arrow(draw, (end[0] - 2, end[1]), end, color=color, width=width, head=10)


def draw_dashed_line(
    draw: ImageDraw.ImageDraw,
    start: tuple[float, float],
    end: tuple[float, float],
    color: str = ARROW,
    width: int = 3,
    dash: int = 14,
    gap: int = 10,
) -> None:
    x1, y1 = start
    x2, y2 = end
    length = math.hypot(x2 - x1, y2 - y1)
    if length == 0:
        return
    dx = (x2 - x1) / length
    dy = (y2 - y1) / length
    distance = 0.0
    while distance < length:
        seg_start = distance
        seg_end = min(distance + dash, length)
        draw.line(
            (
                x1 + dx * seg_start,
                y1 + dy * seg_start,
                x1 + dx * seg_end,
                y1 + dy * seg_end,
            ),
            fill=color,
            width=width,
        )
        distance += dash + gap


def draw_dashed_path(draw: ImageDraw.ImageDraw, points: list[tuple[float, float]], color: str = ARROW) -> None:
    for start, end in zip(points, points[1:]):
        draw_dashed_line(draw, start, end, color=color)


def label(draw: ImageDraw.ImageDraw, value: str, x: float, y: float, color: str = RETRY) -> None:
    draw.text((x, y), value, font=NOTE_FONT, fill=color)


def draw_title(draw: ImageDraw.ImageDraw, title: str, color: str) -> None:
    x = 55
    y = 38
    draw.text((x, y), title, font=TITLE_FONT, fill=TEXT)
    title_w, _ = text_size(draw, title, TITLE_FONT)
    draw.rectangle((x + 2, 109, x + title_w + 12, 113), fill=color)


def draw_header(
    draw: ImageDraw.ImageDraw,
    number: int,
    title: str,
    color: str,
    x: float,
    y: float,
    w: float,
) -> None:
    circle_r = 16
    cy = y + 17
    draw.ellipse((x, cy - circle_r, x + 2 * circle_r, cy + circle_r), outline=color, width=3, fill=BG)
    draw_centered_text(draw, (x + circle_r, cy), f"{number:02d}", INDEX_FONT, fill=color, line_gap=0)
    draw.text((x + 43, y - 1), title, font=SECTION_FONT, fill=color)
    draw.line((x, y + 45, x + w, y + 45), fill=INK, width=3)
    draw.line((x, y + 53, x + w, y + 53), fill=LIGHT_LINE, width=1)


def draw_narrative_group(draw: ImageDraw.ImageDraw, x: float, y: float, w: float = 390) -> tuple[float, float, float, float]:
    h = 200
    draw_group(draw, x, y, w, h)
    label(draw, "retry x5", x + w / 2 - 26, y + 10)
    left_x = x + 104
    right_x = x + w - 104
    draw_node(draw, left_x, y + 72, 158, 70, "Moderate")
    draw_node(draw, right_x, y + 72, 174, 70, ["Theme +", "Narrative"], text_font=NODE_SMALL_FONT)
    draw_node(draw, left_x, y + 150, 158, 70, "Validate")
    draw_node(draw, right_x, y + 150, 174, 70, "Payload")
    draw_h_arrow(draw, left_x + 79, y + 72, right_x - 87, pad=4)
    draw_h_arrow(draw, left_x + 79, y + 150, right_x - 87, pad=4)
    draw_v_arrow_up(draw, left_x, y + 115, y + 107, pad=2)
    draw_v_arrow_up(draw, right_x, y + 115, y + 107, pad=2)
    return x, y, w, h


def draw_image_gen_group(draw: ImageDraw.ImageDraw, x: float, y: float, w: float = 390) -> tuple[float, float, float, float]:
    h = 200
    draw_group(draw, x, y, w, h)
    label(draw, "rewrite x3", x + w / 2 - 32, y + 10)
    left_x = x + 104
    right_x = x + w - 104
    draw_node(draw, left_x, y + 72, 148, 70, "Create")
    draw_node(draw, right_x, y + 72, 148, 70, "Describe")
    draw_node(draw, left_x, y + 150, 148, 70, ["Score +", "Judge"], text_font=NODE_SMALL_FONT)
    draw_node(draw, right_x, y + 150, 148, 70, ["Active", "Image"], text_font=NODE_SMALL_FONT)
    draw_h_arrow(draw, left_x + 74, y + 72, right_x - 74, pad=4)
    draw_h_arrow(draw, left_x + 74, y + 150, right_x - 74, pad=4)
    draw_v_arrow_up(draw, left_x, y + 115, y + 107, pad=2)
    draw_v_arrow_up(draw, right_x, y + 115, y + 107, pad=2)
    return x, y, w, h


def draw_audio_flow(
    draw: ImageDraw.ImageDraw,
    dispatch_x: float,
    connector_x: float,
    provider_x: float,
    return_y: float,
) -> None:
    draw_node(draw, dispatch_x, 300, 138, 82, "Dispatch", text_font=NODE_SMALL_FONT)
    draw_connector(draw, connector_x, 256)
    label(draw, "retry <=3", provider_x - 58, 235)
    draw_node(draw, provider_x, 300, 170, 82, "Provider", text_font=NODE_SMALL_FONT)
    draw_node(draw, provider_x, 405, 185, 78, "Audio Links", text_font=NODE_SMALL_FONT)
    draw_h_arrow(draw, dispatch_x + 69, 300, connector_x)
    draw_h_arrow(draw, connector_x + 40, 300, provider_x - 85)
    draw_v_arrow_up(draw, provider_x, 366, 341)
    draw.line((provider_x + 92, 405, 1940, 405, 1940, return_y, 55, return_y), fill=ARROW, width=3)
    draw.text((980, return_y - 18), "continue", font=CONTINUE_FONT, fill=MUTED)
    draw.line((55, return_y, 55, 655), fill=ARROW, width=3)


def draw_bottom_headers(draw: ImageDraw.ImageDraw) -> None:
    y = 520
    draw_header(draw, 6, "Express", RED, 55, y, 305)
    draw_header(draw, 7, "AI Video", BLUE, 375, y, 335)
    draw_header(draw, 8, "Post-AI", RED, 730, y, 330)
    draw_header(draw, 9, "Frames", TEAL, 1080, y, 310)
    draw_header(draw, 10, "Render", GOLD, 1405, y, 300)
    draw_header(draw, 11, "Complete", GRAY, 1720, y, 225)


def draw_express(draw: ImageDraw.ImageDraw) -> None:
    draw_node(draw, 132, 702, 138, 82, ["Media", "Gates"], text_font=NODE_SMALL_FONT)
    draw_node(draw, 306, 702, 142, 82, ["Set", "Pending"], text_font=NODE_SMALL_FONT)
    draw_node(draw, 306, 810, 142, 82, ["Queue", "AI Docs"], text_font=NODE_SMALL_FONT)
    draw_h_arrow(draw, 201, 702, 235)
    draw_v_arrow_down(draw, 306, 743, 769)


def draw_ai_video_text(draw: ImageDraw.ImageDraw) -> None:
    draw_group(draw, 382, 590, 338, 292)
    label(draw, "429/5xx", 526, 598)
    label(draw, "base x3", 526, 860)
    draw_node(draw, 473, 702, 140, 82, "Submit/Poll", text_font=NODE_SMALL_FONT)
    draw_node(draw, 640, 702, 140, 82, "Backoff", text_font=NODE_SMALL_FONT)
    draw_node(draw, 473, 810, 155, 82, ["Download", "Extract"], text_font=NODE_SMALL_FONT)
    draw_node(draw, 640, 810, 140, 82, ["Layer", "Done"], text_font=NODE_SMALL_FONT)
    draw_h_arrow(draw, 377, 702, 403)
    draw_h_arrow(draw, 543, 702, 570)
    draw_h_arrow(draw, 551, 810, 570)
    draw_v_arrow_up(draw, 473, 769, 743)
    draw_v_arrow_up(draw, 640, 769, 743)
    draw_h_arrow(draw, 720, 702, 742)


def draw_ai_video_image(draw: ImageDraw.ImageDraw) -> None:
    draw_node(draw, 470, 702, 132, 82, ["Start", "Image"], text_font=NODE_SMALL_FONT)
    draw_node(draw, 470, 810, 155, 82, ["Download", "Extract"], text_font=NODE_SMALL_FONT)
    draw_group(draw, 560, 590, 162, 292)
    label(draw, "base x3", 615, 860)
    draw_node(draw, 641, 702, 140, 82, "Submit/Poll", text_font=NODE_SMALL_FONT)
    draw_node(draw, 641, 810, 140, 82, ["Layer", "Done"], text_font=NODE_SMALL_FONT)
    draw_h_arrow(draw, 377, 702, 404)
    draw_h_arrow(draw, 536, 702, 571)
    draw_v_arrow_up(draw, 470, 769, 743)
    draw_h_arrow(draw, 548, 810, 571)
    draw_v_arrow_up(draw, 641, 769, 743)
    draw_h_arrow(draw, 722, 702, 742)


def draw_post_ai(draw: ImageDraw.ImageDraw) -> None:
    draw_node(draw, 810, 702, 136, 82, "Reflow", text_font=NODE_SMALL_FONT)
    draw_node(draw, 810, 810, 136, 82, "Transcript", text_font=NODE_SMALL_FONT)
    draw_node(draw, 982, 702, 146, 82, ["Lip/SFX/", "Avatar"], text_font=NODE_SMALL_FONT)
    draw_node(draw, 982, 810, 146, 82, ["Frame", "Pending"], text_font=NODE_SMALL_FONT)
    draw_h_arrow(draw, 878, 702, 909)
    draw_h_arrow(draw, 878, 810, 909)
    draw_v_arrow_up(draw, 982, 769, 743)
    draw_h_arrow(draw, 1055, 702, 1099)
    label(draw, "wait", 889, 728)


def draw_frames(draw: ImageDraw.ImageDraw) -> None:
    draw_group(draw, 1084, 590, 323, 292)
    label(draw, "retry x3", 1222, 598)
    draw_node(draw, 1169, 702, 140, 82, ["Frame", "Docs"], text_font=NODE_SMALL_FONT)
    draw_node(draw, 1322, 702, 135, 82, "Compose", text_font=NODE_SMALL_FONT)
    draw_node(draw, 1169, 810, 140, 82, ["Docs", "Empty"], text_font=NODE_SMALL_FONT)
    draw_node(draw, 1322, 810, 135, 82, ["Video", "Doc"], text_font=NODE_SMALL_FONT)
    draw_h_arrow(draw, 1239, 702, 1255)
    draw_h_arrow(draw, 1239, 810, 1255)
    draw_v_arrow_up(draw, 1169, 769, 743)
    draw_v_arrow_up(draw, 1322, 769, 743)
    draw_h_arrow(draw, 1407, 702, 1420)


def draw_render_complete(draw: ImageDraw.ImageDraw) -> None:
    draw_node(draw, 1488, 702, 128, 82, ["Collect", "Mix"], text_font=NODE_SMALL_FONT)
    draw_group(draw, 1575, 590, 165, 292)
    label(draw, "retry", 1640, 598)
    draw_node(draw, 1658, 702, 135, 82, "FFmpeg", text_font=NODE_SMALL_FONT)
    draw_node(draw, 1658, 810, 135, 82, ["Upload", "Link"], text_font=NODE_SMALL_FONT)
    draw_h_arrow(draw, 1552, 702, 1590)
    draw_v_arrow_up(draw, 1658, 769, 743)
    draw_h_arrow(draw, 1740, 755, 1760)
    draw_node(draw, 1850, 755, 180, 90, ["Charge +", "Webhook"], text_font=NODE_SMALL_FONT)


def draw_bottom_common(draw: ImageDraw.ImageDraw, variant: str) -> None:
    draw_bottom_headers(draw)
    draw_express(draw)
    if variant == "text":
        draw_ai_video_text(draw)
    else:
        draw_ai_video_image(draw)
    draw_post_ai(draw)
    draw_frames(draw)
    draw_render_complete(draw)
    label(draw, "wait", 46, 899)


def render_text_to_video() -> Image.Image:
    image = Image.new("RGBA", (WIDTH, VIDEO_HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    draw_title(draw, "Text to Video", BLUE)

    draw_header(draw, 1, "Processor", BLUE, 55, 145, 305)
    draw_header(draw, 2, "Narrative", PURPLE, 390, 145, 390)
    draw_header(draw, 3, "Session", TEAL, 820, 145, 280)
    draw_header(draw, 4, "Image Gen", ORANGE, 1130, 145, 390)
    draw_header(draw, 5, "Audio Gen", GREEN, 1550, 145, 395)

    draw_node(draw, 202, 300, 250, 92, "Auth + Preflight")
    draw_h_arrow(draw, 327, 300, 390)
    draw_narrative_group(draw, 390, 205)
    draw_h_arrow(draw, 780, 300, 830)
    draw_node(draw, 960, 300, 260, 92, ["Session +", "Media Docs"])
    draw_h_arrow(draw, 1090, 300, 1130)
    draw_image_gen_group(draw, 1130, 205)
    draw_h_arrow(draw, 1520, 300, 1555)
    draw_audio_flow(draw, 1625, 1710, 1830, 492)

    draw_bottom_common(draw, "text")
    return image


def render_image_list_to_video() -> Image.Image:
    image = Image.new("RGBA", (WIDTH, VIDEO_HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    draw_title(draw, "Image List to Video", ORANGE)

    draw_header(draw, 1, "Processor", BLUE, 55, 145, 300)
    draw_header(draw, 2, "Image Prep", ORANGE, 370, 145, 315)
    draw_header(draw, 3, "Narrative", PURPLE, 725, 145, 390)
    draw_header(draw, 4, "Session", TEAL, 1130, 145, 280)
    draw_header(draw, 5, "Audio Gen", GREEN, 1430, 145, 515)

    draw_node(draw, 202, 300, 250, 92, "Auth + Preflight")
    draw_h_arrow(draw, 327, 300, 410)
    draw_node(draw, 552, 300, 250, 92, "Inspect + Upload")
    draw_h_arrow(draw, 677, 300, 725)
    draw_narrative_group(draw, 725, 205)
    draw_h_arrow(draw, 1115, 300, 1160)
    draw_node(draw, 1280, 300, 240, 92, ["Prepared", "Media Docs"])
    draw_h_arrow(draw, 1400, 300, 1436)
    draw_audio_flow(draw, 1505, 1615, 1765, 492)

    draw_bottom_common(draw, "image")
    return image


def draw_embedding_header_row(
    draw: ImageDraw.ImageDraw,
    stages: list[tuple[int, str, str, float, float]],
    y: float = 162,
) -> None:
    for number, title, color, x, w in stages:
        draw_header(draw, number, title, color, x, y, w)


def render_search_embeddings() -> Image.Image:
    image = Image.new("RGBA", (WIDTH, EMBEDDING_HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    draw_title(draw, "Search Embeddings", BLUE)

    stages = [
        (1, "Create", BLUE, 60, 160),
        (2, "Input", PURPLE, 255, 166),
        (3, "Normalize", GRAY, 455, 166),
        (4, "Embed", PURPLE, 650, 146),
        (5, "Records", BLUE, 820, 160),
        (6, "Query API", BLUE, 1000, 170),
        (7, "Query", PURPLE, 1190, 166),
        (8, "Vector", BLUE, 1385, 190),
        (9, "Rank", TEAL, 1605, 146),
        (10, "Results", TEAL, 1780, 156),
    ]
    draw_embedding_header_row(draw, stages)

    y = 300
    nodes = [
        (135, 150, ["Create", "API"]),
        (337, 150, "Inputs"),
        (538, 166, "Normalize"),
        (723, 148, "Embed"),
        (895, 150, "Records"),
        (1084, 150, ["Search", "API"]),
        (1273, 164, ["Query", "Embed"]),
        (1476, 172, ["Vector", "Search"]),
        (1678, 148, "Rank"),
        (1856, 150, "Results"),
    ]
    for cx, w, title in nodes:
        draw_node(draw, cx, y, w, 76, title, text_font=NODE_SMALL_FONT)
    for left, right in zip(nodes, nodes[1:]):
        draw_h_arrow(draw, left[0] + left[1] / 2, y, right[0] - right[1] / 2)

    draw_node(draw, 338, 445, 158, 68, ["URL", "Ingest"], text_font=NODE_SMALL_FONT)
    draw_node(draw, 895, 445, 158, 68, ["Vector", "Index"], text_font=NODE_SMALL_FONT)
    draw_node(draw, 1476, 595, 180, 68, "Filters", text_font=NODE_SMALL_FONT)
    draw_dashed_path(draw, [(337, 338), (337, 392)])
    draw_dashed_path(draw, [(417, 445), (535, 445), (535, 340)])
    draw_dashed_path(draw, [(895, 338), (895, 392)])
    draw_dashed_path(draw, [(974, 445), (1476, 445), (1476, 340)])
    draw_dashed_path(draw, [(535, 522), (535, 650), (1588, 650), (1588, 340)])
    label(draw, "index", 1117, 435, color=BLUE)
    return image


def render_recommendations() -> Image.Image:
    image = Image.new("RGBA", (WIDTH, EMBEDDING_HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    draw_title(draw, "Recommendations", TEAL)

    stages = [
        (1, "Catalog", BLUE, 60, 166),
        (2, "Shape", GRAY, 280, 172),
        (3, "Embed", PURPLE, 505, 146),
        (4, "Corpus", BLUE, 690, 156),
        (5, "Similar", BLUE, 875, 166),
        (6, "Query", PURPLE, 1065, 166),
        (7, "Search", GRAY, 1265, 186),
        (8, "Weight", TEAL, 1490, 186),
        (9, "Matches", TEAL, 1715, 160),
    ]
    draw_embedding_header_row(draw, stages)

    y = 300
    nodes = [
        (137, 152, "Catalog"),
        (363, 166, ["Shape", "Fields"]),
        (575, 144, "Embed"),
        (762, 150, "Corpus"),
        (953, 160, ["Similar", "API"]),
        (1143, 160, ["Query", "Item"]),
        (1353, 175, ["Shared", "Search"]),
        (1580, 175, ["Weighted", "Match"]),
        (1792, 150, "Matches"),
    ]
    for cx, w, title in nodes:
        draw_node(draw, cx, y, w, 76, title, text_font=NODE_SMALL_FONT)
    for left, right in zip(nodes, nodes[1:]):
        draw_h_arrow(draw, left[0] + left[1] / 2, y, right[0] - right[1] / 2)

    draw_node(draw, 1105, 445, 165, 68, ["Query", "Embed"], text_font=NODE_SMALL_FONT)
    draw_node(draw, 1580, 445, 180, 68, "Strict Off", text_font=NODE_SMALL_FONT)
    draw_node(draw, 1580, 595, 180, 68, ["Field", "Weights"], text_font=NODE_SMALL_FONT)
    draw_dashed_path(draw, [(363, 338), (363, 605), (1490, 605)])
    draw_dashed_path(draw, [(762, 338), (762, 370), (1353, 370), (1353, 340)])
    draw_arrow(draw, (1143, 338), (1105, 400))
    draw.line((1188, 445, 1353, 445, 1353, 340), fill=ARROW, width=3)
    draw_v_arrow_up(draw, 1580, 411, 340)
    draw_dashed_path(draw, [(1580, 561), (1580, 484)])
    label(draw, "corpus reuse", 955, 358, color=BLUE)
    return image


def main() -> None:
    ASSETS.mkdir(exist_ok=True)
    outputs = {
        "text-to-video-pipeline.png": render_text_to_video(),
        "image-to-video-pipeline.png": render_image_list_to_video(),
        "search-embeddings-pipeline.png": render_search_embeddings(),
        "recommendations-embeddings-pipeline.png": render_recommendations(),
    }
    for filename, image in outputs.items():
        output = ASSETS / filename
        image.save(output, optimize=True)
        print(f"rendered {output}")


if __name__ == "__main__":
    main()
