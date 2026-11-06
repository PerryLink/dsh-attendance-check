#!/usr/bin/env python3
"""Generate the README visuals for dsh-attendance-check.

Outputs (all under docs/assets/, idempotent overwrite):

  dsh-attendance-check-hero-zh-light.webp  1440x576  Pillow poster
  dsh-attendance-check-hero-zh-dark.webp
  dsh-attendance-check-hero-en-light.webp
  dsh-attendance-check-hero-en-dark.webp
  dsh-attendance-check-flow-v5-light.svg   1100x660  hand-written SVG
  dsh-attendance-check-flow-v5-dark.svg

Hero -- checker grammar, folded into one worked-hours ledger:
  real punch rows from samples/quickstart/input/attendance-2026-06.csv are
  drawn on a 0-12h ruler. The two rule lines are the 8h standard and the 11h
  daily cap (8h + 3h); every bar is split into standard / overtime / over-cap
  minutes and ends in the verdict the tool really emits (overtime,
  over_limit, missing_punch, rest_short). Geometry: document rows -> rule
  lines -> verdict chips.

Flow -- state-machine grammar, not a row of five boxes:
  the six-gate priority cascade of evaluateRecord() (weekend skip, missing
  punch, daily cap, short break, holiday, overtime, else normal) feeds the
  severity-ranked violation queue (30 / 25 / 20 / 10) and the monthly-cap
  state; that one audit exits as attendance.summary and attendance.export.
  The SVG is language-neutral (English + code tokens) so the same light/dark
  pair serves all five README languages.

Every number comes from samples/quickstart/expected/result.json (6 employees
x 5 workdays, 30 rows, 3 violations) -- nothing is invented.

Run once:  python scripts/gen-readme-assets.py
Requires:  Pillow (hero raster) + the Microsoft YaHei / Consolas fonts that
           ship with Windows; the SVG is plain text.
"""
from __future__ import annotations

import math
import os
import sys
from xml.sax.saxutils import escape

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

# --------------------------------------------------------------------------
# fonts
# --------------------------------------------------------------------------
FONT_CANDIDATES = {
    "sans": [r"C:\Windows\Fonts\msyh.ttc",
             "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
             "/System/Library/Fonts/PingFang.ttc"],
    "sans_bold": [r"C:\Windows\Fonts\msyhbd.ttc",
                  "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
                  "/System/Library/Fonts/PingFang.ttc"],
    "mono": [r"C:\Windows\Fonts\consola.ttf",
             r"C:\Windows\Fonts\cour.ttf",
             "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
             "/System/Library/Fonts/Menlo.ttc"],
}
FONT_PATH = {}
for _key, _paths in FONT_CANDIDATES.items():
    _found = next((p for p in _paths if os.path.exists(p)), None)
    if _found is None:
        sys.exit(f"FATAL: no font for {_key!r}; looked for {_paths}. "
                 "Refusing to render tofu boxes.")
    FONT_PATH[_key] = _found

_cache: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def font(size: int, kind: str = "sans") -> ImageFont.FreeTypeFont:
    key = (kind, size)
    if key not in _cache:
        _cache[key] = ImageFont.truetype(FONT_PATH[kind], size, index=0)
    return _cache[key]


_measure_draw = ImageDraw.Draw(Image.new("RGB", (8, 8)))


def text_width(text: str, size: float, bold: bool = False,
               mono: bool = False) -> float:
    kind = "mono" if mono else ("sans_bold" if bold else "sans")
    return _measure_draw.textlength(text, font=font(round(size), kind))


def assert_fit(text: str, size: float, limit: float, *, bold=False, mono=False,
               where: str = "") -> float:
    """Fail loudly instead of shipping a clipped / overflowing label."""
    width = text_width(text, size, bold, mono)
    if width > limit:
        raise SystemExit(
            f"FATAL: text overflows in {where or '?'} "
            f"({width:.0f}px > {limit:.0f}px at {size}px): {text!r}")
    return width


def fit_size(text: str, limit: float, start: float, floor: float, *,
             bold=False, mono=False) -> float:
    size = float(start)
    while size > floor and text_width(text, size, bold, mono) > limit:
        size -= 0.5
    if text_width(text, size, bold, mono) > limit:
        raise SystemExit(f"FATAL: cannot fit {text!r} into {limit}px "
                         f"(floor {floor}px)")
    return size


# --------------------------------------------------------------------------
# palette
# --------------------------------------------------------------------------
THEMES = {
    "light": dict(
        bg_top=(249, 246, 253), bg_bottom=(228, 234, 248),
        ink=(24, 29, 45), ink2=(66, 78, 104), muted=(104, 116, 142),
        faint=(146, 156, 178),
        surface=(255, 255, 255), surface_alt=(244, 247, 253),
        border=(213, 220, 240), grid=(224, 229, 243),
        family=(75, 103, 180), family_soft=(232, 238, 252),
        ok=(26, 130, 92), warn=(168, 112, 24), hot=(186, 66, 44),
        violet=(102, 76, 184), info=(52, 92, 184), teal=(15, 118, 110),
        shadow=(38, 50, 92),
    ),
    "dark": dict(
        bg_top=(19, 26, 42), bg_bottom=(12, 16, 22),
        ink=(238, 242, 255), ink2=(178, 189, 214), muted=(146, 158, 186),
        faint=(112, 124, 152),
        surface=(23, 31, 48), surface_alt=(19, 26, 41),
        border=(43, 54, 82), grid=(35, 45, 68),
        family=(132, 150, 245), family_soft=(35, 45, 74),
        ok=(84, 214, 165), warn=(226, 179, 74), hot=(240, 138, 93),
        violet=(180, 158, 246), info=(122, 162, 247), teal=(94, 210, 198),
        shadow=(0, 0, 0),
    ),
}

KIND_COLOR = {"standard": "family", "overtime": "warn", "over_limit": "hot",
              "missing": "violet", "rest_short": "teal", "ok": "ok"}


def mix(rgb, other, ratio):
    return tuple(round(rgb[i] + (other[i] - rgb[i]) * ratio) for i in range(3))


def over(rgb, theme, alpha):
    """Flatten `rgb` against the theme surface for alpha-style fills."""
    return mix(theme["surface"], rgb, alpha)


# --------------------------------------------------------------------------
# drawing surface with supersampling
# --------------------------------------------------------------------------
class Sheet:
    """2x supersampled RGBA canvas; every coordinate is in final pixels."""

    def __init__(self, width: int, height: int, theme: dict, ss: int = 2):
        self.w, self.h, self.ss, self.t = width, height, ss, theme
        base = Image.new("RGB", (1, 2))
        base.putpixel((0, 0), theme["bg_top"])
        base.putpixel((0, 1), theme["bg_bottom"])
        self.img = base.resize((width * ss, height * ss),
                               Image.BILINEAR).convert("RGBA")
        self.d = ImageDraw.Draw(self.img)

    # -- primitives -------------------------------------------------------
    def _box(self, box):
        s = self.ss
        return [round(v * s) for v in box]

    def rounded(self, box, radius, fill=None, outline=None, width=1):
        self.d.rounded_rectangle(self._box(box), radius=radius * self.ss,
                                 fill=fill, outline=outline,
                                 width=max(1, round(width * self.ss)))

    def rect(self, box, fill=None, outline=None, width=1):
        self.d.rectangle(self._box(box), fill=fill, outline=outline,
                         width=max(1, round(width * self.ss)))

    def line(self, xy, fill, width=1):
        s = self.ss
        self.d.line([(round(xy[0] * s), round(xy[1] * s)),
                     (round(xy[2] * s), round(xy[3] * s))],
                    fill=fill, width=max(1, round(width * s)))

    def dashed_line(self, x1, y1, x2, y2, fill, width=1.5, dash=5, gap=5):
        length = math.hypot(x2 - x1, y2 - y1)
        if length <= 0:
            return
        ux, uy = (x2 - x1) / length, (y2 - y1) / length
        pos = 0.0
        while pos < length:
            end = min(pos + dash, length)
            self.line((x1 + ux * pos, y1 + uy * pos,
                       x1 + ux * end, y1 + uy * end), fill, width)
            pos += dash + gap

    def dot(self, cx, cy, r, fill):
        s = self.ss
        self.d.ellipse([(cx - r) * s, (cy - r) * s, (cx + r) * s,
                        (cy + r) * s], fill=fill)

    def text(self, xy, s, size, fill, *, bold=False, mono=False, anchor="ls"):
        kind = "mono" if mono else ("sans_bold" if bold else "sans")
        self.d.text((xy[0] * self.ss, xy[1] * self.ss), s,
                    font=font(round(size * self.ss), kind),
                    fill=fill, anchor=anchor)

    def shadow(self, box, radius, dy=14, blur=26, alpha=34):
        s = self.ss
        layer = Image.new("RGBA", self.img.size, (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        b = self._box((box[0], box[1] + dy, box[2], box[3] + dy))
        ld.rounded_rectangle(b, radius=radius * s,
                             fill=self.t["shadow"] + (alpha,))
        layer = layer.filter(ImageFilter.GaussianBlur(blur * s))
        self.img.alpha_composite(layer)
        self.d = ImageDraw.Draw(self.img)

    def save(self, path):
        out = self.img.resize((self.w, self.h), Image.LANCZOS)
        out.convert("RGB").save(path, "WEBP", quality=94, method=6)


# --------------------------------------------------------------------------
# hero content -- every number below is from the quickstart fixture
# --------------------------------------------------------------------------
HERO_W, HERO_H = 1440, 576

# worked / overtime / over-cap hours come from
# samples/quickstart/expected/result.json (check.employees[].days[]).
HERO_ROWS = [
    dict(date="06-23", pin="14:00", pout=("次日 00:30", "next 00:30"),
         worked=9.5, overtime=1.5, over=0.0,
         name=("张伟", "Zhang Wei"),
         verdict=("加班 +1.5h", "overtime +1.5h"),
         kind="overtime", miss_note=("", "")),
    dict(date="06-24", pin="09:00", pout=("21:30", "21:30"),
         worked=11.5, overtime=3.5, over=0.5,
         name=("李娜", "Li Na"),
         verdict=("超限 +0.5h", "over cap +0.5h"),
         kind="over_limit", miss_note=("", "")),
    dict(date="06-25", pin="09:00", pout=("", ""),
         worked=0.0, overtime=0.0, over=0.0,
         name=("王强", "Wang Qiang"),
         verdict=("缺卡 · 工时 0", "missing · 0h"),
         kind="missing", miss_note=("缺下班卡", "no clock-out")),
    dict(date="06-26", pin="09:00", pout=("17:30", "17:30"),
         worked=8.0, overtime=0.0, over=0.0,
         name=("刘洋", "Liu Yang"),
         verdict=("休息不足 30min", "short break 30m"),
         kind="rest_short", miss_note=("", "")),
]

HERO_COPY = {
    "zh": dict(
        kicker="CHECKER · 考勤核对",
        title="打卡核对",
        value=("把打卡明细核成每人的日工时与加班",
               "缺卡、超限、休息不足排序成清单"),
        sub="8h 标准 · 单日加班 ≤3h · 月加班 ≤36h · 休息 ≥60min",
        meta="纯本地 · 源文件只读 · 无网络 · 不调用模型 · 不上传",
        footer="dsh-attendance-check · Apache-2.0 · DSH ≥0.2.1 <0.4.0",
        panel_title="打卡明细 → 日工时判定",
        panel_meta="attendance.check · 2026-06-22 → 06-26",
        col_name="员工 / 日期", col_punch="上下班",
        col_ruler="日工时 0–12h", col_verdict="判定",
        worked_label="工时 {h}h",
        rest_note="休息 30min < 60min",
        legend1="工时 = 下班 − 上班 − 休息     加班 = max(0, 工时 − 8h)",
        legend2="┈ 8h 标准工时   ┄ 11h 单日上限（8h + 3h）· 月加班 >36h 记月超限",
    ),
    "en": dict(
        kicker="CHECKER · ATTENDANCE AUDIT",
        title="Punch audit",
        value=("Punch rows → daily hours and overtime",
               "Missing punches, caps, breaks — ranked"),
        sub="8h · 3h daily cap · 36h monthly · 60min break",
        meta="Local only · read-only · no network · no model call",
        footer="dsh-attendance-check · Apache-2.0 · DSH ≥0.2.1 <0.4.0",
        panel_title="Punch rows → daily hours",
        panel_meta="attendance.check · 2026-06-22 → 06-26",
        col_name="employee / date", col_punch="clock in → out",
        col_ruler="worked hours 0–12h", col_verdict="verdict",
        worked_label="worked {h}h",
        rest_note="break 30min < 60min",
        legend1="worked = out − in − break     overtime = max(0, worked − 8h)",
        legend2="┈ 8h standard   ┄ 11h daily cap (8h + 3h) · month >36h → over-limit",
    ),
}

# hero geometry (final pixels)
LX = 72                       # left column x
PANEL = (744, 64, 1408, 520)  # right panel box
PANEL_X0, PANEL_Y0, PANEL_X1, PANEL_Y1 = PANEL
PAD = 28
RULER_X0, RULER_X1 = 992, 1232
RULER_SPAN_H = 12.0
VERDICT_X0, VERDICT_X1 = 1246, 1380
ROW_TOPS = (176, 242, 308, 374)
PER_HOUR = (RULER_X1 - RULER_X0) / RULER_SPAN_H


def hero(lang: str, theme_name: str) -> Sheet:
    c = HERO_COPY[lang]
    t = THEMES[theme_name]
    zh = lang == "zh"
    s = Sheet(HERO_W, HERO_H, t)

    # ---- left column: kicker / title / two value lines / sub / meta ----
    pill_text = c["kicker"]
    psize = fit_size(pill_text, 330, 17, 14, bold=True)
    pw = text_width(pill_text, psize, bold=True) + 54
    s.rounded((LX, 74, LX + pw, 116), 21, fill=over(t["family"], t, 0.10),
              outline=over(t["family"], t, 0.40), width=1.2)
    s.dot(LX + 23, 95, 3.6, t["family"])
    s.text((LX + 38, 95), pill_text, psize, t["family"], bold=True, anchor="lm")

    assert_fit(c["title"], 88, 620, bold=True, where="hero title")
    s.text((LX, 232), c["title"], 88, t["ink"], bold=True)

    v1, v2 = c["value"]
    assert_fit(v1, 27, 628, where="hero value line 1")
    assert_fit(v2, 27, 628, where="hero value line 2")
    s.text((LX, 288), v1, 27, t["ink2"])
    s.text((LX, 326), v2, 27, t["ink2"])

    assert_fit(c["sub"], 25, 628, where="hero subtitle")
    s.text((LX, 378), c["sub"], 25, t["muted"])

    s.line((LX, 412, LX + 560, 412), over(t["border"], t, 0.95), width=1.2)
    assert_fit(c["meta"], 20, 628, where="hero meta")
    s.text((LX, 452), c["meta"], 20, t["faint"])

    s.line((LX, 508, LX + 560, 508), over(t["border"], t, 0.95), width=1.2)
    assert_fit(c["footer"], 15.5, 628, where="hero footer")
    s.text((LX, 536), c["footer"], 15.5, t["faint"])

    # ---- right panel ----------------------------------------------------
    s.shadow(PANEL, 22, dy=16, blur=28, alpha=42 if theme_name == "light" else 130)
    s.rounded(PANEL, 22, fill=t["surface"],
              outline=over(t["border"], t, 0.95), width=1.4)

    il, ir = PANEL_X0 + PAD, PANEL_X1 - PAD
    psize = fit_size(c["panel_title"], 320, 18, 15, bold=True)
    s.text((il, 118), c["panel_title"], psize, t["ink"], bold=True)
    s.text((ir, 118), c["panel_meta"], 12.5, t["muted"], mono=True, anchor="rs")
    s.line((il, 132, ir, 132), over(t["border"], t, 0.9), width=1.1)

    s.text((il, 160), c["col_name"], 12.5, t["muted"])
    s.text((890, 160), c["col_punch"], 12.5, t["muted"])
    s.text((RULER_X0, 160), c["col_ruler"], 12.5, t["muted"])
    s.text((ir, 160), c["col_verdict"], 12.5, t["muted"], anchor="rs")

    # rule lines: 8h standard, 11h daily cap (8h + 3h)
    eight_x = RULER_X0 + 8 * PER_HOUR
    cap_x = RULER_X0 + 11 * PER_HOUR
    s.dashed_line(eight_x, 172, eight_x, 436, over(t["family"], t, 0.55),
                  width=1.5, dash=5, gap=4)
    s.dashed_line(cap_x, 172, cap_x, 436, over(t["hot"], t, 0.75),
                  width=1.5, dash=3, gap=4)
    s.text((eight_x - 4, 167), "8h", 11, t["family"], anchor="rs")
    s.text((cap_x + 4, 167), "11h", 11, t["hot"])

    for i, row in enumerate(HERO_ROWS):
        top = ROW_TOPS[i]
        color = t[KIND_COLOR[row["kind"]]]
        name = row["name"][0 if zh else 1]
        nsize = fit_size(name, 104, 16, 13, bold=True)
        s.text((il, top + 24), name, nsize, t["ink"], bold=True)
        s.text((il, top + 45), row["date"], 12, t["muted"], mono=True)

        pin = row["pin"]
        pout = row["pout"][0 if zh else 1]
        s.text((890, top + 23), pin, 12.5, t["ink2"])
        s.text((890, top + 42), pout or "—", 12.5, t["ink2"])

        # bar: standard (family) -> overtime (warn) -> over cap (hot)
        y0, y1 = top + 19, top + 32
        std_end = RULER_X0 + 8 * PER_HOUR
        if row["kind"] == "missing":
            s.rounded((RULER_X0, y0, std_end, y1), 6.5,
                      fill=over(t["muted"], t, 0.08),
                      outline=over(t["muted"], t, 0.50), width=1.1)
            s.text(((RULER_X0 + std_end) / 2, (y0 + y1) / 2 + 1),
                   row["miss_note"][0 if zh else 1], 11.5, t["muted"],
                   anchor="mm")
        else:
            wx = RULER_X0 + row["worked"] * PER_HOUR
            s.rounded((RULER_X0, y0, wx, y1), 6.5, fill=t["family"])
            if row["overtime"] > 0:
                ot_end = RULER_X0 + (8 + row["overtime"]) * PER_HOUR
                s.rect((std_end, y0, ot_end - 6, y1), fill=t["warn"])
                s.rounded((ot_end - 13, y0, ot_end, y1), 6.5, fill=t["warn"])
            if row["over"] > 0:
                s.rect((cap_x, y0, wx - 6, y1), fill=t["hot"])
                s.rounded((wx - 13, y0, wx, y1), 6.5, fill=t["hot"])

        if row["kind"] == "rest_short":
            s.text((RULER_X0, top + 50), c["rest_note"], 11.5, color)

        vtext = row["verdict"][0 if zh else 1]
        vsize = fit_size(vtext, VERDICT_X1 - VERDICT_X0 - 22, 13.5, 11,
                         bold=True)
        s.rounded((VERDICT_X0, top + 8, VERDICT_X1, top + 38), 15,
                  fill=over(color, t, 0.13), outline=over(color, t, 0.50),
                  width=1.2)
        s.text(((VERDICT_X0 + VERDICT_X1) / 2, top + 23), vtext, vsize, color,
               bold=True, anchor="mm")
        hours = f"{row['worked']:.1f}".rstrip("0").rstrip(".")
        s.text((VERDICT_X1, top + 56), c["worked_label"].format(h=hours), 12,
               t["muted"], anchor="rs")

    # legend (the two rules the bars are measured against)
    s.line((il, 444, ir, 444), over(t["border"], t, 0.9), width=1.1)
    assert_fit(c["legend1"], 13.5, ir - il, where="hero legend 1")
    assert_fit(c["legend2"], 13.5, ir - il, where="hero legend 2")
    s.text((il, 468), c["legend1"], 13.5, t["ink2"])
    s.text((il, 490), c["legend2"], 13.5, t["muted"])
    return s


# --------------------------------------------------------------------------
# flow SVG -- day-state priority cascade (state machine), 1100x660
# --------------------------------------------------------------------------
FLOW_W, FLOW_H = 1100, 660

FLOW_TITLE = "Day-state cascade → ranked violations"
FLOW_SUB = ("Six short-circuit gates in evaluateRecord order — yes → state, "
            "no ↓ next gate. Issues never abort; only bad CSV, date, time, "
            "break or policy do.")
FLOW_META = "6 employees · 30 rows · 2026-06-22 → 06-26"

INPUT_FIELDS = ["employee", "date", "clock_in", "clock_out", "break_minutes"]
POLICY_ROWS = [("standard_hours", "8"), ("daily_overtime_cap_hours", "3"),
               ("monthly_overtime_cap_hours", "36"), ("min_break_minutes", "60"),
               ("include_holidays", "false")]

GATES = [
    ("weekend && !include_holidays", "skipped weekend", "skipped_holiday_rows",
     "muted", False),
    ("clock_in or clock_out empty", "missing_punch", "high · rank 30",
     "violet", True),
    ("overtime > 180 min", "over_limit (day)", "medium · rank 20", "hot", True),
    ("break < 60 min", "rest_short", "low · rank 10", "teal", True),
    ("weekend && include_holidays", "holiday", "0h standard, all overtime",
     "info", False),
    ("overtime > 0", "overtime", "no issue", "warn", False),
]
ELSE_STATE = ("normal", "no issue")

RANKS = [
    ("30", "violet", "missing_punch · high", "Wang Qiang 06-25 · worked 0"),
    ("25", "hot", "monthly over_limit · high",
     "not triggered: 210 ≤ 2160 min"),
    ("20", "hot", "over_limit (day) · medium", "Li Na 06-24 · +30 min over"),
    ("10", "teal", "rest_short · low", "Liu Yang 06-26 · break 30 min"),
]

SANS = ("'Microsoft YaHei','PingFang SC','Noto Sans CJK SC',"
        "'Source Han Sans SC',sans-serif")
MONO = ("Consolas,'Cascadia Mono','SFMono-Regular',ui-monospace,monospace")


def hexs(rgb):
    return "#%02x%02x%02x" % tuple(rgb)


def col(value):
    """SVG colour: hex for RGB tuples, pass literal strings through."""
    if isinstance(value, (tuple, list)):
        return hexs(value)
    return value


class Flow:
    def __init__(self, theme_name: str):
        self.t = THEMES[theme_name]
        self.theme_name = theme_name
        self.lines: list[str] = []
        t = self.t
        self.head = (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{FLOW_W}" '
            f'height="{FLOW_H}" viewBox="0 0 {FLOW_W} {FLOW_H}" '
            f'role="img" aria-labelledby="flowTitle flowDesc">'
            f'<title id="flowTitle">dsh-attendance-check day-state cascade</title>'
            f'<desc id="flowDesc">Six short-circuit gates judge each punch row '
            f'into one day state; issues are ranked 30/25/20/10 and the monthly '
            f'cap is checked separately; the audit exits as attendance.summary '
            f'and attendance.export.</desc>'
            f'<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">'
            f'<stop offset="0" stop-color="{hexs(t["bg_top"])}"/>'
            f'<stop offset="1" stop-color="{hexs(t["bg_bottom"])}"/>'
            f'</linearGradient></defs>'
            f'<rect width="{FLOW_W}" height="{FLOW_H}" rx="20" fill="url(#bg)"/>'
        )

    # -- primitives -------------------------------------------------------
    def rect(self, x, y, w, h, r=0, fill="none", stroke=None, sw=1.2):
        out = (f'<rect x="{x}" y="{y}" width="{w}" height="{h}"'
               + (f' rx="{r}"' if r else "")
               + f' fill="{col(fill)}"')
        if stroke:
            out += f' stroke="{col(stroke)}" stroke-width="{sw}"'
        return out + "/>"

    def text(self, x, y, s, size, fill, *, bold=False, mono=False,
             anchor="start", opacity=None):
        fam = MONO if mono else SANS
        weight = 700 if bold else 400
        op = f' opacity="{opacity}"' if opacity is not None else ""
        return (f'<text x="{x}" y="{y}" font-family="{fam}" '
                f'font-size="{size}" font-weight="{weight}" fill="{col(fill)}" '
                f'text-anchor="{anchor}"{op}>{escape(s)}</text>')

    def line(self, x1, y1, x2, y2, stroke, sw=1.4, dash=None):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        return (f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
                f'stroke="{col(stroke)}" stroke-width="{sw}" '
                f'stroke-linecap="round"{d}/>')

    def arrow(self, x1, y1, x2, y2, stroke, sw=1.6, head=5.0):
        stroke = col(stroke)
        ang = math.atan2(y2 - y1, x2 - x1)
        bx, by = x2 - head * math.cos(ang), y2 - head * math.sin(ang)
        out = [self.line(x1, y1, bx, by, stroke, sw)]
        p2 = (bx - head * 0.55 * math.sin(ang), by + head * 0.55 * math.cos(ang))
        p3 = (bx + head * 0.55 * math.sin(ang), by - head * 0.55 * math.cos(ang))
        pts = " ".join(f"{px:.1f},{py:.1f}" for px, py in ((x2, y2), p2, p3))
        out.append(f'<polygon points="{pts}" fill="{stroke}"/>')
        return "".join(out)

    # -- composites -------------------------------------------------------
    def card(self, x, y, w, h, title, tag, mono_title=False, tag_on_title=False):
        t = self.t
        self.lines.append(self.rect(x, y, w, h, 16, t["surface"],
                                    over(t["border"], t, 0.95), 1.3))
        size = 17.0
        while size > 13 and text_width(title, size, bold=True,
                                       mono=mono_title) > w - 44:
            size -= 0.5
        self.lines.append(self.text(x + 16, y + 28, title, size, t["ink"],
                                    bold=True, mono=mono_title))
        if tag:
            if tag_on_title:
                self.lines.append(self.text(x + w - 16, y + 28, tag, 12,
                                            t["muted"], anchor="end"))
            else:
                self.lines.append(self.text(x + 16, y + 47, tag, 12.5,
                                            t["muted"]))

    def state_chip(self, x, y, w, h, name, tag, color, is_issue):
        t = self.t
        self.lines.append(self.rect(x, y, w, h, 12, over(color, t, 0.10),
                                    over(color, t, 0.60), 1.3))
        nm = 15.5
        while nm > 12 and text_width(name, nm, bold=True, mono=True) > w - 24:
            nm -= 0.5
        self.lines.append(self.text(x + 12, y + 20, name, nm, color, bold=True,
                                    mono=True))
        tg = 12.5
        while tg > 10.5 and text_width(tag, tg, mono=True) > w - 22:
            tg -= 0.5
        self.lines.append(self.text(x + 12, y + 37, tag, tg, t["muted"],
                                    mono=True))
        if is_issue:
            self.lines.append(f'<circle cx="{x + w - 13}" cy="{y + 13}" '
                              f'r="3.2" fill="{color}"/>')

    # -- composition ------------------------------------------------------
    def build(self) -> str:
        t = self.t
        L = self.lines
        L.append(self.head)
        ink, ink2, muted, faint = t["ink"], t["ink2"], t["muted"], t["faint"]
        family = t["family"]
        arrow_c = over(muted, t, 0.85)

        # header ----------------------------------------------------------
        assert_fit(FLOW_TITLE, 25, 660, bold=True, where="flow title")
        assert_fit(FLOW_META, 12.5, 330, mono=True, where="flow meta")
        assert_fit(FLOW_SUB, 14, 1000, where="flow subtitle")
        L.append(self.text(40, 46, FLOW_TITLE, 25, ink, bold=True))
        L.append(self.text(1060, 46, FLOW_META, 12.5, muted, mono=True,
                           anchor="end"))
        L.append(self.text(40, 70, FLOW_SUB, 14, muted))

        # left column: input + policy -------------------------------------
        self.card(40, 88, 228, 170, "INPUT · punch CSV",
                  "read-only · UTF-8 · ≤ 20 MB")
        for i, field in enumerate(INPUT_FIELDS):
            yy = 164 + i * 20
            L.append(f'<circle cx="60" cy="{yy - 4}" r="2.4" fill="{faint}"/>')
            L.append(self.text(70, yy, field, 13, ink2, mono=True))

        self.card(40, 274, 228, 180, "POLICY", "per-call parameters")
        for i, (key, value) in enumerate(POLICY_ROWS):
            yy = 350 + i * 24
            ksize = 12.0
            while ksize > 10 and text_width(key, ksize, mono=True) > 178:
                ksize -= 0.5
            assert_fit(key, ksize, 178, mono=True, where=f"policy {key}")
            L.append(self.text(54, yy, key, ksize, muted, mono=True))
            L.append(self.text(254, yy, value, 13.5, family, bold=True,
                               anchor="end"))

        # middle column: the six gates + else ---------------------------
        gate_x0, gate_x1 = 300, 552
        state_x0, state_x1 = 568, 744
        tops = [88 + i * 54 for i in range(7)]
        for i, (cond, name, tag, color_key, is_issue) in enumerate(GATES):
            top = tops[i]
            cy = top + 22
            L.append(self.rect(gate_x0, top, gate_x1 - gate_x0, 44, 12,
                               over(t["surface_alt"], t, 0.9), t["border"], 1.2))
            L.append(f'<circle cx="314" cy="{cy}" r="9" fill="'
                     f'{hexs(over(family, t, 0.16))}"/>')
            L.append(self.text(314, cy + 4, str(i + 1), 11.5, family,
                               bold=True, anchor="middle"))
            assert_fit(cond, 14, 212, where=f"gate {i + 1}")
            L.append(self.text(330, cy + 5, cond, 14, ink))
            L.append(self.arrow(gate_x1, cy, state_x0 - 4, cy, arrow_c))
            self.state_chip(state_x0, top, state_x1 - state_x0, 44, name, tag,
                            t[color_key], is_issue)

        # else path: gate 6 -> normal
        gate_cx = (gate_x0 + gate_x1) / 2
        ny = tops[6] + 22
        L.append(f'<path d="M{gate_cx} {tops[5] + 44} V{ny} '
                 f'H{state_x0 - 12}" fill="none" stroke="{arrow_c}" '
                 f'stroke-width="1.6" stroke-linecap="round"/>')
        L.append(self.arrow(state_x0 - 12, ny, state_x0 - 2, ny, arrow_c))
        L.append(self.text(gate_cx + 8, ny - 7, "else", 12.5, faint))
        self.state_chip(state_x0, tops[6], state_x1 - state_x0, 44,
                        ELSE_STATE[0], ELSE_STATE[1], t["ok"], False)

        # fall-through arrows between gates
        for i in range(5):
            L.append(self.arrow(gate_cx, tops[i] + 45, gate_cx, tops[i + 1] - 1,
                                over(muted, t, 0.7), sw=1.4, head=4.2))

        # right column: ranked violations + monthly cap ------------------
        rx, rw = 764, 296
        self.card(rx, 88, rw, 278, "violations[] ranked",
                  "3 hits · rank 30 > 25 > 20 > 10")
        for i, (rank, color_key, line1, line2) in enumerate(RANKS):
            top = 152 + i * 52
            color = t[color_key]
            L.append(self.rect(782, top, 36, 36, 10, over(color, t, 0.14),
                               over(color, t, 0.55), 1.2))
            L.append(self.text(800, top + 24, rank, 15, color, bold=True,
                               anchor="middle"))
            assert_fit(line1, 13.5, 208, mono=True, where=f"rank {rank} line 1")
            assert_fit(line2, 12.5, 208, where=f"rank {rank} line 2")
            L.append(self.text(828, top + 16, line1, 13.5, ink, mono=True))
            L.append(self.text(828, top + 34, line2, 12.5, muted))

        self.card(rx, 382, rw, 88, "monthly cap 36h = 2160 min", "")
        L.append(self.rect(780, 424, 264, 9, 4.5, over(t["border"], t, 0.9)))
        L.append(self.rect(780, 424, max(14, round(264 * 210 / 2160)), 9, 4.5,
                           family))
        L.append(self.text(780, 458, "max 210 min (Li Na) · over_limit = false",
                           12.5, muted))

        # exit band -------------------------------------------------------
        self.card(40, 490, 500, 144, "attendance.summary", "R0 · read-only",
                  mono_title=True, tag_on_title=True)
        L.append(self.text(56, 550, "6 rows = employee × month · expected 5 · "
                           "attended 4 or 5", 13, ink2))
        L.append(self.text(56, 574, "overtime 300 min · anomalies 3 · "
                           "monthly over_limit 0", 13, ink2))
        L.append(self.text(56, 600, "month=YYYY-MM filters a single month",
                           12.5, muted))

        self.card(560, 490, 500, 144, "attendance.export", "R1 · local write",
                  mono_title=True, tag_on_title=True)
        L.append(self.text(576, 550, "30 rows × 9 columns, one per audited "
                           "employee-day", 13, ink2))
        L.append(self.text(576, 574, "员工,日期,上班,下班,休息分钟,日工时,"
                           "加班小时,状态,问题", 12.5, ink2, mono=True))
        L.append(self.text(576, 598, "→ $DSH_HOME/dsh-attendance-check/exports/",
                           12, muted, mono=True))
        L.append(self.text(576, 618, "attendance-2026-06-22..26.csv · "
                           "sha256 2a0c…a29f", 12, muted, mono=True))

        # audit -> exits
        L.append(self.arrow(426, 460, 426, 486, over(muted, t, 0.85), sw=1.7,
                            head=5.2))
        L.append(self.arrow(912, 476, 912, 486, over(muted, t, 0.85), sw=1.7,
                            head=5.2))

        L.append("</svg>")
        return "\n".join(L) + "\n"


def flow_svg(theme_name: str) -> str:
    return Flow(theme_name).build()


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------
LEGACY = ("dsh-attendance-check-flow-light.svg",
          "dsh-attendance-check-flow-dark.svg")


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    written = []
    for lang in ("zh", "en"):
        for theme in ("light", "dark"):
            name = f"dsh-attendance-check-hero-{lang}-{theme}.webp"
            hero(lang, theme).save(os.path.join(OUT, name))
            written.append(name)
    for theme in ("light", "dark"):
        name = f"dsh-attendance-check-flow-v5-{theme}.svg"
        with open(os.path.join(OUT, name), "w", encoding="utf-8",
                  newline="\n") as fh:
            fh.write(flow_svg(theme))
        written.append(name)
    for legacy in LEGACY:
        path = os.path.join(OUT, legacy)
        if os.path.exists(path):
            os.remove(path)
            print(f"removed legacy {legacy}")
    print("wrote " + ", ".join(written))


if __name__ == "__main__":
    main()
