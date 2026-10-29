# Phase 8 — palette tokens + a single plotly template built from them.
#
# Every figure in app.py applies TEMPLATE_NAME so a color/spacing change
# happens in exactly one place. Values are the validated dark palette from
# the Phase 8 design brief — do not freehand new colors elsewhere in this
# app; add a token here instead.
from __future__ import annotations

import plotly.graph_objects as go
import plotly.io as pio

# ─── Surfaces / ink ──────────────────────────────────────────────────────
BG_PAGE = "#0d0d0d"
BG_SURFACE = "#1a1a19"
INK_PRIMARY = "#ffffff"
INK_SECONDARY = "#c3c2b7"
INK_MUTED = "#898781"
GRID = "#2c2c2a"          # hairline gridlines
AXIS_LINE = "#383835"     # baseline / axis line
BORDER = "rgba(255,255,255,0.10)"  # hairline border

# ─── Series ───────────────────────────────────────────────────────────────
# Series slot 1: the single hue used across every single-hue chart (weekly
# volume facets, muscle balance, progression's "top set" line).
HUE_MAIN = "#3987e5"
# Series slot 2: reserved for the progression chart's est-1RM line only.
HUE_1RM = "#199e70"
# Status warning — neglected-group flag only. Never used as a series color.
STATUS_WARNING = "#fab219"
# "Unregistered" bar — visually de-emphasized (muted gray), not a status color.
MUTED_BAR = "#5a5a56"

FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", sans-serif'

TEMPLATE_NAME = "hercules_dark"


def _build_template() -> go.layout.Template:
    template = go.layout.Template()
    template.layout = go.Layout(
        paper_bgcolor=BG_SURFACE,
        plot_bgcolor=BG_SURFACE,
        font=dict(family=FONT_FAMILY, color=INK_SECONDARY, size=13),
        title=dict(font=dict(family=FONT_FAMILY, color=INK_PRIMARY, size=16)),
        colorway=[HUE_MAIN, HUE_1RM],
        xaxis=dict(
            gridcolor=GRID,
            zerolinecolor=AXIS_LINE,
            linecolor=AXIS_LINE,
            tickfont=dict(color=INK_MUTED),
            title=dict(font=dict(color=INK_MUTED)),
        ),
        yaxis=dict(
            gridcolor=GRID,
            zerolinecolor=AXIS_LINE,
            linecolor=AXIS_LINE,
            tickfont=dict(color=INK_MUTED),
            title=dict(font=dict(color=INK_MUTED)),
        ),
        legend=dict(font=dict(color=INK_SECONDARY), bgcolor="rgba(0,0,0,0)"),
        margin=dict(l=48, r=24, t=48, b=40),
    )
    return template


# Registering into plotly's global template registry (and setting it as the
# default) means every px.* / go.Figure call in app.py picks it up without
# having to thread `template=` through each call site.
TEMPLATE = _build_template()
pio.templates[TEMPLATE_NAME] = TEMPLATE
pio.templates.default = TEMPLATE_NAME


def empty_figure(message: str) -> go.Figure:
    """A themed placeholder for charts with nothing to draw yet.

    Used instead of handing plotly express an empty frame, which for
    faceted/grouped charts can raise or render a blank axis with no
    indication of why.
    """
    fig = go.Figure()
    fig.update_layout(
        template=TEMPLATE_NAME,
        xaxis=dict(visible=False),
        yaxis=dict(visible=False),
        annotations=[
            dict(
                text=message,
                showarrow=False,
                font=dict(color=INK_MUTED, size=14),
                xref="paper",
                yref="paper",
                x=0.5,
                y=0.5,
            )
        ],
    )
    return fig
