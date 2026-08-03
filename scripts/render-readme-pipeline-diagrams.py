#!/usr/bin/env python3
"""Render the README workflow diagrams from code-reviewed pipeline summaries.

The generated PNGs are committed with the README so a diagram change and its
documentation change cannot drift apart.  Each workflow has transparent light
and dark variants so text can remain readable without opaque white cards.

All connectors are derived from rectangle anchors.  Do not add coordinate
padding at either end of a connector: the arrow tip and source line must meet
the boxes they connect.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "docs" / "readme-diagrams"

WIDTH = 2000
CARD_HEIGHT = 580
ROW_GAP = 140
OUTCOME_HEIGHT = 120
CANVAS_MARGIN = 64

TRANSPARENT = (255, 255, 255, 0)

# Shared spacing rhythm.  These values intentionally drive every card instead
# of leaving one-off y offsets scattered through the renderer.
CARD_PAD_X = 26
CARD_HEADER_TEXT_X = 101
CARD_TITLE_TOP = 53
CARD_DIVIDER_MIN_Y = 132
CARD_HEADER_GAP = 18
NODE_GAP = 18
NODE_PAD_X = 15
NODE_PAD_Y = 10
NODE_MIN_HEIGHT = 62
NOTE_BOTTOM = 18
NOTE_GAP = 18
NOTE_PAD_X = 12
NOTE_PAD_Y = 10
NOTE_MIN_HEIGHT = 64
STEP_LINE_SPACING = 7
NOTE_LINE_SPACING = 5
TITLE_LINE_SPACING = 4

BLUE = "#2563EB"
VIOLET = "#7C3AED"
CYAN = "#0891B2"
ORANGE = "#EA580C"
GREEN = "#16A34A"
ROSE = "#E11D48"
INDIGO = "#4F46E5"
PINK = "#C026D3"
AMBER = "#B7791F"
SLATE = "#526174"


FONT_CANDIDATES = {
    "bold": [
        ("/System/Library/Fonts/Avenir Next.ttc", 0),
        ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 0),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 0),
    ],
    "medium": [
        ("/System/Library/Fonts/Avenir Next.ttc", 5),
        ("/System/Library/Fonts/Supplemental/Arial.ttf", 0),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 0),
    ],
    "regular": [
        ("/System/Library/Fonts/Avenir Next.ttc", 7),
        ("/System/Library/Fonts/Supplemental/Arial.ttf", 0),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 0),
    ],
}


def font(size: int, weight: str = "regular") -> ImageFont.ImageFont:
    for candidate, index in FONT_CANDIDATES[weight]:
        path = Path(candidate)
        if not path.exists():
            continue
        try:
            return ImageFont.truetype(str(path), size=size, index=index)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


TITLE_FONT = font(70, "bold")
SUBTITLE_FONT = font(26, "regular")
LANE_FONT = font(22, "bold")
STAGE_TITLE_FONT = font(31, "bold")
SERVICE_FONT = font(22, "bold")
SERVICE_SMALL_FONT = font(20, "bold")
STEP_FONT = font(25, "medium")
STEP_SMALL_FONT = font(22, "medium")
NOTE_FONT = font(21, "bold")
BADGE_FONT = font(21, "bold")
LEGEND_FONT = font(20, "bold")


Color = tuple[int, int, int, int]


@dataclass(frozen=True)
class Theme:
    name: str
    ink: Color
    muted: Color
    border: Color
    line: Color
    halo: Color
    divider: Color
    card_fill: Color
    chrome_fill: Color
    shadow: Color
    accent_target: tuple[int, int, int]
    accent_mix: float
    accent_surface_alpha: int
    accent_strong_alpha: int


LIGHT_THEME = Theme(
    name="light",
    ink=(15, 23, 42, 255),
    muted=(71, 85, 105, 255),
    border=(100, 116, 139, 104),
    line=(51, 65, 85, 232),
    halo=(255, 255, 255, 175),
    divider=(100, 116, 139, 72),
    card_fill=(100, 116, 139, 18),
    chrome_fill=(100, 116, 139, 14),
    shadow=(15, 23, 42, 11),
    accent_target=(15, 23, 42),
    accent_mix=0.32,
    accent_surface_alpha=24,
    accent_strong_alpha=38,
)

DARK_THEME = Theme(
    name="dark",
    ink=(241, 245, 249, 255),
    muted=(203, 213, 225, 255),
    border=(148, 163, 184, 112),
    line=(203, 213, 225, 232),
    halo=(13, 17, 23, 185),
    divider=(148, 163, 184, 76),
    card_fill=(148, 163, 184, 18),
    chrome_fill=(148, 163, 184, 14),
    shadow=(0, 0, 0, 0),
    accent_target=(255, 255, 255),
    accent_mix=0.27,
    accent_surface_alpha=30,
    accent_strong_alpha=44,
)

ACTIVE_THEME = LIGHT_THEME


@dataclass(frozen=True)
class Rect:
    x: float
    y: float
    w: float
    h: float

    @property
    def left(self) -> float:
        return self.x

    @property
    def right(self) -> float:
        return self.x + self.w

    @property
    def top(self) -> float:
        return self.y

    @property
    def bottom(self) -> float:
        return self.y + self.h

    @property
    def cx(self) -> float:
        return self.x + self.w / 2

    @property
    def cy(self) -> float:
        return self.y + self.h / 2

    def inset(self, amount: float) -> "Rect":
        return Rect(
            self.x + amount,
            self.y + amount,
            self.w - 2 * amount,
            self.h - 2 * amount,
        )


@dataclass(frozen=True)
class Stage:
    number: int
    title: str
    service: str
    color: str
    steps: tuple[str, ...]
    note: str | None = None
    layout: str = "stack"


def rgb(value: str, alpha: int = 255) -> tuple[int, int, int, int]:
    value = value.lstrip("#")
    return (
        int(value[0:2], 16),
        int(value[2:4], 16),
        int(value[4:6], 16),
        alpha,
    )


def mix_color(
    value: str,
    target: tuple[int, int, int],
    strength: float,
    alpha: int = 255,
) -> Color:
    base = rgb(value)
    return tuple(
        round(channel + (target_channel - channel) * strength)
        for channel, target_channel in zip(base[:3], target)
    ) + (alpha,)


def accent_text(value: str, alpha: int = 255) -> Color:
    return mix_color(
        value,
        ACTIVE_THEME.accent_target,
        ACTIVE_THEME.accent_mix,
        alpha,
    )


def accent_surface(value: str, *, strong: bool = False) -> Color:
    alpha = (
        ACTIVE_THEME.accent_strong_alpha
        if strong
        else ACTIVE_THEME.accent_surface_alpha
    )
    return rgb(value, alpha)


def text_size(
    draw: ImageDraw.ImageDraw,
    value: str,
    text_font: ImageFont.ImageFont,
) -> tuple[int, int]:
    box = draw.textbbox((0, 0), value, font=text_font)
    return box[2] - box[0], box[3] - box[1]


def text_block_size(
    draw: ImageDraw.ImageDraw,
    lines: Sequence[str],
    text_font: ImageFont.ImageFont,
    spacing: int,
) -> tuple[int, int]:
    value = "\n".join(lines)
    box = draw.multiline_textbbox(
        (0, 0),
        value,
        font=text_font,
        spacing=spacing,
        align="center",
    )
    return box[2] - box[0], box[3] - box[1]


def wrap_text(
    draw: ImageDraw.ImageDraw,
    value: str,
    text_font: ImageFont.ImageFont,
    max_width: float,
    max_lines: int | None = 3,
) -> list[str]:
    lines: list[str] = []
    for paragraph in str(value).split("\n"):
        words = paragraph.split()
        if not words:
            lines.append("")
            continue
        current = words[0]
        for word in words[1:]:
            candidate = f"{current} {word}"
            if text_size(draw, candidate, text_font)[0] <= max_width:
                current = candidate
            else:
                lines.append(current)
                current = word
        lines.append(current)

    if max_lines is None or len(lines) <= max_lines:
        return lines

    kept = lines[: max_lines - 1]
    final = " ".join(lines[max_lines - 1 :])
    while text_size(draw, f"{final}...", text_font)[0] > max_width and " " in final:
        final = final.rsplit(" ", 1)[0]
    kept.append(f"{final}...")
    return kept


def draw_centered_text(
    draw: ImageDraw.ImageDraw,
    rect: Rect,
    value: str,
    text_font: ImageFont.ImageFont,
    fill: Color | None = None,
    max_lines: int = 3,
    spacing: int = 4,
) -> None:
    lines = wrap_text(draw, value, text_font, rect.w, max_lines=max_lines)
    block = "\n".join(lines)
    box = draw.multiline_textbbox(
        (0, 0),
        block,
        font=text_font,
        spacing=spacing,
        align="center",
    )
    origin = (
        rect.cx - (box[0] + box[2]) / 2,
        rect.cy - (box[1] + box[3]) / 2,
    )
    draw.multiline_text(
        origin,
        block,
        font=text_font,
        fill=fill or ACTIVE_THEME.ink,
        spacing=spacing,
        align="center",
    )


def draw_top_left_text(
    draw: ImageDraw.ImageDraw,
    x: float,
    y: float,
    lines: Sequence[str],
    text_font: ImageFont.ImageFont,
    *,
    fill: Color,
    spacing: int,
) -> int:
    block = "\n".join(lines)
    box = draw.multiline_textbbox(
        (0, 0),
        block,
        font=text_font,
        spacing=spacing,
        align="left",
    )
    draw.multiline_text(
        (x - box[0], y - box[1]),
        block,
        font=text_font,
        fill=fill,
        spacing=spacing,
        align="left",
    )
    return box[3] - box[1]


def rounded_box(
    draw: ImageDraw.ImageDraw,
    rect: Rect,
    *,
    fill: tuple[int, int, int, int],
    outline: Color | None = None,
    width: int = 2,
    radius: int = 18,
) -> None:
    draw.rounded_rectangle(
        (rect.left, rect.top, rect.right, rect.bottom),
        radius=radius,
        fill=fill,
        outline=outline or ACTIVE_THEME.border,
        width=width,
    )


def add_shadow_layer(image: Image.Image, rects: Iterable[Rect], radius: int = 9) -> None:
    if ACTIVE_THEME.shadow[3] == 0:
        return
    shadow = Image.new("RGBA", image.size, TRANSPARENT)
    shadow_draw = ImageDraw.Draw(shadow)
    for rect in rects:
        shadow_draw.rounded_rectangle(
            (rect.left + 1, rect.top + 5, rect.right + 1, rect.bottom + 5),
            radius=22,
            fill=ACTIVE_THEME.shadow,
        )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius))
    image.alpha_composite(shadow)


def arrow_head(
    end: tuple[float, float],
    previous: tuple[float, float],
    size: float,
) -> list[tuple[float, float]]:
    x2, y2 = end
    x1, y1 = previous
    if abs(x2 - x1) >= abs(y2 - y1):
        direction = 1 if x2 >= x1 else -1
        return [
            (x2, y2),
            (x2 - direction * size, y2 - size * 0.62),
            (x2 - direction * size, y2 + size * 0.62),
        ]
    direction = 1 if y2 >= y1 else -1
    return [
        (x2, y2),
        (x2 - size * 0.62, y2 - direction * size),
        (x2 + size * 0.62, y2 - direction * size),
    ]


def draw_arrow_path(
    draw: ImageDraw.ImageDraw,
    points: Sequence[tuple[float, float]],
    *,
    color: Color | None = None,
    width: int = 4,
    head: int = 13,
    halo: bool = True,
) -> None:
    if len(points) < 2:
        return
    line_color = color or ACTIVE_THEME.line
    flattened = [coordinate for point in points for coordinate in point]
    if halo:
        draw.line(flattened, fill=ACTIVE_THEME.halo, width=width + 3, joint="curve")
        draw.polygon(
            arrow_head(points[-1], points[-2], head + 2),
            fill=ACTIVE_THEME.halo,
        )
    draw.line(flattened, fill=line_color, width=width, joint="curve")
    draw.polygon(arrow_head(points[-1], points[-2], head), fill=line_color)


def draw_dashed_segment(
    draw: ImageDraw.ImageDraw,
    start: tuple[float, float],
    end: tuple[float, float],
    *,
    color: tuple[int, int, int, int],
    width: int = 4,
    dash: int = 14,
    gap: int = 10,
) -> None:
    x1, y1 = start
    x2, y2 = end
    length = max(abs(x2 - x1), abs(y2 - y1))
    if length <= 0:
        return
    horizontal = abs(x2 - x1) >= abs(y2 - y1)
    direction = 1 if (x2 >= x1 if horizontal else y2 >= y1) else -1
    position = 0.0
    while position < length:
        segment_end = min(position + dash, length)
        if horizontal:
            p1 = (x1 + direction * position, y1)
            p2 = (x1 + direction * segment_end, y1)
        else:
            p1 = (x1, y1 + direction * position)
            p2 = (x1, y1 + direction * segment_end)
        draw.line((*p1, *p2), fill=color, width=width)
        position += dash + gap


def draw_dashed_arrow_path(
    draw: ImageDraw.ImageDraw,
    points: Sequence[tuple[float, float]],
    *,
    color: Color | None = None,
    width: int = 4,
    head: int = 13,
) -> None:
    if len(points) < 2:
        return
    line_color = color or ACTIVE_THEME.line
    for start, end in zip(points, points[1:]):
        draw_dashed_segment(
            draw,
            start,
            end,
            color=ACTIVE_THEME.halo,
            width=width + 3,
        )
    for start, end in zip(points, points[1:]):
        draw_dashed_segment(draw, start, end, color=line_color, width=width)
    draw.polygon(
        arrow_head(points[-1], points[-2], head + 2),
        fill=ACTIVE_THEME.halo,
    )
    draw.polygon(arrow_head(points[-1], points[-2], head), fill=line_color)


def draw_edge_label(
    draw: ImageDraw.ImageDraw,
    center: tuple[float, float],
    value: str,
    color: str = SLATE,
) -> None:
    width, height = text_size(draw, value, NOTE_FONT)
    rect = Rect(
        center[0] - width / 2 - 15,
        center[1] - height / 2 - 10,
        width + 30,
        height + 20,
    )
    rounded_box(
        draw,
        rect,
        fill=accent_surface(color, strong=True),
        outline=accent_text(color, 150),
        width=2,
        radius=12,
    )
    draw_centered_text(
        draw,
        rect.inset(8),
        value,
        NOTE_FONT,
        fill=accent_text(color),
        max_lines=1,
        spacing=NOTE_LINE_SPACING,
    )


def draw_header(
    draw: ImageDraw.ImageDraw,
    title: str,
    subtitle: str,
    color: str,
    *,
    secondary_legend: str | None = None,
) -> None:
    draw_top_left_text(
        draw,
        CANVAS_MARGIN,
        42,
        (title,),
        TITLE_FONT,
        fill=ACTIVE_THEME.ink,
        spacing=TITLE_LINE_SPACING,
    )
    draw.rounded_rectangle(
        (CANVAS_MARGIN + 2, 124, CANVAS_MARGIN + 190, 132),
        radius=4,
        fill=accent_text(color),
    )
    draw_top_left_text(
        draw,
        CANVAS_MARGIN,
        149,
        (subtitle,),
        SUBTITLE_FONT,
        fill=ACTIVE_THEME.muted,
        spacing=TITLE_LINE_SPACING,
    )

    primary_label = "SEQUENCE"
    primary_width, primary_height = text_size(draw, primary_label, LEGEND_FONT)
    secondary_width = 0
    if secondary_legend:
        secondary_width = text_size(draw, secondary_legend, LEGEND_FONT)[0] + 92
    legend_width = 70 + primary_width + secondary_width
    legend_x = WIDTH - CANVAS_MARGIN - legend_width
    legend_y = 91
    draw_arrow_path(
        draw,
        [(legend_x, legend_y), (legend_x + 54, legend_y)],
        width=4,
        head=10,
        halo=False,
    )
    draw_centered_text(
        draw,
        Rect(legend_x + 68, legend_y - primary_height, primary_width, primary_height * 2),
        primary_label,
        LEGEND_FONT,
        fill=ACTIVE_THEME.muted,
        max_lines=1,
    )
    if secondary_legend:
        secondary_x = legend_x + 86 + primary_width
        draw_dashed_segment(
            draw,
            (secondary_x, legend_y),
            (secondary_x + 54, legend_y),
            color=ACTIVE_THEME.line,
            width=4,
            dash=10,
            gap=7,
        )
        draw_centered_text(
            draw,
            Rect(
                secondary_x + 68,
                legend_y - primary_height,
                text_size(draw, secondary_legend, LEGEND_FONT)[0],
                primary_height * 2,
            ),
            secondary_legend,
            LEGEND_FONT,
            fill=ACTIVE_THEME.muted,
            max_lines=1,
        )


def draw_lane_label(
    draw: ImageDraw.ImageDraw,
    x: float,
    y: float,
    value: str,
    color: str,
) -> None:
    label_width, label_height = text_size(draw, value.upper(), LANE_FONT)
    rect = Rect(x, y, label_width + 58, label_height + 24)
    rounded_box(
        draw,
        rect,
        fill=accent_surface(color),
        outline=accent_text(color, 145),
        width=2,
        radius=16,
    )
    draw.ellipse(
        (rect.x + 15, rect.cy - 6, rect.x + 27, rect.cy + 6),
        fill=accent_text(color),
    )
    draw_centered_text(
        draw,
        Rect(rect.x + 36, rect.y + 4, rect.w - 44, rect.h - 8),
        value.upper(),
        LANE_FONT,
        fill=accent_text(color),
        max_lines=1,
    )


def choose_step_font(
    draw: ImageDraw.ImageDraw,
    value: str,
    max_width: float,
) -> tuple[ImageFont.ImageFont, list[str]]:
    for candidate, preferred_lines in ((STEP_FONT, 3), (STEP_SMALL_FONT, 4)):
        lines = wrap_text(draw, value, candidate, max_width, max_lines=None)
        if len(lines) <= preferred_lines:
            return candidate, lines
    return STEP_SMALL_FONT, wrap_text(
        draw,
        value,
        STEP_SMALL_FONT,
        max_width,
        max_lines=None,
    )


def allocate_step_rects(
    draw: ImageDraw.ImageDraw,
    rect: Rect,
    stage: Stage,
    body_top: float,
    body_bottom: float,
) -> tuple[list[Rect], list[ImageFont.ImageFont]]:
    is_branch = stage.layout == "parallel"
    node_x = rect.x + (52 if is_branch else CARD_PAD_X)
    node_width = rect.w - (94 if is_branch else CARD_PAD_X * 2)
    layout_top = body_top + (4 if is_branch else 0)
    available = body_bottom - layout_top
    fonts: list[ImageFont.ImageFont] = []
    preferred_heights: list[float] = []
    for value in stage.steps:
        node_font, lines = choose_step_font(
            draw,
            value,
            node_width - NODE_PAD_X * 2,
        )
        fonts.append(node_font)
        text_height = text_block_size(
            draw,
            lines,
            node_font,
            STEP_LINE_SPACING,
        )[1]
        preferred_heights.append(
            max(NODE_MIN_HEIGHT, text_height + NODE_PAD_Y * 2)
        )

    gap_total = NODE_GAP * max(0, len(stage.steps) - 1)
    preferred_total = sum(preferred_heights) + gap_total
    if preferred_total > available:
        raise ValueError(
            f"stage {stage.number:02d} {stage.title!r} needs "
            f"{preferred_total:.1f}px for steps but has {available:.1f}px"
        )
    extra_height = (available - preferred_total) / max(1, len(stage.steps))
    y = layout_top
    nodes: list[Rect] = []
    for preferred_height in preferred_heights:
        height = preferred_height + extra_height
        nodes.append(Rect(node_x, y, node_width, height))
        y += height + NODE_GAP
    return nodes, fonts


def note_rect_for_stage(
    draw: ImageDraw.ImageDraw,
    rect: Rect,
    stage: Stage,
) -> tuple[Rect | None, list[str]]:
    if not stage.note:
        return None, []
    note_width = rect.w - CARD_PAD_X * 2
    lines = wrap_text(
        draw,
        stage.note,
        NOTE_FONT,
        note_width - NOTE_PAD_X * 2,
        max_lines=None,
    )
    text_height = text_block_size(
        draw,
        lines,
        NOTE_FONT,
        NOTE_LINE_SPACING,
    )[1]
    note_height = max(NOTE_MIN_HEIGHT, text_height + NOTE_PAD_Y * 2)
    return (
        Rect(
            rect.x + CARD_PAD_X,
            rect.bottom - NOTE_BOTTOM - note_height,
            note_width,
            note_height,
        ),
        lines,
    )


def draw_stage_card(draw: ImageDraw.ImageDraw, rect: Rect, stage: Stage) -> None:
    color = accent_text(stage.color)
    rounded_box(
        draw,
        rect,
        fill=ACTIVE_THEME.card_fill,
        outline=ACTIVE_THEME.border,
        width=2,
        radius=22,
    )
    draw.rounded_rectangle(
        (rect.x, rect.y, rect.x + 9, rect.bottom),
        radius=5,
        fill=color,
    )

    badge = Rect(rect.x + 27, rect.y + 25, 52, 52)
    draw.ellipse(
        (badge.left, badge.top, badge.right, badge.bottom),
        fill=accent_surface(stage.color, strong=True),
        outline=accent_text(stage.color, 210),
        width=3,
    )
    draw_centered_text(
        draw,
        badge.inset(5),
        f"{stage.number:02d}",
        BADGE_FONT,
        fill=color,
        max_lines=1,
    )

    header_x = rect.x + CARD_HEADER_TEXT_X
    header_width = rect.w - CARD_HEADER_TEXT_X - CARD_PAD_X
    service_font = SERVICE_FONT
    if text_size(draw, stage.service.upper(), SERVICE_FONT)[0] > header_width:
        service_font = SERVICE_SMALL_FONT
    service_lines = wrap_text(
        draw,
        stage.service.upper(),
        service_font,
        header_width,
        max_lines=2,
    )
    service_height = draw_top_left_text(
        draw,
        header_x,
        rect.y + 23,
        service_lines,
        service_font,
        fill=color,
        spacing=TITLE_LINE_SPACING,
    )
    title_top = max(CARD_TITLE_TOP, 23 + service_height + 7)
    title_lines = wrap_text(
        draw,
        stage.title,
        STAGE_TITLE_FONT,
        header_width,
        max_lines=2,
    )
    title_height = draw_top_left_text(
        draw,
        header_x,
        rect.y + title_top,
        title_lines,
        STAGE_TITLE_FONT,
        fill=ACTIVE_THEME.ink,
        spacing=TITLE_LINE_SPACING,
    )
    divider_y = rect.y + max(
        CARD_DIVIDER_MIN_Y,
        title_top + title_height + CARD_HEADER_GAP,
    )
    draw.line(
        (rect.x + CARD_PAD_X, divider_y, rect.right - CARD_PAD_X, divider_y),
        fill=ACTIVE_THEME.divider,
        width=2,
    )

    note_rect, note_lines = note_rect_for_stage(draw, rect, stage)
    body_top = divider_y + CARD_HEADER_GAP
    body_bottom = (
        note_rect.top - NOTE_GAP
        if note_rect
        else rect.bottom - NOTE_BOTTOM
    )
    nodes, node_fonts = allocate_step_rects(
        draw,
        rect,
        stage,
        body_top,
        body_bottom,
    )

    for node, value, node_font in zip(nodes, stage.steps, node_fonts):
        rounded_box(
            draw,
            node,
            fill=accent_surface(stage.color),
            outline=accent_text(stage.color, 132),
            width=2,
            radius=15,
        )
        lines = wrap_text(
            draw,
            value,
            node_font,
            node.w - NODE_PAD_X * 2,
            max_lines=None,
        )
        draw_centered_text(
            draw,
            node.inset(NODE_PAD_Y),
            "\n".join(lines),
            node_font,
            fill=ACTIVE_THEME.ink,
            max_lines=len(lines),
            spacing=STEP_LINE_SPACING,
        )

    if stage.layout == "parallel":
        left_rail = rect.x + 27
        right_rail = rect.right - 26
        entry_y = body_top + 1
        draw.line(
            (rect.cx, divider_y, rect.cx, entry_y),
            fill=ACTIVE_THEME.line,
            width=3,
        )
        draw.line(
            (left_rail, entry_y, rect.cx, entry_y),
            fill=ACTIVE_THEME.line,
            width=3,
        )
        draw.line(
            (left_rail, entry_y, left_rail, nodes[-1].cy),
            fill=ACTIVE_THEME.line,
            width=3,
        )
        draw.line(
            (right_rail, nodes[0].cy, right_rail, nodes[-1].cy),
            fill=ACTIVE_THEME.line,
            width=3,
        )
        for node in nodes:
            draw_arrow_path(
                draw,
                [(left_rail, node.cy), (node.left, node.cy)],
                width=3,
                head=9,
                halo=False,
            )
            draw.line(
                (node.right, node.cy, right_rail, node.cy),
                fill=ACTIVE_THEME.line,
                width=3,
            )
    else:
        for source, target in zip(nodes, nodes[1:]):
            draw_arrow_path(
                draw,
                [(source.cx, source.bottom), (target.cx, target.top)],
                width=3,
                head=9,
                halo=False,
            )

    if note_rect and stage.note:
        rounded_box(
            draw,
            note_rect,
            fill=accent_surface(stage.color, strong=True),
            outline=accent_text(stage.color, 138),
            width=1,
            radius=12,
        )
        draw_centered_text(
            draw,
            note_rect.inset(NOTE_PAD_Y),
            "\n".join(note_lines),
            NOTE_FONT,
            fill=color,
            max_lines=len(note_lines),
            spacing=NOTE_LINE_SPACING,
        )


def row_rects(
    count: int,
    *,
    y: float,
    height: float,
    gap: float,
    left: float = CANVAS_MARGIN,
    right: float = WIDTH - CANVAS_MARGIN,
) -> list[Rect]:
    width = (right - left - gap * (count - 1)) / count
    return [Rect(left + index * (width + gap), y, width, height) for index in range(count)]


def draw_row_edges(draw: ImageDraw.ImageDraw, rects: Sequence[Rect]) -> None:
    for source, target in zip(rects, rects[1:]):
        draw_arrow_path(
            draw,
            [(source.right, source.cy), (target.left, target.cy)],
            halo=False,
        )


def draw_mode_rail(
    draw: ImageDraw.ImageDraw,
    labels: Sequence[tuple[str, str]],
    *,
    y: float = 202,
) -> None:
    x = WIDTH - CANVAS_MARGIN
    for value, color in reversed(labels):
        text_width, text_height = text_size(draw, value.upper(), NOTE_FONT)
        width = text_width + 34
        x -= width
        rect = Rect(x, y, width, text_height + 22)
        rounded_box(
            draw,
            rect,
            fill=accent_surface(color),
            outline=accent_text(color, 135),
            width=1,
            radius=13,
        )
        draw_centered_text(
            draw,
            rect.inset(8),
            value.upper(),
            NOTE_FONT,
            fill=accent_text(color),
            max_lines=1,
            spacing=NOTE_LINE_SPACING,
        )
        x -= 24 if value.lower().startswith("separate:") else 12


def draw_outcome_strip(
    draw: ImageDraw.ImageDraw,
    rect: Rect,
    title: str,
    items: Sequence[tuple[str, str]],
) -> None:
    rounded_box(
        draw,
        rect,
        fill=ACTIVE_THEME.chrome_fill,
        outline=ACTIVE_THEME.border,
        width=2,
        radius=20,
    )
    title_width, title_height = text_size(draw, title.upper(), LANE_FONT)
    title_rect = Rect(
        rect.x + 18,
        rect.cy - (title_height + 28) / 2,
        title_width + 38,
        title_height + 28,
    )
    rounded_box(
        draw,
        title_rect,
        fill=ACTIVE_THEME.card_fill,
        outline=ACTIVE_THEME.border,
        width=1,
        radius=13,
    )
    draw_centered_text(
        draw,
        title_rect.inset(8),
        title.upper(),
        LANE_FONT,
        fill=ACTIVE_THEME.muted,
        max_lines=1,
    )

    available_left = title_rect.right + 18
    gap = 14
    item_width = (
        rect.right - available_left - 16 - gap * (len(items) - 1)
    ) / len(items)
    for index, (value, color) in enumerate(items):
        item_rect = Rect(
            available_left + index * (item_width + gap),
            rect.y + 14,
            item_width,
            rect.h - 28,
        )
        rounded_box(
            draw,
            item_rect,
            fill=accent_surface(color),
            outline=accent_text(color, 125),
            width=1,
            radius=13,
        )
        draw.ellipse(
            (item_rect.x + 12, item_rect.cy - 5, item_rect.x + 22, item_rect.cy + 5),
            fill=accent_text(color),
        )
        draw_centered_text(
            draw,
            Rect(
                item_rect.x + 34,
                item_rect.y + 7,
                item_rect.w - 50,
                item_rect.h - 14,
            ),
            value,
            NOTE_FONT,
            fill=ACTIVE_THEME.ink,
            max_lines=3,
            spacing=NOTE_LINE_SPACING,
        )


def common_video_tail(start_number: int = 6) -> tuple[Stage, ...]:
    return (
        Stage(
            start_number,
            "Join + advance",
            "express-video-listener",
            ROSE,
            (
                "Join image, speech, and music gates",
                "Charge completed stages",
                "Recover queued work; honor pause/cancel",
            ),
            "Configured step stages may pause",
        ),
        Stage(
            start_number + 1,
            "Motion layers",
            "ai-video-layer-generator",
            INDIGO,
            (
                "Build motion prompts + start images",
                "Submit / poll provider jobs",
                "Process clip; attach layer output",
            ),
            "Defaults: submit reject 3 | transient poll 6 | base retries up to 3",
        ),
        Stage(
            start_number + 2,
            "Optional finishing",
            "express-video-listener",
            PINK,
            (
                "Delete empty layers + reflow",
                "Lip sync, then SFX, then narrator avatar",
                "Transcript when subtitles are enabled",
            ),
            "SFX / transcript can fall back; lip sync / avatar cannot",
        ),
        Stage(
            start_number + 3,
            "Frame jobs",
            "frames-processor",
            CYAN,
            (
                "Linear: one job per layer",
                "Branched: one job per path entry",
                "Write frames + path manifests",
            ),
            "Up to 3 total attempts",
        ),
        Stage(
            start_number + 4,
            "Final render",
            "video-generator",
            AMBER,
            (
                "Collect frames + enabled audio",
                "FFmpeg compose and mix",
                "Upload + persist result URL",
            ),
            "Render job: up to 2 attempts | upload: up to 3 per job",
        ),
        Stage(
            start_number + 5,
            "Terminal delivery",
            "processor + listener",
            SLATE,
            (
                "Charge final pipeline stage",
                "Settle receipt / external request",
                "Persist status + terminal webhook",
            ),
            "Webhook is best effort after terminal state",
        ),
    )


def render_video_diagram(
    *,
    title: str,
    subtitle: str,
    color: str,
    top_stages: Sequence[Stage],
    modes: Sequence[tuple[str, str]],
) -> Image.Image:
    top_y = 290
    middle_y = top_y + CARD_HEIGHT + ROW_GAP
    final_y = middle_y + CARD_HEIGHT + ROW_GAP
    outcome_y = final_y + CARD_HEIGHT + 60
    video_height = outcome_y + OUTCOME_HEIGHT + 60
    image = Image.new("RGBA", (WIDTH, video_height), TRANSPARENT)
    draw = ImageDraw.Draw(image)
    draw_header(draw, title, subtitle, color)
    draw_mode_rail(draw, modes)

    top_rects = row_rects(5, y=top_y, height=CARD_HEIGHT, gap=32)
    tail = common_video_tail()
    middle_rects = row_rects(3, y=middle_y, height=CARD_HEIGHT, gap=34)
    final_rects = row_rects(3, y=final_y, height=CARD_HEIGHT, gap=34)
    outcome_rect = Rect(
        CANVAS_MARGIN,
        outcome_y,
        WIDTH - CANVAS_MARGIN * 2,
        OUTCOME_HEIGHT,
    )
    add_shadow_layer(
        image,
        [*top_rects, *middle_rects, *final_rects, outcome_rect],
    )
    draw = ImageDraw.Draw(image)

    draw_lane_label(draw, CANVAS_MARGIN, 230, "Plan + prepare", color)
    draw_lane_label(
        draw,
        CANVAS_MARGIN,
        middle_y - 60,
        "Produce + deliver",
        ROSE,
    )
    continued_label = "Produce + deliver — continued"
    continued_width = text_size(
        draw,
        continued_label.upper(),
        LANE_FONT,
    )[0] + 58
    draw_lane_label(
        draw,
        WIDTH - CANVAS_MARGIN - continued_width,
        final_y - 60,
        continued_label,
        ROSE,
    )
    for rect, stage in zip(top_rects, top_stages):
        draw_stage_card(draw, rect, stage)
    for rect, stage in zip(middle_rects, tail[:3]):
        draw_stage_card(draw, rect, stage)
    for rect, stage in zip(final_rects, tail[3:]):
        draw_stage_card(draw, rect, stage)

    draw_row_edges(draw, top_rects)
    draw_row_edges(draw, middle_rects)
    draw_row_edges(draw, final_rects)

    first_bridge_y = top_rects[-1].bottom + 30
    first_bridge_points = [
        (top_rects[-1].cx, top_rects[-1].bottom),
        (top_rects[-1].cx, first_bridge_y),
        (middle_rects[0].cx, first_bridge_y),
        (middle_rects[0].cx, middle_rects[0].top),
    ]
    draw_arrow_path(draw, first_bridge_points)
    draw_edge_label(
        draw,
        (
            (top_rects[-1].cx + middle_rects[0].cx) / 2,
            first_bridge_y,
        ),
        "parallel media gates converge",
        color=ROSE,
    )

    second_bridge_y = middle_rects[-1].bottom + 30
    second_bridge_points = [
        (middle_rects[-1].cx, middle_rects[-1].bottom),
        (middle_rects[-1].cx, second_bridge_y),
        (final_rects[0].cx, second_bridge_y),
        (final_rects[0].cx, final_rects[0].top),
    ]
    draw_arrow_path(draw, second_bridge_points)
    draw_edge_label(
        draw,
        (
            (middle_rects[-1].cx + final_rects[0].cx) / 2,
            second_bridge_y,
        ),
        "pipeline continues",
        color=ROSE,
    )

    draw_outcome_strip(
        draw,
        outcome_rect,
        "Control + outcomes",
        (
            ("Required stage error: FAILED", ROSE),
            ("User cancel: CANCELLED", SLATE),
            ("Configured step: PAUSED", VIOLET),
            ("Optional fallback: continue", ORANGE),
            ("Result URL + settlement: COMPLETED", GREEN),
        ),
    )
    return image


def render_text_to_video() -> Image.Image:
    top = (
        Stage(
            1,
            "Request gate",
            "processor API",
            BLUE,
            (
                "Authenticate + normalize payload",
                "Validate prompt, models, duration, providers",
                "Credit preflight",
            ),
            "External-user signal delegates to scoped wrapper",
        ),
        Stage(
            2,
            "Durable builder",
            "processor + MongoDB",
            CYAN,
            (
                "Create or reuse session ID",
                "Persist QUEUED builder job",
                "Lease, heartbeat, and recovery",
            ),
            "API returns request_id / session_id",
        ),
        Stage(
            3,
            "Narrative plan",
            "processor builder",
            VIOLET,
            (
                "Moderate prompt; generate theme once",
                "Generate + validate scene narrative",
                "Repair oversized speech when possible",
            ),
            "Narrative: up to 3 total attempts",
        ),
        Stage(
            4,
            "Media plan",
            "processor + MongoDB",
            ORANGE,
            (
                "Enrich scene plan",
                "Persist visual + audio layers",
                "Queue scene-image, speech, and music jobs",
            ),
            "Initial audio excludes sound effects",
        ),
        Stage(
            5,
            "Parallel media",
            "generator + audio-generator",
            GREEN,
            (
                "Generate / score scene images",
                "Generate speech",
                "Generate one backing track",
            ),
            "Image scoring/provider: up to 3 | audio retry is provider-specific",
            layout="parallel",
        ),
    )
    return render_video_diagram(
        title="Text to Video",
        subtitle="Prompt | durable plan | parallel media | motion | final video",
        color=BLUE,
        top_stages=top,
        modes=(
            ("standard + v2 alias", BLUE),
            ("external wrapper", CYAN),
            ("step mode", VIOLET),
        ),
    )


def render_image_list_to_video() -> Image.Image:
    top = (
        Stage(
            1,
            "Request gate",
            "processor API",
            BLUE,
            (
                "Authenticate + normalize aliases",
                "Validate image URLs, model, CTA, and options",
                "Provider + credit preflight",
            ),
            "video_model defaults to RUNWAYML",
        ),
        Stage(
            2,
            "Source preparation",
            "processor",
            ORANGE,
            (
                "Download each provider-fetchable URL",
                "Inspect orientation + target coverage",
                "Center-crop when possible; upload temp copy",
            ),
            "No silent AI upscale for low resolution",
        ),
        Stage(
            3,
            "Durable builder",
            "processor + MongoDB",
            CYAN,
            (
                "Create or reuse session ID",
                "Persist prepared source metadata",
                "Queue builder; RUNNING, then COMPLETED / FAILED",
            ),
            "API returns after synchronous source preparation",
        ),
        Stage(
            4,
            "Creative plan",
            "processor builder",
            VIOLET,
            (
                "Describe images (best effort); moderate",
                "Extract theme; generate + validate narrative",
                "Plan optional CTA / outro / footer / avatar",
            ),
            "Narrative: up to 5 total | CTA copy: retry once, then fallback",
        ),
        Stage(
            5,
            "Session + parallel jobs",
            "processor + workers",
            GREEN,
            (
                "Prepared images / optional explicit enhancement",
                "Generate speech",
                "Generate one backing track",
            ),
            "Three gates: image | speech | music; generated outro skips AI video",
            layout="parallel",
        ),
    )
    return render_video_diagram(
        title="Image List to Video",
        subtitle="Prepared source images | creative plan | parallel media | final video",
        color=ORANGE,
        top_stages=top,
        modes=(
            ("standard + v2 alias", BLUE),
            ("external wrapper", CYAN),
            ("step mode", VIOLET),
            ("separate: direct one-image clip", SLATE),
        ),
    )


def render_two_lane_diagram(
    *,
    title: str,
    subtitle: str,
    color: str,
    top_label: str,
    bottom_label: str,
    top_stages: Sequence[Stage],
    bottom_stages: Sequence[Stage],
    dependency: tuple[int, int, str],
    callouts: Sequence[tuple[str, str]],
) -> Image.Image:
    split_bottom = len(bottom_stages) > 5
    top_y = 270
    bottom_y = top_y + CARD_HEIGHT + ROW_GAP
    continuation_gap = ROW_GAP + 60 if split_bottom else ROW_GAP
    continuation_y = bottom_y + CARD_HEIGHT + continuation_gap
    last_row_y = continuation_y if split_bottom else bottom_y
    callout_y = last_row_y + CARD_HEIGHT + 60
    canvas_height = callout_y + OUTCOME_HEIGHT + 60
    image = Image.new("RGBA", (WIDTH, canvas_height), TRANSPARENT)
    draw = ImageDraw.Draw(image)
    draw_header(
        draw,
        title,
        subtitle,
        color,
        secondary_legend="SHARED DATA DEPENDENCY",
    )

    top_rects = row_rects(
        len(top_stages),
        y=top_y,
        height=CARD_HEIGHT,
        gap=32,
    )
    bottom_rows: list[tuple[Sequence[Stage], list[Rect]]] = []
    if split_bottom:
        first_stages = bottom_stages[:3]
        second_stages = bottom_stages[3:]
        bottom_rows = [
            (
                first_stages,
                row_rects(3, y=bottom_y, height=CARD_HEIGHT, gap=34),
            ),
            (
                second_stages,
                row_rects(3, y=continuation_y, height=CARD_HEIGHT, gap=34),
            ),
        ]
    else:
        bottom_rows = [
            (
                bottom_stages,
                row_rects(
                    len(bottom_stages),
                    y=bottom_y,
                    height=CARD_HEIGHT,
                    gap=32,
                ),
            )
        ]
    bottom_rects = [rect for _, rects in bottom_rows for rect in rects]
    callout_rect = Rect(
        CANVAS_MARGIN,
        callout_y,
        WIDTH - CANVAS_MARGIN * 2,
        OUTCOME_HEIGHT,
    )
    add_shadow_layer(image, [*top_rects, *bottom_rects, callout_rect])
    draw = ImageDraw.Draw(image)

    draw_lane_label(draw, CANVAS_MARGIN, 210, top_label, color)
    draw_lane_label(
        draw,
        CANVAS_MARGIN,
        bottom_y - 60,
        bottom_label,
        VIOLET,
    )
    if split_bottom:
        continued_label = f"{bottom_label} — continued"
        continued_width = text_size(
            draw,
            continued_label.upper(),
            LANE_FONT,
        )[0] + 58
        draw_lane_label(
            draw,
            WIDTH - CANVAS_MARGIN - continued_width,
            continuation_y - 60,
            continued_label,
            VIOLET,
        )
    for rect, stage in zip(top_rects, top_stages):
        draw_stage_card(draw, rect, stage)
    for stages, rects in bottom_rows:
        for rect, stage in zip(rects, stages):
            draw_stage_card(draw, rect, stage)
    draw_row_edges(draw, top_rects)
    for _, rects in bottom_rows:
        draw_row_edges(draw, rects)

    if split_bottom:
        first_rects = bottom_rows[0][1]
        second_rects = bottom_rows[1][1]
        bridge_y = first_rects[-1].bottom + 30
        draw_arrow_path(
            draw,
            [
                (first_rects[-1].cx, first_rects[-1].bottom),
                (first_rects[-1].cx, bridge_y),
                (second_rects[0].cx, bridge_y),
                (second_rects[0].cx, second_rects[0].top),
            ],
        )
        draw_edge_label(
            draw,
            (
                (first_rects[-1].cx + second_rects[0].cx) / 2,
                bridge_y,
            ),
            "pipeline continues",
            color=VIOLET,
        )

    source_index, target_index, dependency_label = dependency
    source = top_rects[source_index]
    target = bottom_rects[target_index]
    if split_bottom and target.top > 1000:
        route_x = WIDTH - CANVAS_MARGIN + 16
        upper_y = source.bottom + 30
        dependency_y = target.top - 120
        points = [
            (source.cx, source.bottom),
            (source.cx, upper_y),
            (route_x, upper_y),
            (route_x, dependency_y),
            (target.cx, dependency_y),
            (target.cx, target.top),
        ]
        label_center = ((route_x + target.cx) / 2, dependency_y)
    else:
        dependency_y = source.bottom + 30
        points = [
            (source.cx, source.bottom),
            (source.cx, dependency_y),
            (target.cx, dependency_y),
            (target.cx, target.top),
        ]
        label_center = ((source.cx + target.cx) / 2, dependency_y)
    draw_dashed_arrow_path(draw, points)
    draw_edge_label(
        draw,
        label_center,
        dependency_label,
        color=CYAN,
    )

    draw_outcome_strip(draw, callout_rect, "Edge behavior", callouts)
    return image


def render_search_embeddings() -> Image.Image:
    top = (
        Stage(
            1,
            "Create / update API",
            "processor",
            BLUE,
            (
                "Authenticate + validate input",
                "Choose JSON, plain text, or URL source",
                "Deduplicate source IDs",
            ),
            "Update upserts submitted IDs; others remain",
        ),
        Stage(
            2,
            "Source paths",
            "processor + Firecrawl",
            ORANGE,
            (
                "JSON object records",
                "Clean plain text becomes records",
                "URLs use crawl; skip partial failures",
            ),
            "URL crawl: 502 failed job | 422 no extractable content",
            layout="parallel",
        ),
        Stage(
            3,
            "Shape corpus",
            "embedding service",
            SLATE,
            (
                "Normalize + analyze schema",
                "Build search documents + filters",
                "Drop rows with no searchable fields",
            ),
            "Valid field options can produce an empty template",
        ),
        Stage(
            4,
            "Create embeddings",
            "processor + OpenAI",
            VIOLET,
            (
                "Charge embedding credits",
                "Create template metadata",
                "Embed records; split oversized batches",
            ),
            "Transient retry up to 5 | OpenAI failure refunds + errors",
        ),
        Stage(
            5,
            "Store corpus",
            "MongoDB",
            CYAN,
            (
                "Insert embedding records",
                "Store fields, hash, record count, and TTL",
                "Return template metadata",
            ),
            "Vectors live in EmbeddingRecord documents",
        ),
    )
    bottom = (
        Stage(
            6,
            "Search API",
            "processor",
            BLUE,
            (
                "Authenticate + load user template",
                "Validate non-empty text query",
                "Prepare search options",
            ),
            "Missing: 404 | expired: purge + 410",
        ),
        Stage(
            7,
            "Query + filters",
            "embedding service + OpenAI",
            VIOLET,
            (
                "Resolve query and filter payloads",
                "Charge query credits",
                "Create OpenAI query embedding",
            ),
            "Embedding failure: refund + error",
        ),
        Stage(
            8,
            "Candidate search",
            "MongoDB",
            CYAN,
            (
                "Apply strict explicit vector prefilters",
                "Run Mongo $vectorSearch",
                "Use candidate count + result limit",
            ),
            "$vectorSearch error: Mongo records + JS cosine",
        ),
        Stage(
            9,
            "Post-process",
            "embedding service",
            GREEN,
            (
                "Apply soft / structured post-filters",
                "Optional LLM rerank",
                "Filter-match boost + final sort",
            ),
            "Rerank error preserves vector order",
        ),
        Stage(
            10,
            "Search response",
            "processor API",
            SLATE,
            (
                "Return results[] + filter metadata",
                "Include raw details when requested",
                "Set credit response headers",
            ),
            "No hits returns results: [] (200)",
        ),
    )
    return render_two_lane_diagram(
        title="Search Embeddings",
        subtitle="Index creation and query execution are separate, reusable lanes",
        color=BLUE,
        top_label="Build or update an index",
        bottom_label="Search a stored index",
        top_stages=top,
        bottom_stages=bottom,
        dependency=(4, 2, "stored embedding records feed candidate search"),
        callouts=(
            ("URL crawl can partially succeed", ORANGE),
            ("Empty corpus is valid", SLATE),
            ("Vector failure: JS cosine", CYAN),
            ("Rerank failure keeps order", VIOLET),
            ("No hits returns [] (200)", GREEN),
        ),
    )


def render_recommendations() -> Image.Image:
    top = (
        Stage(
            1,
            "Create reusable template",
            "processor APIs",
            BLUE,
            (
                "Use JSON, plain text, or URL create paths",
                "Analyze fields + build search documents",
                "Retain returned template_id",
            ),
            "Same reusable templates as search",
        ),
        Stage(
            2,
            "Embed corpus",
            "processor + OpenAI",
            VIOLET,
            (
                "Charge embedding credits",
                "Create OpenAI record embeddings",
                "Store retrievable source payload",
            ),
            "No separate recommendation model",
        ),
        Stage(
            3,
            "Store records",
            "MongoDB",
            CYAN,
            (
                "Persist EmbeddingRecord vectors",
                "Persist search documents + filters",
                "Maintain template fields / TTL",
            ),
            "Corpus is shared with search",
        ),
        Stage(
            4,
            "Reusable corpus",
            "embedding service",
            SLATE,
            (
                "Load by template_id + user",
                "Expose stored records to similarity search",
                "Allow an empty corpus",
            ),
            "Expired template: purge + 410",
        ),
    )
    bottom = (
        Stage(
            5,
            "Similar API",
            "processor",
            BLUE,
            (
                "Authenticate + validate template",
                "Accept similarity options",
                "Use recommendation billing/defaults",
            ),
            "Calls shared semantic search",
        ),
        Stage(
            6,
            "Reference item",
            "embedding service",
            ORANGE,
            (
                "Text query",
                "Structured record",
            ),
            "Either or both; at least one query signal is required",
            layout="parallel",
        ),
        Stage(
            7,
            "Resolve query + filters",
            "embedding service",
            VIOLET,
            (
                "Build query document",
                "Resolve inferred, explicit, and soft filters",
                "Charge query credits",
            ),
            "Inferred filters: no strict prefilter",
        ),
        Stage(
            8,
            "Query embedding",
            "OpenAI",
            INDIGO,
            (
                "Create semantic query vector",
                "Continue to shared candidate search",
            ),
            "Embedding failure refunds credits + errors",
        ),
        Stage(
            9,
            "Shared semantic search",
            "MongoDB + embedding service",
            CYAN,
            (
                "Strict explicit filters use vector prefilter",
                "Mongo $vectorSearch; JS cosine fallback",
                "Soft post-filter + match boost (up to 0.1)",
            ),
            "No LLM rerank; no configurable field weights",
        ),
        Stage(
            10,
            "Recommendation response",
            "processor API",
            GREEN,
            (
                "Map results to {id, score}",
                "Return structured_filters + matches[]",
                "Set credit response headers",
            ),
            "No hits returns matches: [] (200)",
        ),
    )
    return render_two_lane_diagram(
        title="Recommendations",
        subtitle="A constrained wrapper around the shared semantic-search pipeline",
        color=CYAN,
        top_label="Reusable embedding corpus",
        bottom_label="Find similar records",
        top_stages=top,
        bottom_stages=bottom,
        dependency=(3, 4, "reused corpus feeds shared semantic search"),
        callouts=(
            ("Text and/or structured record", ORANGE),
            ("Strict explicit: vector prefilter", BLUE),
            ("Inferred filter: non-strict", VIOLET),
            ("Vector failure: JS cosine", CYAN),
            ("No matches returns [] (200)", GREEN),
        ),
    )


def validate_rendered_image(name: str, image: Image.Image) -> None:
    if image.mode != "RGBA":
        raise ValueError(f"{name}: expected RGBA output, got {image.mode}")
    alpha = image.getchannel("A")
    minimum_alpha, maximum_alpha = alpha.getextrema()
    if minimum_alpha != 0 or maximum_alpha != 255:
        raise ValueError(
            f"{name}: expected transparent canvas and opaque content; "
            f"alpha extrema were {minimum_alpha}/{maximum_alpha}"
        )
    corners = [
        image.getpixel((0, 0))[3],
        image.getpixel((image.width - 1, 0))[3],
        image.getpixel((0, image.height - 1))[3],
        image.getpixel((image.width - 1, image.height - 1))[3],
    ]
    if any(corners):
        raise ValueError(f"{name}: canvas corners must remain transparent")


def main() -> None:
    global ACTIVE_THEME

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    renderers = (
        ("readme-text-to-video-pipeline-v3", render_text_to_video),
        ("readme-image-list-to-video-pipeline-v3", render_image_list_to_video),
        ("readme-search-embeddings-pipeline-v3", render_search_embeddings),
        ("readme-recommendations-pipeline-v3", render_recommendations),
    )
    for theme in (LIGHT_THEME, DARK_THEME):
        ACTIVE_THEME = theme
        suffix = "" if theme.name == "light" else "-dark"
        for stem, renderer in renderers:
            filename = f"{stem}{suffix}.png"
            image = renderer()
            validate_rendered_image(filename, image)
            output = OUTPUT_DIR / filename
            image.save(output, optimize=True)
            print(f"rendered {output}")


if __name__ == "__main__":
    main()
