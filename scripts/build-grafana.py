# Generates the two Grafana dashboards (deploy/grafana/dashboards/*.json) from Tiger Data:
#   nos-night  one night, live: state, signals, TimescaleDB analysis, the Switch, events
#   nos-week   a week of nights: totals, the ladder each night, loudness by hour, every night
# Run: python3 scripts/build-grafana.py
import json, os

DS = {"type": "grafana-postgresql-datasource", "uid": "tiger"}
OUT = os.path.join(os.path.dirname(__file__), "..", "deploy", "grafana", "dashboards")

# tenshi palette, so the dashboards look like the app
TEAL, MINT, AMBER, RED, GOLD, MIST, BLUE = "#5FD0D8", "#5FB3BB", "#F0B04A", "#FF4F4A", "#D1B896", "#A3ABBA", "#8FA6D6"

LEVELS = [  # value, label, colour
    ("ARMED", "Out tonight", TEAL), ("NUDGE", "Check-in", AMBER), ("ALARM", "Alarm", RED),
    ("CONTACT", "Contact alerted", RED), ("WIDER", "Backup alerted", RED), ("RESOLVED", "Home", MINT),
]
LEVEL_MAP = [{"type": "value", "options": {v: {"text": t, "color": c, "index": i} for i, (v, t, c) in enumerate(LEVELS)}}]


def q(sql, fmt="time_series", ref="A"):
    return {"refId": ref, "datasource": DS, "rawQuery": True, "editorMode": "code", "format": fmt, "rawSql": " ".join(sql.split())}


class Grid:
    """Lays panels out left to right in rows of 24 columns."""
    def __init__(self):
        self.y, self.x, self.h, self.id, self.panels = 0, 0, 0, 1, []

    def add(self, panel, w, h):
        if self.x + w > 24:
            self.y += self.h; self.x, self.h = 0, 0
        panel["id"] = self.id; self.id += 1
        panel["gridPos"] = {"x": self.x, "y": self.y, "w": w, "h": h}
        self.x += w; self.h = max(self.h, h)
        self.panels.append(panel)

    def row(self, title):
        if self.x: self.y += self.h; self.x, self.h = 0, 0
        self.panels.append({"id": self.id, "type": "row", "title": title, "collapsed": False, "panels": [], "gridPos": {"x": 0, "y": self.y, "w": 24, "h": 1}})
        self.id += 1; self.y += 1


def header(markdown):
    return {"type": "text", "title": "", "transparent": True, "options": {"mode": "markdown", "content": markdown}}


def stat(title, sql, unit=None, color=TEAL, fmt="time_series", calc="lastNotNull", spark=True, decimals=None, desc="", thresholds=None, mappings=None, mode="value"):
    d = {"color": {"mode": "thresholds" if thresholds else "fixed", "fixedColor": color}, "mappings": mappings or []}
    if thresholds: d["thresholds"] = {"mode": "absolute", "steps": thresholds}
    if unit: d["unit"] = unit
    if decimals is not None: d["decimals"] = decimals
    return {"type": "stat", "title": title, "description": desc, "datasource": DS, "targets": [q(sql, fmt)],
            "fieldConfig": {"defaults": d, "overrides": []},
            "options": {"colorMode": mode, "graphMode": "area" if spark else "none", "justifyMode": "center", "textMode": "value",
                        "wideLayout": True, "showPercentChange": False, "reduceOptions": {"calcs": [calc], "fields": "", "values": False}}}


def gauge(title, sql, unit, steps, lo=0, hi=100, desc=""):
    return {"type": "gauge", "title": title, "description": desc, "datasource": DS, "targets": [q(sql)],
            "fieldConfig": {"defaults": {"unit": unit, "min": lo, "max": hi, "color": {"mode": "thresholds"},
                                         "thresholds": {"mode": "absolute", "steps": steps}}, "overrides": []},
            "options": {"showThresholdMarkers": True, "showThresholdLabels": False, "minVizHeight": 75, "minVizWidth": 75,
                        "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False}}}


def series(title, targets, unit=None, color=TEAL, desc="", draw="line", fill=22, thresholds=None, tstyle="off", lo=None, hi=None,
           legend=False, scheme=False, points="never", interp="smooth", overrides=None, span=False):
    d = {"custom": {"drawStyle": draw, "lineInterpolation": interp, "lineWidth": 2, "fillOpacity": fill,
                    "gradientMode": "scheme" if scheme else "opacity", "showPoints": points, "pointSize": 7,
                    "spanNulls": span, "axisBorderShow": False, "axisPlacement": "auto", "barAlignment": 0,
                    "thresholdsStyle": {"mode": tstyle}},
         "color": {"mode": "thresholds"} if scheme else {"mode": "fixed", "fixedColor": color}}
    if thresholds: d["thresholds"] = {"mode": "absolute", "steps": thresholds}
    if unit: d["unit"] = unit
    if lo is not None: d["min"] = lo
    if hi is not None: d["max"] = hi
    return {"type": "timeseries", "title": title, "description": desc, "datasource": DS, "targets": targets,
            "fieldConfig": {"defaults": d, "overrides": overrides or []},
            "options": {"legend": {"showLegend": legend, "displayMode": "list", "placement": "bottom"}, "tooltip": {"mode": "multi", "sort": "none"}}}


def timeline(title, sql, desc=""):
    return {"type": "state-timeline", "title": title, "description": desc, "datasource": DS, "targets": [q(sql)],
            "fieldConfig": {"defaults": {"color": {"mode": "thresholds"}, "mappings": LEVEL_MAP, "custom": {"fillOpacity": 85, "lineWidth": 0}}, "overrides": []},
            "options": {"showValue": "auto", "mergeValues": True, "rowHeight": 0.75, "alignValue": "center", "legend": {"showLegend": False}, "tooltip": {"mode": "single"}}}


def table(title, sql, overrides, desc="", sort=None):
    return {"type": "table", "title": title, "description": desc, "datasource": DS, "targets": [q(sql, "table")],
            "fieldConfig": {"defaults": {"custom": {"align": "auto", "cellOptions": {"type": "auto"}, "inspect": False}}, "overrides": overrides},
            "options": {"showHeader": True, "cellHeight": "md", "footer": {"show": False}, "sortBy": sort or []}}


def override(name, **props):
    return {"matcher": {"id": "byName", "options": name}, "properties": [{"id": k, "value": v} for k, v in props.items()]}


def dashboard(uid, title, panels, templating, time_from, refresh, links, desc):
    return {"uid": uid, "title": title, "description": desc, "tags": ["tenshi", "tiger-data"], "timezone": "browser", "schemaVersion": 39,
            "version": 4, "editable": False, "graphTooltip": 1, "refresh": refresh, "liveNow": False, "fiscalYearStartMonth": 0,
            "time": {"from": time_from, "to": "now"}, "timepicker": {"refresh_intervals": ["5s", "10s", "30s", "1m", "5m"]},
            "links": links, "templating": {"list": templating}, "panels": panels, "annotations": {"list": []}}


# ---------------------------------------------------------------- one night
S = "session_id = '$session'"
g = Grid()
g.add(header(
    '<div style="display:flex;align-items:center;gap:14px">'
    '<img src="/favicon.svg" width="64" style="display:block">'
    '<div><div style="font-size:24px;font-weight:600;letter-spacing:.02em">tenshi · tonight</div>'
    '<div style="opacity:.7;font-size:14px">Live from Tiger Data: every signal is a row in the <code>metrics</code> hypertable. '
    'Audio is never stored, only a score.</div></div></div>'), 24, 3)
g.add(stat("Right now", "SELECT level AS value FROM sessions WHERE id = '$session'", fmt="table", spark=False,
           mappings=LEVEL_MAP, mode="background", color=TEAL, desc="The escalation level the server is at for this night."), 5, 5)
g.add(stat("Out for", "SELECT EXTRACT(EPOCH FROM now() - armed_at) AS value FROM sessions WHERE id = '$session'", "s", GOLD, "table", spark=False), 4, 5)
g.add(stat("Check-ins answered", f"SELECT time, count(*) OVER (ORDER BY time) AS value FROM events WHERE {S} AND kind = 'checkin_ack' ORDER BY time", None, MINT,
           desc="Running count of check-ins answered, from the phone or the Switch."), 4, 5)
g.add(stat("Average reply", f"SELECT time, avg(value) OVER (ORDER BY time) AS value FROM metrics WHERE {S} AND metric = 'reply_s' ORDER BY time", "s", TEAL, decimals=1,
           desc="How fast check-ins get answered. Slower replies make the next check-in come sooner."), 4, 5)
g.add(gauge("Battery", f"SELECT time, value FROM metrics WHERE {S} AND metric = 'battery_pct' ORDER BY time", "percent",
            [{"color": RED, "value": None}, {"color": AMBER, "value": 20}, {"color": TEAL, "value": 40}]), 3, 5)
g.add(stat("Danger heard", f"SELECT count(*) AS value FROM metrics WHERE {S} AND metric = 'distress_score' AND value >= 0.5", None, fmt="table", spark=False,
           thresholds=[{"color": MINT, "value": None}, {"color": RED, "value": 1}], mode="background",
           desc="30-second clips where Whisper (on our own server) heard a plea for help or aggression."), 4, 5)
g.add(timeline("Escalation ladder", f"SELECT time, detail->>'to' AS \"level\" FROM events WHERE {S} AND kind = 'level_change' AND $__timeFilter(time) ORDER BY time",
               "Armed, check-in, alarm, contact, backup: each step's timer runs on the server."), 24, 4)

g.row("Phone signals")
g.add(series("Sound around her", [q(f"""SELECT time_bucket('5 seconds', time) AS time, avg(value) AS "average", max(value) AS "peak"
    FROM metrics WHERE {S} AND metric IN ('sound_db', 'sound_peak_db') AND $__timeFilter(time) GROUP BY 1 ORDER BY 1""")],
    "dB", TEAL, "Loudness only, never audio. The red band is where shouting starts.", thresholds=[{"color": "transparent", "value": None}, {"color": RED, "value": -15}],
    tstyle="dashed+area", legend=True, overrides=[override("peak", **{"color": {"mode": "fixed", "fixedColor": GOLD}, "custom.fillOpacity": 0, "custom.lineStyle": {"fill": "dash", "dash": [6, 4]}})]), 12, 8)
g.add(series("Movement", [q(f"""SELECT time_bucket('5 seconds', time) AS time, avg(value) AS "movement"
    FROM metrics WHERE {S} AND metric = 'movement' AND $__timeFilter(time) GROUP BY 1 ORDER BY 1""")], "accMS2", BLUE,
    "From the phone's motion sensor. Dancing spikes, a still phone flatlines."), 12, 8)

g.row("TimescaleDB analysis")
g.add(series("Sound anomaly (z-score)", [q(f"""SELECT time, (value - avg(value) OVER w) / NULLIF(stddev_samp(value) OVER w, 0) AS "z-score"
    FROM metrics WHERE {S} AND metric = 'sound_db' AND $__timeFilter(time)
    WINDOW w AS (ORDER BY time ROWS BETWEEN 30 PRECEDING AND CURRENT ROW) ORDER BY time""")], None, AMBER,
    "Each reading against its own rolling baseline. Above 2 is unusual for this night.", thresholds=[{"color": "transparent", "value": None}, {"color": RED, "value": 2}],
    tstyle="dashed+area"), 12, 8)
g.add(series("Per-minute rollup (continuous aggregate)", [q(f"""SELECT bucket AS time,
      max(avg) FILTER (WHERE metric = 'sound_db') AS "Sound (dB)", max(avg) FILTER (WHERE metric = 'movement') AS "Movement",
      max(avg) FILTER (WHERE metric = 'battery_pct') AS "Battery (%)"
    FROM metrics_1m WHERE {S} AND metric IN ('sound_db', 'movement', 'battery_pct') AND $__timeFilter(bucket) GROUP BY bucket ORDER BY 1""")], None, TEAL,
    "metrics_1m is a TimescaleDB continuous aggregate: minute averages kept fresh in the background.", legend=True, fill=0, interp="linear", points="always",
    overrides=[override("Movement", color={"mode": "fixed", "fixedColor": BLUE}), override("Battery (%)", color={"mode": "fixed", "fixedColor": GOLD})]), 12, 8)

g.row("Check-ins, the Switch and danger checks")
g.add(series("Reply time per check-in", [q(f"SELECT time, value AS \"reply\" FROM metrics WHERE {S} AND metric = 'reply_s' AND $__timeFilter(time) ORDER BY time")],
    "s", MINT, draw="bars", fill=80, interp="linear"), 8, 7)
g.add(series("Temperature from the Switch", [q(f"SELECT time, value AS \"temperature\" FROM metrics WHERE {S} AND metric = 'temp_c' AND $__timeFilter(time) ORDER BY time")],
    "celsius", TEAL, "Red below 5°C: likely outside in the cold.", thresholds=[{"color": RED, "value": None}, {"color": TEAL, "value": 5}],
    scheme=True, tstyle="dashed"), 8, 7)
g.add(series("Danger checks", [q(f"SELECT time, value AS \"score\" FROM metrics WHERE {S} AND metric = 'distress_score' AND $__timeFilter(time) ORDER BY time")],
    None, RED, "Each dot is a 30-second clip checked by Whisper. Above the line alerts the contact.", draw="points", points="always", lo=0, hi=1,
    thresholds=[{"color": MINT, "value": None}, {"color": RED, "value": 0.5}], scheme=True, tstyle="dashed"), 8, 7)
g.add(table("What happened tonight", f"""SELECT time AS "Time",
    CASE kind WHEN 'checkin_sent' THEN 'Check-in sent' WHEN 'checkin_ack' THEN 'Checked in' WHEN 'stand_down' THEN 'PIN cancelled the alarm'
      WHEN 'contact_ack' THEN 'Contact is on it' WHEN 'danger_alert' THEN 'Danger heard, contact alerted' WHEN 'distress_check' THEN 'Danger check'
      WHEN 'level_change' THEN 'Level: ' || initcap(detail->>'to') WHEN 'device' THEN 'Switch: ' || coalesce(detail->>'type', '') WHEN 'resolved' THEN 'Night ended' ELSE kind END AS "What"
    FROM events WHERE {S} AND kind NOT IN ('heartbeat', 'summary') AND NOT (kind = 'device' AND detail->>'type' = 'reading') AND $__timeFilter(time) ORDER BY time DESC LIMIT 40""",
    [override("Time", unit="dateTimeAsLocal", **{"custom.width": 200})]), 24, 9)

night = dashboard("nos-night", "tenshi · Tonight", g.panels,
    [{"name": "session", "label": "Night", "type": "query", "datasource": DS,
      "query": "SELECT user_name || ' (' || to_char(armed_at AT TIME ZONE 'America/Toronto', 'Mon DD HH24:MI') || ')' AS __text, id::text AS __value FROM sessions ORDER BY armed_at DESC LIMIT 50",
      "definition": "sessions", "refresh": 2, "current": {}, "includeAll": False, "multi": False, "sort": 0}],
    "now-15m", "5s", [{"title": "The week", "type": "link", "url": "/grafana/d/nos-week", "icon": "dashboard"}],
    "One night in tenshi, live from Tiger Data.")

# ---------------------------------------------------------------- the week
P = "s.user_name = '$person' AND s.checkin_every_s >= 300"  # real nights only (demo runs check in every few seconds)
J, JA, JE = ("FROM metrics m JOIN sessions s ON s.id = m.session_id", "FROM metrics_1m m JOIN sessions s ON s.id = m.session_id",
             "FROM events e JOIN sessions s ON s.id = e.session_id")
w = Grid()
w.add(header(
    '<div style="display:flex;align-items:center;gap:14px">'
    '<img src="/favicon.svg" width="64" style="display:block">'
    '<div><div style="font-size:24px;font-weight:600;letter-spacing:.02em">tenshi · the week</div>'
    '<div style="opacity:.7;font-size:14px">Every night is a session in Tiger Data. Long-range panels read the <code>metrics_1m</code> continuous aggregate, '
    'so a week stays fast. Sample data for the demo.</div></div></div>'), 24, 3)
w.add(stat("Nights out", f"SELECT s.armed_at AS time, count(*) OVER (ORDER BY s.armed_at) AS value FROM sessions s WHERE {P} AND $__timeFilter(s.armed_at) ORDER BY 1", None, GOLD), 4, 5)
w.add(stat("Hours out", f"SELECT s.armed_at AS time, sum(EXTRACT(EPOCH FROM coalesce(resolved_at, now()) - armed_at) / 3600) OVER (ORDER BY s.armed_at) AS value FROM sessions s WHERE {P} AND $__timeFilter(s.armed_at) ORDER BY 1", "h", GOLD, decimals=1), 4, 5)
w.add(stat("Check-ins answered", f"SELECT 100.0 * count(*) FILTER (WHERE e.kind = 'checkin_ack') / NULLIF(count(*) FILTER (WHERE e.kind = 'checkin_sent'), 0) AS value {JE} WHERE {P} AND $__timeFilter(e.time)",
           "percent", fmt="table", spark=False, decimals=0, thresholds=[{"color": RED, "value": None}, {"color": AMBER, "value": 80}, {"color": MINT, "value": 95}]), 4, 5)
w.add(stat("Average reply", f"SELECT s.armed_at AS time, avg(m.value) AS value {J} WHERE {P} AND m.metric = 'reply_s' AND $__timeFilter(m.time) GROUP BY s.id, s.armed_at ORDER BY 1",
           "s", TEAL, calc="mean", decimals=1, desc="Sparkline: average reply per night."), 4, 5)
w.add(stat("Alarms", f"SELECT count(*) AS value {JE} WHERE {P} AND e.kind = 'level_change' AND e.detail->>'to' = 'ALARM' AND $__timeFilter(e.time)", None, fmt="table", spark=False,
           thresholds=[{"color": MINT, "value": None}, {"color": AMBER, "value": 1}, {"color": RED, "value": 3}], mode="background", desc="Missed check-ins that set the phone's alarm off."), 4, 5)
w.add(stat("Danger heard", f"SELECT count(*) AS value {J} WHERE {P} AND m.metric = 'distress_score' AND m.value >= 0.5 AND $__timeFilter(m.time)", None, fmt="table", spark=False,
           thresholds=[{"color": MINT, "value": None}, {"color": RED, "value": 1}], mode="background"), 4, 5)
w.add(timeline("The ladder, every night", f"SELECT e.time, e.detail->>'to' AS \"level\" {JE} WHERE {P} AND e.kind = 'level_change' AND $__timeFilter(e.time) ORDER BY e.time"), 24, 4)

w.row("When it gets loud")
HOURS = [(20, "8 PM"), (21, "9 PM"), (22, "10 PM"), (23, "11 PM"), (0, "12 AM"), (1, "1 AM"), (2, "2 AM"), (3, "3 AM")]
cols = ", ".join(f"round(avg(m.avg) FILTER (WHERE extract(hour FROM m.bucket AT TIME ZONE 'America/Toronto') = {h})::numeric, 0) AS \"{label}\"" for h, label in HOURS)
heat = table("Loudness by hour of the night (dB)", f"""SELECT to_char((m.bucket AT TIME ZONE 'America/Toronto' - interval '12 hours')::date, 'Dy Mon DD') AS "Night", {cols}
    {JA} WHERE {P} AND m.metric = 'sound_db' AND $__timeFilter(m.bucket)
    GROUP BY (m.bucket AT TIME ZONE 'America/Toronto' - interval '12 hours')::date ORDER BY (m.bucket AT TIME ZONE 'America/Toronto' - interval '12 hours')::date DESC""",
    [override(label, **{"custom.cellOptions": {"type": "color-background", "mode": "basic"}, "custom.align": "center", "unit": "none", "color": {"mode": "continuous-BlYlRd"}, "min": -50, "max": -15}) for _, label in HOURS],
    "Each cell averages the minute rollups for that hour. Hotter means louder.")
w.add(heat, 14, 9)
w.add({"type": "barchart", "title": "Average loudness by hour", "datasource": DS,
       "targets": [q(f"""SELECT to_char(make_time(h::int, 0, 0), 'HH12 AM') AS "hour", round(avg_db::numeric, 1) AS "dB" FROM (
           SELECT extract(hour FROM m.bucket AT TIME ZONE 'America/Toronto') AS h, avg(m.avg) AS avg_db {JA}
           WHERE {P} AND m.metric = 'sound_db' AND $__timeFilter(m.bucket) GROUP BY 1) x ORDER BY (h + 12)::int % 24""", "table")],
       "fieldConfig": {"defaults": {"color": {"mode": "continuous-BlYlRd"}, "min": -50, "max": -15, "custom": {"fillOpacity": 85, "lineWidth": 0}}, "overrides": []},
       "options": {"orientation": "vertical", "barWidth": 0.7, "showValue": "never", "xTickLabelRotation": 0, "legend": {"showLegend": False}, "tooltip": {"mode": "single"}}}, 10, 9)

w.row("Night by night")
w.add(series("Reply time per night", [q(f"""SELECT s.armed_at AS time, avg(m.value) AS "average", max(m.value) AS "slowest" {J}
    WHERE {P} AND m.metric = 'reply_s' AND $__timeFilter(m.time) GROUP BY s.id, s.armed_at ORDER BY 1""")], "s", TEAL, draw="bars", fill=80, legend=True,
    overrides=[override("slowest", color={"mode": "fixed", "fixedColor": AMBER})]), 8, 7)
w.add(series("Battery when she got home", [q(f"""SELECT s.armed_at AS time, (SELECT value FROM metrics WHERE session_id = s.id AND metric = 'battery_pct' ORDER BY time DESC LIMIT 1) AS "battery"
    FROM sessions s WHERE {P} AND $__timeFilter(s.armed_at) ORDER BY 1""")], "percent", TEAL, draw="bars", fill=85, lo=0, hi=100,
    thresholds=[{"color": RED, "value": None}, {"color": AMBER, "value": 20}, {"color": TEAL, "value": 40}], scheme=True), 8, 7)
w.add(series("Coldest walk home (the Switch)", [q(f"""SELECT s.armed_at AS time, min(m.value) AS "coldest" {J}
    WHERE {P} AND m.metric = 'temp_c' AND $__timeFilter(m.time) GROUP BY s.id, s.armed_at ORDER BY 1""")], "celsius", TEAL, draw="bars", fill=85,
    thresholds=[{"color": RED, "value": None}, {"color": TEAL, "value": 5}], scheme=True), 8, 7)
w.add(table("Every night", f"""SELECT to_char(s.armed_at AT TIME ZONE 'America/Toronto', 'Dy Mon DD, HH12:MI AM') AS "Night",
    round((EXTRACT(EPOCH FROM coalesce(s.resolved_at, now()) - s.armed_at) / 3600)::numeric, 1) AS "Hours",
    (SELECT count(*) FROM events e WHERE e.session_id = s.id AND e.kind = 'checkin_ack') AS "Check-ins",
    (SELECT round(avg(value)::numeric, 1) FROM metrics WHERE session_id = s.id AND metric = 'reply_s') AS "Avg reply (s)",
    (SELECT count(*) FROM events e WHERE e.session_id = s.id AND e.kind = 'level_change' AND e.detail->>'to' = 'ALARM') AS "Alarms",
    (SELECT round(max(value)::numeric, 1) FROM metrics WHERE session_id = s.id AND metric = 'distress_score') AS "Danger score",
    (SELECT round(min(value)::numeric, 1) FROM metrics WHERE session_id = s.id AND metric = 'temp_c') AS "Coldest (°C)",
    (SELECT value FROM metrics WHERE session_id = s.id AND metric = 'battery_pct' ORDER BY time DESC LIMIT 1) AS "Battery home (%)"
    FROM sessions s WHERE {P} AND $__timeFilter(s.armed_at) ORDER BY s.armed_at DESC""",
    [override("Alarms", **{"custom.cellOptions": {"type": "color-text"}, "thresholds": {"mode": "absolute", "steps": [{"color": MINT, "value": None}, {"color": RED, "value": 1}]}}),
     override("Danger score", **{"custom.cellOptions": {"type": "color-background", "mode": "basic"}, "thresholds": {"mode": "absolute", "steps": [{"color": "transparent", "value": None}, {"color": RED, "value": 0.5}]}}),
     override("Battery home (%)", **{"custom.cellOptions": {"type": "gauge", "mode": "basic"}, "min": 0, "max": 100, "thresholds": {"mode": "absolute", "steps": [{"color": RED, "value": None}, {"color": AMBER, "value": 20}, {"color": TEAL, "value": 40}]}}),
     override("Coldest (°C)", **{"custom.cellOptions": {"type": "color-text"}, "thresholds": {"mode": "absolute", "steps": [{"color": RED, "value": None}, {"color": TEAL, "value": 5}]}})]), 24, 9)

week = dashboard("nos-week", "tenshi · The week", w.panels,
    [{"name": "person", "label": "Person", "type": "query", "datasource": DS, "query": "SELECT DISTINCT user_name FROM sessions WHERE checkin_every_s >= 300 ORDER BY 1",
      "refresh": 1, "current": {"text": "Maya", "value": "Maya"}, "includeAll": False, "multi": False}],
    "now-7d", "1m", [{"title": "One night", "type": "link", "url": "/grafana/d/nos-night", "icon": "dashboard"}],
    "A week of nights out in tenshi, from Tiger Data.")

for name, d in (("night-out-switch.json", night), ("night-out-switch-week.json", week)):
    with open(os.path.join(OUT, name), "w") as f:
        json.dump(d, f, indent=2)
    print("wrote", name, len(d["panels"]), "panels")
