# Phase 8 — Dash layout + callbacks. `python app.py` serves the dashboard.
#
# All Firestore access goes through data.load_all(); the Refresh button (and
# Dash's initial-render firing of the same callback) call it fresh every
# time — there is no module-level DataFrame cache to go stale against. The
# loaded frames are round-tripped through a dcc.Store as JSON so every other
# callback stays a pure function of (store data, filter inputs).
from __future__ import annotations

import base64
from datetime import date, timedelta

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from dash import Dash, Input, Output, State, dash_table, dcc, html

import bodymap
import data
import medallions
import metrics
import progress
import rank_engine
import rank_ladder
import theme

app = Dash(__name__)
app.title = "Hercules — Stats"

DATE_PRESETS = [
    {"label": "All time", "value": "all"},
    {"label": "Last 30 days", "value": "30d"},
    {"label": "Last 90 days", "value": "90d"},
]

# Sentinel group-select value meaning "don't filter by group" — distinct from
# None, which is also treated as "all" (see populate_exercise_select) to
# cover the chained-callback instant where group-select hasn't resolved yet.
ALL_GROUPS = "__all__"

CARD_STYLE = {
    "backgroundColor": theme.BG_SURFACE,
    "border": f"1px solid {theme.BORDER}",
    "borderRadius": "10px",
    "padding": "16px",
}


def kpi_tile(tile_id: str, label: str, emphasize: bool = False) -> html.Div:
    return html.Div(
        [
            html.Div(id=tile_id, className="kpi-value", style={
                "fontSize": "44px" if emphasize else "32px",
                "fontWeight": 700 if emphasize else 600,
                "color": theme.INK_PRIMARY,
            }),
            html.Div(label, style={
                "fontSize": "13px", "color": theme.INK_MUTED, "marginTop": "4px",
            }),
        ],
        style={**CARD_STYLE, "flex": "1", "minWidth": "160px"},
    )


def preset_bounds(preset: str):
    """(date_from, date_to) inclusive strings for a preset, or (None, None)
    for 'all time'. Anchored on real today — this is a live personal log."""
    today = date.today()
    if preset == "30d":
        return (today - timedelta(days=30)).isoformat(), today.isoformat()
    if preset == "90d":
        return (today - timedelta(days=90)).isoformat(), today.isoformat()
    return None, None


def filter_by_date(sets_df: pd.DataFrame, date_from, date_to) -> pd.DataFrame:
    if sets_df.empty:
        return sets_df
    out = sets_df
    if date_from:
        out = out[out["date"] >= date_from]
    if date_to:
        out = out[out["date"] <= date_to]
    return out


app.layout = html.Div(
    style={
        "backgroundColor": theme.BG_PAGE,
        "minHeight": "100vh",
        "fontFamily": theme.FONT_FAMILY,
        "color": theme.INK_SECONDARY,
        "padding": "24px 32px 48px",
    },
    children=[
        dcc.Store(id="data-store"),

        html.H1("Project Hercules — Stats", style={
            "color": theme.INK_PRIMARY, "fontSize": "22px", "fontWeight": 600,
            "marginBottom": "4px",
        }),
        html.Div(id="load-error", style={"color": theme.STATUS_WARNING, "marginBottom": "12px", "fontSize": "13px"}),

        # ─── Filter row ────────────────────────────────────────────────
        html.Div(
            style={"display": "flex", "gap": "12px", "alignItems": "center", "marginBottom": "20px", "flexWrap": "wrap"},
            children=[
                dcc.Dropdown(
                    id="date-preset", options=DATE_PRESETS, value="all", clearable=False,
                    style={"width": "180px", "color": "#111"},
                ),
                html.Div(
                    id="uid-select-wrap",
                    style={"display": "none"},
                    children=dcc.Dropdown(id="uid-select", clearable=False, style={"width": "220px", "color": "#111"}),
                ),
                dcc.Dropdown(id="group-select", clearable=False, style={"width": "200px", "color": "#111"}),
                dcc.Dropdown(id="exercise-select", clearable=False, style={"width": "280px", "color": "#111"}),
                html.Button("Refresh", id="refresh-btn", n_clicks=0, style={
                    "backgroundColor": theme.HUE_MAIN, "color": theme.INK_PRIMARY, "border": "none",
                    "borderRadius": "6px", "padding": "8px 16px", "cursor": "pointer", "fontFamily": theme.FONT_FAMILY,
                }),
            ],
        ),

        # ─── KPI tiles ─────────────────────────────────────────────────
        html.Div(
            style={"display": "flex", "gap": "16px", "marginBottom": "24px", "flexWrap": "wrap"},
            children=[
                kpi_tile("kpi-sets", "Sets this week"),
                kpi_tile("kpi-volume", "Volume this week"),
                kpi_tile("kpi-sessions", "Sessions this week"),
                kpi_tile("kpi-last-session", "Last session"),
                kpi_tile("kpi-cardio-min", "Cardio min (this week)"),
                kpi_tile("kpi-level", "Level", emphasize=True),
                kpi_tile("kpi-xp", "XP"),
                kpi_tile("kpi-streak", "Streak"),
            ],
        ),

        # ─── Rank (Python rank engine + medallion renderer) ────────────
        html.Div(
            [
                html.H3("Rank", style={"color": theme.INK_PRIMARY, "fontSize": "16px", "marginTop": 0}),
                html.Div(id="rank-panel"),
            ],
            style={**CARD_STYLE, "marginBottom": "24px"},
        ),

        # ─── Weekly volume per muscle group ───────────────────────────
        html.Div(dcc.Graph(id="fig-weekly-volume"), style={**CARD_STYLE, "marginBottom": "24px"}),

        # ─── Exercise progression + Muscle balance ────────────────────
        html.Div(
            style={"display": "flex", "gap": "24px", "marginBottom": "24px", "flexWrap": "wrap"},
            children=[
                html.Div(dcc.Graph(id="fig-progression"), style={**CARD_STYLE, "flex": "1", "minWidth": "420px"}),
                html.Div(dcc.Graph(id="fig-balance"), style={**CARD_STYLE, "flex": "1", "minWidth": "420px"}),
            ],
        ),

        # ─── Movement patterns (Phase 14: push/pull-balance axis) ─────
        html.Div(dcc.Graph(id="pattern-chart"), style={**CARD_STYLE, "marginBottom": "24px"}),

        # ─── Progress engine (Phase 9 XP/leveling) ────────────────────
        html.Div(
            [
                html.H3("Muscle-group levels", style={"color": theme.INK_PRIMARY, "fontSize": "16px", "marginTop": 0}),
                html.Div(
                    id="progress-components",
                    style={"display": "flex", "gap": "24px", "marginBottom": "16px", "flexWrap": "wrap"},
                ),
                html.Div(
                    id="progress-group-levels",
                    style={"display": "flex", "gap": "8px", "flexWrap": "wrap"},
                ),
            ],
            style={**CARD_STYLE, "marginBottom": "24px"},
        ),

        # ─── Body map (Phase 12 parity: same perGroup, same palette) ─────
        html.Div(
            [
                html.H3("Body map", style={"color": theme.INK_PRIMARY, "fontSize": "16px", "marginTop": 0}),
                html.Div(
                    html.Img(id="body-map-img", style={"maxWidth": "100%", "height": "auto"}),
                    style={"display": "flex", "justifyContent": "center"},
                ),
            ],
            style={**CARD_STYLE, "marginBottom": "24px"},
        ),

        # ─── PR table ──────────────────────────────────────────────────
        html.Div(
            [
                html.H3("Personal records", style={"color": theme.INK_PRIMARY, "fontSize": "16px", "marginTop": 0}),
                dash_table.DataTable(
                    id="pr-table",
                    columns=[
                        {"name": "Group", "id": "group"},
                        {"name": "Exercise", "id": "exercise"},
                        {"name": "Max weight", "id": "max_weight"},
                        {"name": "Date", "id": "max_weight_date"},
                        {"name": "Reps @ max", "id": "max_weight_reps"},
                        {"name": "Best est. 1RM", "id": "best_est_1rm"},
                        {"name": "Date", "id": "best_est_1rm_date"},
                    ],
                    style_table={"overflowX": "auto"},
                    style_header={
                        "backgroundColor": theme.BG_SURFACE, "color": theme.INK_PRIMARY,
                        "fontWeight": 600, "border": f"1px solid {theme.BORDER}",
                    },
                    style_cell={
                        "backgroundColor": theme.BG_SURFACE, "color": theme.INK_SECONDARY,
                        "border": f"1px solid {theme.BORDER}", "fontFamily": theme.FONT_FAMILY,
                        "padding": "8px 12px", "textAlign": "left",
                    },
                    style_cell_conditional=[
                        {"if": {"column_id": c}, "textAlign": "right", "fontVariantNumeric": "tabular-nums"}
                        for c in ("max_weight", "max_weight_reps", "best_est_1rm")
                    ],
                    style_data_conditional=[
                        {"if": {"row_index": "odd"}, "backgroundColor": "#161615"},
                    ],
                ),
            ],
            style=CARD_STYLE,
        ),
    ],
)


# ─── Data loading ──────────────────────────────────────────────────────────

# No prevent_initial_call: Dash fires this once on initial render, which IS
# the first load — adding a separate init trigger would double the read.
@app.callback(
    Output("data-store", "data"),
    Output("load-error", "children"),
    Input("refresh-btn", "n_clicks"),
)
def load_data_cb(_n_clicks):
    try:
        sets_df, exercises_df, groups_df, vetoes = data.load_all()
    except FileNotFoundError as exc:
        return None, str(exc)
    return data.store_payload(sets_df, exercises_df, groups_df, vetoes), ""


# ─── uid selector (only shown if the data actually has >1 uid) ───────────

@app.callback(
    Output("uid-select-wrap", "style"),
    Output("uid-select", "options"),
    Output("uid-select", "value"),
    Input("data-store", "data"),
)
def populate_uid_select(store):
    sets_df, _, _, _ = data.frames_from_store(store)
    if sets_df.empty:
        return {"display": "none"}, [], None
    counts = sets_df["uid"].value_counts()
    uids = list(counts.index)
    if len(uids) <= 1:
        return {"display": "none"}, [{"label": u, "value": u} for u in uids], (uids[0] if uids else None)
    options = [{"label": f"{u} ({counts[u]} sets)", "value": u} for u in uids]
    return {"display": "block"}, options, counts.idxmax()


# ─── muscle-group dropdown (feeds the exercise dropdown below) ───────────
# Buckets each LOGGED exercise under its registry primary group — same
# resolution the PR table uses (metrics.primary_group_lookup), so an
# exercise the registry doesn't know about still gets a (muted) home under
# UNREGISTERED_GROUP rather than vanishing from the filter entirely.

@app.callback(
    Output("group-select", "options"),
    Output("group-select", "value"),
    Input("data-store", "data"),
    Input("uid-select", "value"),
)
def populate_group_select(store, uid):
    sets_df, exercises_df, groups_df, _ = data.frames_from_store(store)
    if uid and not sets_df.empty:
        sets_df = sets_df[sets_df["uid"] == uid]
    if uid and not exercises_df.empty:
        exercises_df = exercises_df[exercises_df["uid"] == uid]
    if uid and not groups_df.empty:
        groups_df = groups_df[groups_df["uid"] == uid]
    if sets_df.empty:
        return [], None

    lookup = metrics.primary_group_lookup(exercises_df)
    counts = sets_df["exercise"].value_counts()
    logged_groups = {lookup.get(str(e).lower(), metrics.UNREGISTERED_GROUP) for e in counts.index}

    # Order by the registry's own "order" column; anything not in the
    # registry (i.e. only UNREGISTERED_GROUP can reach here) sorts last.
    registry_order = {name: i for i, name in enumerate(groups_df.sort_values("order")["name"])} \
        if not groups_df.empty else {}

    def sort_key(g):
        if g == metrics.UNREGISTERED_GROUP:
            return (2, g)
        if g in registry_order:
            return (0, registry_order[g])
        return (1, g)  # fall back to alpha for a group missing from the registry order

    ordered_groups = sorted(logged_groups, key=sort_key)
    options = [{"label": "All groups", "value": ALL_GROUPS}] + [{"label": g, "value": g} for g in ordered_groups]

    # Default: the primary group of the most-logged exercise, so the initial
    # view is unchanged from before this filter existed.
    default_group = lookup.get(str(counts.idxmax()).lower(), metrics.UNREGISTERED_GROUP)
    return options, default_group


# ─── exercise dropdown (depends on which uid AND group is selected) ──────

@app.callback(
    Output("exercise-select", "options"),
    Output("exercise-select", "value"),
    Input("data-store", "data"),
    Input("uid-select", "value"),
    Input("group-select", "value"),
)
def populate_exercise_select(store, uid, group):
    sets_df, exercises_df, _, _ = data.frames_from_store(store)
    if uid and not sets_df.empty:
        sets_df = sets_df[sets_df["uid"] == uid]
    if uid and not exercises_df.empty:
        exercises_df = exercises_df[exercises_df["uid"] == uid]
    if sets_df.empty:
        return [], None

    # None (chained-callback initial render, before group-select has
    # resolved) and ALL_GROUPS both mean "no group filter" — current
    # (pre-feature) behavior.
    if group and group != ALL_GROUPS:
        lookup = metrics.primary_group_lookup(exercises_df)
        in_group = sets_df["exercise"].apply(lambda e: lookup.get(str(e).lower(), metrics.UNREGISTERED_GROUP) == group)
        sets_df = sets_df[in_group]
    if sets_df.empty:
        return [], None

    counts = sets_df["exercise"].value_counts()
    options = [{"label": e, "value": e} for e in sorted(counts.index)]
    return options, counts.idxmax()  # default: most-logged exercise (within the group, if set)


# ─── main visuals ──────────────────────────────────────────────────────────

@app.callback(
    Output("kpi-sets", "children"),
    Output("kpi-volume", "children"),
    Output("kpi-sessions", "children"),
    Output("kpi-last-session", "children"),
    Output("kpi-cardio-min", "children"),
    Output("kpi-level", "children"),
    Output("kpi-xp", "children"),
    Output("kpi-streak", "children"),
    Output("fig-weekly-volume", "figure"),
    Output("fig-progression", "figure"),
    Output("fig-balance", "figure"),
    Output("pr-table", "data"),
    Output("progress-components", "children"),
    Output("progress-group-levels", "children"),
    Output("body-map-img", "src"),
    Output("pattern-chart", "figure"),
    Output("rank-panel", "children"),
    Input("data-store", "data"),
    Input("uid-select", "value"),
    Input("date-preset", "value"),
    Input("exercise-select", "value"),
)
def update_visuals(store, uid, preset, exercise):
    sets_df, exercises_df, groups_df, vetoes = data.frames_from_store(store)

    if uid and not sets_df.empty:
        sets_df = sets_df[sets_df["uid"] == uid].reset_index(drop=True)
    if uid and not exercises_df.empty:
        exercises_df = exercises_df[exercises_df["uid"] == uid].reset_index(drop=True)
    if uid and not groups_df.empty:
        groups_df = groups_df[groups_df["uid"] == uid].reset_index(drop=True)

    # KPI tiles are always "this real week" — unaffected by the date preset,
    # which windows the charts below instead (see brief: KPI defs are
    # hardcoded to "this week", PRs are "ever").
    kpi = metrics.kpi_summary(sets_df)
    kpi_sets = str(kpi["sets_this_week"])
    kpi_volume = f"{kpi['volume_this_week']:,.0f}"
    kpi_sessions = str(kpi["sessions_this_week"])
    kpi_last = kpi["last_session_date"] or "—"
    kpi_cardio_min = f"{kpi['cardio_minutes_this_week']:,.0f}"

    # Progress (Phase 9 XP/leveling engine) — like the KPI tiles above, this
    # reads the FULL uid-filtered log, not the date-preset-windowed frame:
    # the engine has its own internal trailing windows (§2-§6) and should be
    # independent of the chart date preset.
    prog = progress.compute_progress(sets_df, exercises_df, groups_df, vetoes, None, date.today().isoformat())
    kpi_level = str(prog["level"])
    kpi_xp = f"{prog['xp']:,}"
    kpi_streak = f"{prog['streak']} wk"
    progress_components = build_component_bars(prog["components"])
    progress_group_levels = build_group_level_chips(prog["perGroup"])
    body_map_src = build_body_map_src(prog["perGroup"])

    # Rank (Python rank engine + medallion renderer) — same uid-filtered,
    # full (not date-preset-windowed) log as the XP/level engine above, and
    # the same "as-of today" anchor; vetoes come from the Firestore `vetoes`
    # collection (loaded by data.load_vetoes, carried through the Store),
    # the same excused rest days the phone's veto control writes.
    rank_rows = sets_df[["date", "session", "kind"]].to_dict("records") if not sets_df.empty else []
    rank_asof = rank_engine.epoch_day_of(date.today().isoformat())
    rank_result = rank_engine.evaluate_rank(rank_rows, vetoes, rank_asof)
    rank_panel = build_rank_panel(rank_result)

    date_from, date_to = preset_bounds(preset or "all")
    windowed_sets = filter_by_date(sets_df, date_from, date_to)

    fig_weekly = build_weekly_volume_figure(windowed_sets, exercises_df, groups_df)
    fig_progression = build_progression_figure(windowed_sets, exercise)
    fig_balance = build_balance_figure(sets_df, exercises_df, groups_df, date_from, date_to)
    fig_pattern = build_pattern_figure(windowed_sets, exercises_df)
    pr_records = build_pr_table(sets_df, exercises_df)

    return (
        kpi_sets, kpi_volume, kpi_sessions, kpi_last, kpi_cardio_min, kpi_level, kpi_xp, kpi_streak,
        fig_weekly, fig_progression, fig_balance, pr_records,
        progress_components, progress_group_levels, body_map_src, fig_pattern,
        rank_panel,
    )


def build_weekly_volume_figure(sets_df, exercises_df, groups_df):
    if sets_df.empty or groups_df.empty:
        return theme.empty_figure("No data yet")

    vol = metrics.volume_by_group_week(sets_df, exercises_df)
    weeks = sorted(metrics.iso_week(sets_df["date"]).unique())
    group_order = list(groups_df.sort_values("order")["name"]) + [
        metrics.UNTAGGED_GROUP, metrics.UNREGISTERED_GROUP]
    present_groups = set(vol["group"]) if not vol.empty else set()
    group_order = [g for g in group_order if g in present_groups or g in set(groups_df["name"])]

    # Cross-join weeks x groups so cold groups still get an (empty) facet —
    # a zero-volume week is meaningful, not something to hide.
    grid = pd.MultiIndex.from_product([weeks, group_order], names=["iso_week", "group"]).to_frame(index=False)
    merged = grid.merge(vol, on=["iso_week", "group"], how="left")
    merged["volume"] = merged["volume"].fillna(0.0)
    merged["group"] = pd.Categorical(merged["group"], categories=group_order, ordered=True)
    merged = merged.sort_values(["group", "iso_week"])

    fig = px.bar(
        merged, x="iso_week", y="volume", facet_col="group", facet_col_wrap=4,
        category_orders={"group": group_order},
        color_discrete_sequence=[theme.HUE_MAIN],
        labels={"iso_week": "", "volume": "Volume"},
        title="Weekly volume per muscle group",
    )
    fig.update_traces(marker_line_width=0, width=0.6)
    fig.update_yaxes(matches="y")  # shared y-axis across facets
    fig.update_xaxes(showgrid=False)
    fig.for_each_annotation(lambda a: a.update(text=a.text.split("=")[-1], font=dict(color=theme.INK_SECONDARY)))
    fig.update_layout(showlegend=False, height=280 + 180 * (len(group_order) // 4))
    return fig


def build_progression_figure(sets_df, exercise):
    if sets_df.empty or not exercise:
        return theme.empty_figure("No data for this exercise/window")

    top = metrics.top_sets(sets_df, exercise=exercise)
    if top.empty:
        return theme.empty_figure("No data for this exercise/window")

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=top["date"], y=top["weight"], mode="lines+markers", name="Top set (weight)",
        line=dict(color=theme.HUE_MAIN, width=2), marker=dict(size=9, color=theme.HUE_MAIN),
    ))
    fig.add_trace(go.Scatter(
        x=top["date"], y=top["est_1rm"], mode="lines+markers", name="Est. 1RM (Epley)",
        line=dict(color=theme.HUE_1RM, width=2), marker=dict(size=9, color=theme.HUE_1RM),
    ))

    # Direct end-labels in ink color (never the series color) plus the legend.
    last = top.iloc[-1]
    for y, label in ((last["weight"], "Top set"), (last["est_1rm"], "Est. 1RM")):
        fig.add_annotation(
            x=last["date"], y=y, text=f"  {label}", showarrow=False, xanchor="left",
            font=dict(color=theme.INK_PRIMARY, size=12),
        )

    fig.update_layout(
        title=f"Progression — {exercise}",
        yaxis_title="Weight",
        legend=dict(orientation="h", y=1.12, x=0),
        margin=dict(r=90),
    )
    return fig


def build_balance_figure(sets_df, exercises_df, groups_df, date_from, date_to):
    if groups_df.empty:
        return theme.empty_figure("No registry groups yet")

    sc = metrics.set_credit_by_group(sets_df, exercises_df, date_from=date_from, date_to=date_to)
    all_names = list(groups_df["name"])
    present = set(sc["group"]) if not sc.empty else set()
    # Both synthetic buckets render muted when present: Untagged (registered
    # but muscles empty) and Unregistered (not in the registry at all).
    for synthetic in (metrics.UNTAGGED_GROUP, metrics.UNREGISTERED_GROUP):
        if synthetic in present:
            all_names = all_names + [synthetic]

    full = pd.DataFrame({"group": all_names}).merge(sc, on="group", how="left")
    full["set_credit"] = full["set_credit"].fillna(0.0)
    full = full.sort_values("set_credit", ascending=True)  # ascending so the bar chart reads top-to-bottom descending

    neglected = set(metrics.neglected_groups(sets_df, exercises_df, groups_df))
    colors, labels = [], []
    for g in full["group"]:
        if g in (metrics.UNREGISTERED_GROUP, metrics.UNTAGGED_GROUP):
            colors.append(theme.MUTED_BAR)
            labels.append(g)
        elif g in neglected:
            colors.append(theme.STATUS_WARNING)
            labels.append(f"⚠ {g}")
        else:
            colors.append(theme.HUE_MAIN)
            labels.append(g)

    fig = go.Figure(go.Bar(
        x=full["set_credit"], y=labels, orientation="h",
        marker=dict(color=colors), width=0.6,
    ))
    fig.update_layout(
        title="Muscle-group balance (set-credits)",
        xaxis_title="Set-credits", yaxis=dict(showgrid=False),
        xaxis=dict(showgrid=True),
    )
    return fig


def build_pattern_figure(sets_df, exercises_df):
    """Movement-pattern breakdown (Phase 14): raw strength volume per pattern
    (Push/Pull/Squat/Hinge/Carry/Core/Isolation) — the push/pull-balance
    axis. Cardio rows are excluded by metrics.pattern_breakdown itself
    (duration-logged, no weight×reps volume); sets whose exercise carries no
    pattern render as a muted "Untagged" bar, matching the balance chart's
    treatment of its synthetic buckets."""
    pb = metrics.pattern_breakdown(sets_df, exercises_df)
    if pb.empty:
        return theme.empty_figure("No data yet")

    pb = pb.sort_values("volume", ascending=True)  # ascending so the bar chart reads top-to-bottom descending
    colors = [
        theme.MUTED_BAR if p == metrics.UNTAGGED_GROUP else theme.HUE_MAIN
        for p in pb["pattern"]
    ]

    fig = go.Figure(go.Bar(
        x=pb["volume"], y=pb["pattern"], orientation="h",
        marker=dict(color=colors), width=0.6,
        customdata=pb["sets"],
        hovertemplate="%{y}: %{x:,.0f} volume · %{customdata} sets<extra></extra>",
    ))
    fig.update_layout(
        title="Movement patterns (strength volume)",
        xaxis_title="Volume", yaxis=dict(showgrid=False),
        xaxis=dict(showgrid=True),
    )
    return fig


def build_component_bars(components: dict):
    """Compact labeled 0-100% bars for the three Phase-9 axes (consistency /
    progression / volume), so the headline level is explainable at a glance."""
    labels = [
        ("consistency", "Consistency"),
        ("progression", "Progression"),
        ("volume", "Volume"),
    ]
    bars = []
    for key, label in labels:
        pct = max(0.0, min(1.0, components.get(key, 0.0) or 0.0)) * 100
        bars.append(html.Div(
            style={"minWidth": "160px", "flex": "1"},
            children=[
                html.Div(
                    style={
                        "display": "flex", "justifyContent": "space-between",
                        "fontSize": "12px", "color": theme.INK_MUTED, "marginBottom": "4px",
                    },
                    children=[html.Span(label), html.Span(f"{pct:.0f}%")],
                ),
                html.Div(
                    style={
                        "height": "6px", "borderRadius": "3px",
                        "backgroundColor": theme.GRID, "overflow": "hidden",
                    },
                    children=html.Div(style={
                        "height": "100%", "width": f"{pct:.0f}%",
                        "backgroundColor": theme.HUE_MAIN, "borderRadius": "3px",
                    }),
                ),
            ],
        ))
    return bars


def build_group_level_chips(per_group: dict):
    """One chip per TRAINED muscle group (level > 0), sorted by level desc
    then xp desc. Untrained groups (level 0) are skipped per spec — a gentle
    placeholder shows instead when nothing has been trained yet."""
    trained = [(g, v.get("level", 0), v.get("xp", 0)) for g, v in per_group.items() if v.get("level", 0) > 0]
    if not trained:
        return [html.Div("Log sessions to start leveling", style={
            "color": theme.INK_MUTED, "fontSize": "13px",
        })]
    trained.sort(key=lambda t: (-t[1], -t[2]))
    return [
        html.Div(
            f"{g} · Lv {level}",
            style={
                "backgroundColor": theme.BG_PAGE, "border": f"1px solid {theme.BORDER}",
                "borderRadius": "999px", "padding": "6px 14px", "fontSize": "13px",
                "color": theme.INK_SECONDARY,
            },
        )
        for g, level, xp in trained
    ]


def _rank_next_label(rank: dict) -> str:
    """Human label for the next division/tier up from `rank` (a RankView
    dict from rank_engine.get_rank/evaluate_rank). Never called when
    rank["isApex"] is True (there is no "next" past Kratos). Derives
    `within` (0=III,1=II,2=I) back out of the public `division` field
    (division = 3 - within, per rank_engine.get_rank) rather than
    duplicating rank_engine's own division math."""
    within = 3 - rank["division"]
    tier_index = rank["tierIndex"]
    if within < 2:
        return f'{rank["tierName"]} {rank_engine.DIVISION_LABELS[within + 1]}'
    next_tier = rank_ladder.TIERS[tier_index + 1]
    return next_tier["name"] if next_tier["apex"] else f'{next_tier["name"]} III'


def build_rank_panel(rank_result: dict):
    """Card body for the Rank panel: medallion + tier/division + an XP
    progress bar toward the next division + the run's peak division. Reads
    only the public rank_engine/rank_ladder/medallions API — no rank/XP
    logic lives here, just presentation over `evaluate_rank`'s output."""
    rank = rank_result["rank"]
    peak_rank_id = rank_result["peakRankId"]

    title = (
        f'{rank["tierName"]} {rank["divisionLabel"]}' if rank["divisionLabel"]
        else f'{rank["tierName"]} — Apex'
    )

    if rank["isApex"]:
        pct = 100.0
        caption = "Past Kratos — as far as the ladder goes."
    else:
        pct = max(0.0, min(1.0, rank["xpIntoDivision"] / rank["xpForDivision"])) * 100
        caption = f'{rank["xpIntoDivision"]} / {rank["xpForDivision"]} to {_rank_next_label(rank)}'

    # Peak label: replay get_rank on a synthetic state sitting exactly at the
    # floor of the peak division (evaluate_rank only reports peakRankId, an
    # int, not a full RankView) — reuses the real engine's tier/division
    # math instead of re-deriving it here.
    peak_state = rank_engine.RankState(xp=peak_rank_id * rank_ladder.XP_PER_DIVISION, slipOffset=0)
    peak_rank = rank_engine.get_rank(peak_state)
    peak_label = (
        f'{peak_rank["tierName"]} {peak_rank["divisionLabel"]}' if peak_rank["divisionLabel"]
        else f'{peak_rank["tierName"]} — Apex'
    )

    return html.Div(
        style={"display": "flex", "gap": "16px", "alignItems": "center"},
        children=[
            html.Img(
                src=medallions.medallion_data_uri(rank["tierIndex"]),
                style={"width": "88px", "height": "88px", "flexShrink": "0"},
            ),
            html.Div(
                style={"flex": "1", "minWidth": "160px"},
                children=[
                    html.Div(title, style={"fontSize": "18px", "fontWeight": 700, "color": theme.INK_PRIMARY}),
                    html.Div(
                        style={
                            "height": "6px", "borderRadius": "3px",
                            "backgroundColor": theme.GRID, "overflow": "hidden", "margin": "8px 0 4px",
                        },
                        children=html.Div(style={
                            "height": "100%", "width": f"{pct:.0f}%",
                            "backgroundColor": theme.HUE_MAIN, "borderRadius": "3px",
                        }),
                    ),
                    html.Div(caption, style={"fontSize": "12px", "color": theme.INK_MUTED}),
                    html.Div(
                        f"Peak: {peak_label}",
                        style={"fontSize": "12px", "color": theme.INK_MUTED, "marginTop": "6px"},
                    ),
                ],
            ),
        ],
    )


def build_body_map_src(per_group: dict) -> str:
    """perGroup -> a data: URI Dash's html.Img can render directly. Plotly
    figures serialize to JSON over the wire, but an inline SVG has no Dash
    Output type of its own — base64-encoding it into an <img> src is the
    standard way to hand a raw SVG string to the browser via a callback."""
    svg = bodymap.build_body_svg(per_group)
    encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"


def build_pr_table(sets_df, exercises_df):
    pr = metrics.pr_table(sets_df, exercises_df)
    if pr.empty:
        return []
    pr = pr.copy()
    pr["max_weight"] = pr["max_weight"].round(1)
    pr["best_est_1rm"] = pr["best_est_1rm"].round(1)
    return pr.to_dict("records")


if __name__ == "__main__":
    app.run(debug=True)
