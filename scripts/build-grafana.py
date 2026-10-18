# Generates the two Grafana dashboards (deploy/grafana/dashboards/*.json) from Tiger Data:
#   nos-night  one night, live: state, where she is, signals, TimescaleDB analysis, check-ins, events
#   nos-week   a week of nights: totals, where the nights went, the ladder, loudness by hour, every night
# Style: dense mosaic of gradient stat tiles with sparklines, maps, gradient areas and donuts.
# Run: python3 scripts/build-grafana.py
import json, os

DS = {"type": "grafana-postgresql-datasource", "uid": "tiger"}
OUT = os.path.join(os.path.dirname(__file__), "..", "deploy", "grafana", "dashboards")

# Saturated tile colours; teal / orange / red / green keep the app's meaning (armed, waiting, alarm, fine).
BLUE, DBLUE, PURPLE, DPURPLE, ORANGE, RED, DRED, GREEN, TEAL, GOLD = (
    "#3274D9", "#1F60C4", "#A352CC", "#8F3BB8", "#FF780A", "#E02F44", "#C4162A", "#56A64B", "#1F9ABD", "#D1B896")

LEVELS = [  # value, label, colour
    ("ARMED", "Out tonight", TEAL), ("NUDGE", "Check-in", ORANGE), ("ALARM", "Alarm", RED),
    ("CONTACT", "Contact alerted", DRED), ("WIDER", "Backup alerted", DPURPLE), ("RESOLVED", "Home", GREEN),
]
LEVEL_MAP = [{"type": "value", "options": {v: {"text": t, "color": c, "index": i} for i, (v, t, c) in enumerate(LEVELS)}}]
STEP_COLORS = {"Out": TEAL, "Check-in": ORANGE, "Alarm": RED, "Contact": DRED, "Backup": DPURPLE}


def q(sql, fmt="time_series", ref="A"):
    return {"refId": ref, "datasource": DS, "rawQuery": True, "editorMode": "code", "format": fmt, "rawSql": " ".join(sql.split())}


class Board:
    """Panels placed at explicit grid positions (24 columns), so tiles can stack beside maps and charts."""
    def __init__(self):
        self.id, self.panels = 1, []

    def at(self, panel, x, y, w, h):
        panel["id"] = self.id; self.id += 1
        panel["gridPos"] = {"x": x, "y": y, "w": w, "h": h}
        self.panels.append(panel)

    def row(self, title, y):
        self.at({"type": "row", "title": title, "collapsed": False, "panels": []}, 0, y, 24, 1)


def stat(title, sql, unit=None, color=BLUE, fmt="time_series", calc="lastNotNull", spark=True, decimals=None, desc="",
         thresholds=None, mappings=None, text=False):
    d = {"color": {"mode": "thresholds" if thresholds else "fixed", "fixedColor": color}, "mappings": mappings or []}
    if thresholds: d["thresholds"] = {"mode": "absolute", "steps": thresholds}
    if unit: d["unit"] = unit
    if decimals is not None: d["decimals"] = decimals
    return {"type": "stat", "title": title, "description": desc, "datasource": DS, "targets": [q(sql, fmt)],
            "fieldConfig": {"defaults": d, "overrides": []},
            "options": {"colorMode": "background", "graphMode": "area" if spark else "none", "justifyMode": "center", "textMode": "value",
                        "wideLayout": True, "showPercentChange": False, "text": {},
                        "reduceOptions": {"calcs": [calc], "fields": "/.*/" if text else "", "values": False}}}


def gauge(title, sql, unit, steps, lo=0, hi=100, desc="", fmt="time_series"):
    return {"type": "gauge", "title": title, "description": desc, "datasource": DS, "targets": [q(sql, fmt)],
            "fieldConfig": {"defaults": {"unit": unit, "min": lo, "max": hi, "color": {"mode": "thresholds"},
                                         "thresholds": {"mode": "absolute", "steps": steps}}, "overrides": []},
            "options": {"showThresholdMarkers": True, "showThresholdLabels": False, "minVizHeight": 75, "minVizWidth": 75, "sizing": "auto",
                        "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False}}}


def area(title, targets, unit=None, color=PURPLE, desc="", fill=55, draw="line", thresholds=None, tstyle="off", lo=None, hi=None,
         legend=False, scheme=False, points="never", interp="smooth", overrides=None, width=1):
    """Gradient-filled time series, the reference look: a bright line over a fading fill."""
    d = {"custom": {"drawStyle": draw, "lineInterpolation": interp, "lineWidth": width, "fillOpacity": fill,
                    "gradientMode": "scheme" if scheme else "opacity", "showPoints": points, "pointSize": 6,
                    "spanNulls": False, "axisBorderShow": False, "axisPlacement": "auto", "barAlignment": 0,
                    "thresholdsStyle": {"mode": tstyle}},
         "color": {"mode": "thresholds"} if scheme else {"mode": "fixed", "fixedColor": color}}
    if thresholds: d["thresholds"] = {"mode": "absolute", "steps": thresholds}
    if unit: d["unit"] = unit
    if lo is not None: d["min"] = lo
    if hi is not None: d["max"] = hi
    return {"type": "timeseries", "title": title, "description": desc, "datasource": DS, "targets": targets,
            "fieldConfig": {"defaults": d, "overrides": overrides or []},
            "options": {"legend": {"showLegend": legend, "displayMode": "table" if legend else "list", "placement": "right", "calcs": ["lastNotNull"] if legend else []},
                        "tooltip": {"mode": "multi", "sort": "none"}}}


def donut(title, sql, colors, unit=None, desc=""):
    return {"type": "piechart", "title": title, "description": desc, "datasource": DS, "targets": [q(sql, "table")],
            "fieldConfig": {"defaults": {"color": {"mode": "palette-classic"}, "unit": unit or "none", "decimals": 0},
                            "overrides": [override(n, color={"mode": "fixed", "fixedColor": c}) for n, c in colors.items()]},
            "options": {"pieType": "donut", "displayLabels": [], "tooltip": {"mode": "single"},
                        "legend": {"showLegend": True, "displayMode": "table", "placement": "right", "values": ["value", "percent"]},
                        "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": True}}}


def bargauge(title, sql, unit, steps, lo=0, hi=100, desc="", mode="gradient"):
    return {"type": "bargauge", "title": title, "description": desc, "datasource": DS, "targets": [q(sql, "table")],
            "fieldConfig": {"defaults": {"unit": unit, "min": lo, "max": hi, "color": {"mode": "thresholds"}, "decimals": 0,
                                         "thresholds": {"mode": "absolute", "steps": steps}}, "overrides": []},
            "options": {"orientation": "horizontal", "displayMode": mode, "valueMode": "color", "namePlacement": "left", "showUnfilled": True,
                        "sizing": "auto", "minVizHeight": 16, "maxVizHeight": 300,
                        "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": True}}}


def geomap(title, targets, layers, lat=43.655, lon=-79.39, zoom=12, desc=""):
    return {"type": "geomap", "title": title, "description": desc, "datasource": DS, "targets": targets,
            "fieldConfig": {"defaults": {"color": {"mode": "fixed", "fixedColor": PURPLE}}, "overrides": []},
            "options": {"basemap": {"type": "carto", "name": "Dark", "config": {"theme": "dark", "showLabels": True}},
                        "controls": {"showZoom": True, "mouseWheelZoom": False, "showAttribution": True},
                        "view": {"id": "coords", "lat": lat, "lon": lon, "zoom": zoom, "allLayers": True},
                        "layers": layers, "tooltip": {"mode": "details"}}}


def markers(name, ref, color, size, opacity=0.8):
    return {"type": "markers", "name": name, "filterData": {"id": "byRefId", "options": ref}, "tooltip": True,
            "location": {"mode": "coords", "latitude": "latitude", "longitude": "longitude"},
            "config": {"showLegend": False, "style": {"color": {"fixed": color}, "opacity": opacity, "size": {"fixed": size},
                                                      "symbol": {"fixed": "img/icons/marker/circle.svg", "mode": "fixed"}, "rotation": {"fixed": 0}}}}


def timeline(title, sql, desc=""):
    return {"type": "state-timeline", "title": title, "description": desc, "datasource": DS, "targets": [q(sql)],
            "fieldConfig": {"defaults": {"color": {"mode": "thresholds"}, "mappings": LEVEL_MAP, "custom": {"fillOpacity": 90, "lineWidth": 0}}, "overrides": []},
            "options": {"showValue": "auto", "mergeValues": True, "rowHeight": 0.8, "alignValue": "center", "legend": {"showLegend": False}, "tooltip": {"mode": "single"}}}


def table(title, sql, overrides, desc="", sort=None):
    return {"type": "table", "title": title, "description": desc, "datasource": DS, "targets": [q(sql, "table")],
            "fieldConfig": {"defaults": {"custom": {"align": "auto", "cellOptions": {"type": "auto"}, "inspect": False}}, "overrides": overrides},
            "options": {"showHeader": True, "cellHeight": "sm", "footer": {"show": False}, "sortBy": sort or []}}


def override(name, **props):
    return {"matcher": {"id": "byName", "options": name}, "properties": [{"id": k, "value": v} for k, v in props.items()]}


def cells(mode, steps, **more):
    return {"custom.cellOptions": {"type": mode, "mode": "gradient"}, "thresholds": {"mode": "absolute", "steps": steps}, "color": {"mode": "thresholds"}, **more}


def dashboard(uid, title, panels, templating, time_from, refresh, links, desc):
    return {"uid": uid, "title": title, "description": desc, "tags": ["tenshi", "tiger-data"], "timezone": "browser", "schemaVersion": 39,
            "version": 5, "editable": False, "graphTooltip": 1, "refresh": refresh, "liveNow": False, "fiscalYearStartMonth": 0,
            "time": {"from": time_from, "to": "now"}, "timepicker": {"refresh_intervals": ["5s", "10s", "30s", "1m", "5m"]},
            "links": links, "templating": {"list": templating}, "panels": panels, "annotations": {"list": []}}


# ---------------------------------------------------------------- one night
S = "session_id = '$session'"
n = Board()
# Top band: four tiles, the map, battery and the two alarms-at-a-glance tiles
n.at(stat("Right now", "SELECT level AS value FROM sessions WHERE id = '$session'", fmt="table", spark=False, mappings=LEVEL_MAP, color=TEAL, text=True,
          desc="The escalation level the server is at for this night."), 0, 0, 4, 4)
n.at(stat("Out for", "SELECT EXTRACT(EPOCH FROM coalesce(resolved_at, now()) - armed_at) AS value FROM sessions WHERE id = '$session'", "dtdurations", DBLUE, "table", spark=False), 0, 4, 4, 4)
n.at(stat("Check-ins answered", f"SELECT time, count(*) OVER (ORDER BY time) AS value FROM events WHERE {S} AND kind = 'checkin_ack' ORDER BY time", None, GREEN,
          desc="Running count of check-ins answered, from the phone or the Switch."), 4, 0, 4, 4)
n.at(stat("Average reply", f"SELECT time, avg(value) OVER (ORDER BY time) AS value FROM metrics WHERE {S} AND metric = 'reply_s' ORDER BY time", "s", ORANGE, decimals=1,
          desc="How fast check-ins get answered. Slower replies make the next check-in come sooner."), 4, 4, 4, 4)
n.at(geomap("Where she is", [q(f"SELECT time, lat AS latitude, lng AS longitude FROM events WHERE {S} AND lat IS NOT NULL AND $__timeFilter(time) ORDER BY time DESC LIMIT 400", "table", "A"),
                             q(f"SELECT time, lat AS latitude, lng AS longitude FROM events WHERE {S} AND lat IS NOT NULL ORDER BY time DESC LIMIT 1", "table", "B")],
            [markers("Her path", "A", PURPLE, 4, 0.6), markers("Last location", "B", RED, 12, 1)], zoom=13,
            desc="Heartbeat locations (purple) and the last known one (red), the same point the contact gets."), 8, 0, 9, 8)
n.at(gauge("Battery", f"SELECT time, value FROM metrics WHERE {S} AND metric = 'battery_pct' ORDER BY time", "percent",
           [{"color": RED, "value": None}, {"color": ORANGE, "value": 20}, {"color": GREEN, "value": 40}]), 17, 0, 4, 8)
n.at(stat("Danger heard", f"SELECT count(*) AS value FROM events WHERE {S} AND kind = 'danger_alert'", None, fmt="table", spark=False,
          thresholds=[{"color": GREEN, "value": None}, {"color": RED, "value": 1}],
          desc="Times the phone heard a plea for help or aggression and alerted the contact at once."), 21, 0, 3, 4)
n.at(stat("Switch", f"SELECT time, value FROM metrics WHERE {S} AND metric = 'temp_c' ORDER BY time", "celsius", fmt="time_series", decimals=1,
          thresholds=[{"color": BLUE, "value": None}, {"color": DPURPLE, "value": 5}], desc="Temperature from the Switch. Blue at 5°C or colder."), 21, 4, 3, 4)
n.at(timeline("Escalation ladder", f"SELECT time, detail->>'to' AS \"level\" FROM events WHERE {S} AND kind = 'level_change' AND $__timeFilter(time) ORDER BY time",
              "Armed, check-in, alarm, contact, backup: each step's timer runs on the server."), 0, 8, 24, 4)

n.row("Phone signals", 12)
n.at(area("Sound around her", [q(f"""SELECT time_bucket('5 seconds', time) AS time, avg(value) AS "average", max(value) AS "peak"
    FROM metrics WHERE {S} AND metric IN ('sound_db', 'sound_peak_db') AND $__timeFilter(time) GROUP BY 1 ORDER BY 1""")],
    "dB", PURPLE, "Loudness only, never audio. The red band is where shouting starts.", thresholds=[{"color": "transparent", "value": None}, {"color": RED, "value": -15}],
    tstyle="area", legend=True, overrides=[override("peak", **{"color": {"mode": "fixed", "fixedColor": ORANGE}, "custom.fillOpacity": 0, "custom.lineStyle": {"fill": "dash", "dash": [6, 4]}})]), 0, 13, 14, 8)
n.at(stat("Loudness now", f"SELECT time, value FROM metrics WHERE {S} AND metric = 'sound_db' ORDER BY time", "dB", PURPLE, decimals=0), 14, 13, 5, 4)
n.at(stat("Loudest tonight", f"SELECT time, max(value) OVER (ORDER BY time) AS value FROM metrics WHERE {S} AND metric = 'sound_peak_db' ORDER BY time", "dB", DPURPLE, decimals=0), 19, 13, 5, 4)
n.at(stat("Movement now", f"SELECT time, value FROM metrics WHERE {S} AND metric = 'movement' ORDER BY time", "accMS2", BLUE, decimals=2), 14, 17, 5, 4)
n.at(stat("Heartbeats", f"SELECT time, count(*) OVER (ORDER BY time) AS value FROM events WHERE {S} AND kind = 'heartbeat' ORDER BY time", None, TEAL,
          desc="Each one is a row in Tiger Data: location, battery and sound level from her phone."), 19, 17, 5, 4)
n.at(area("Movement", [q(f"""SELECT time_bucket('5 seconds', time) AS time, avg(value) AS "movement"
    FROM metrics WHERE {S} AND metric = 'movement' AND $__timeFilter(time) GROUP BY 1 ORDER BY 1""")], "accMS2", BLUE,
    "From the phone's motion sensor. Dancing spikes, a still phone flatlines."), 0, 21, 12, 7)
n.at(area("Battery", [q(f"SELECT time, value AS \"battery\" FROM metrics WHERE {S} AND metric = 'battery_pct' AND $__timeFilter(time) ORDER BY time")], "percent", GREEN,
    "Under 20% the check-ins come sooner: a dead phone looks like silence.", thresholds=[{"color": RED, "value": None}, {"color": ORANGE, "value": 20}, {"color": GREEN, "value": 40}],
    scheme=True, lo=0, hi=100, width=2), 12, 21, 12, 7)

n.row("TimescaleDB analysis", 28)
n.at(area("Sound anomaly (z-score)", [q(f"""SELECT time, (value - avg(value) OVER w) / NULLIF(stddev_samp(value) OVER w, 0) AS "z-score"
    FROM metrics WHERE {S} AND metric = 'sound_db' AND $__timeFilter(time)
    WINDOW w AS (ORDER BY time ROWS BETWEEN 30 PRECEDING AND CURRENT ROW) ORDER BY time""")], None, ORANGE,
    "Each reading against its own rolling baseline (SQL window functions). Above 2 is unusual for this night.",
    thresholds=[{"color": "transparent", "value": None}, {"color": RED, "value": 2}], tstyle="area"), 0, 29, 12, 8)
n.at(area("Per-minute rollup (continuous aggregate)", [q(f"""SELECT bucket AS time,
      max(avg) FILTER (WHERE metric = 'sound_db') AS "Sound (dB)", max(avg) FILTER (WHERE metric = 'movement') AS "Movement",
      max(avg) FILTER (WHERE metric = 'battery_pct') AS "Battery (%)"
    FROM metrics_1m WHERE {S} AND metric IN ('sound_db', 'movement', 'battery_pct') AND $__timeFilter(bucket) GROUP BY bucket ORDER BY 1""")], None, PURPLE,
    "metrics_1m is a TimescaleDB continuous aggregate: minute averages kept fresh in the background.", fill=25, legend=True, interp="linear", points="always", width=2,
    overrides=[override("Movement", color={"mode": "fixed", "fixedColor": BLUE}), override("Battery (%)", color={"mode": "fixed", "fixedColor": GREEN})]), 12, 29, 12, 8)

n.row("Check-ins, the Switch and danger", 37)
n.at(stat("Check-ins sent", f"SELECT count(*) AS value FROM events WHERE {S} AND kind = 'checkin_sent'", None, ORANGE, "table", spark=False), 0, 38, 5, 3)
n.at(stat("Answered", f"SELECT count(*) AS value FROM events WHERE {S} AND kind = 'checkin_ack'", None, GREEN, "table", spark=False), 0, 41, 5, 3)
n.at(stat("Alarms", f"SELECT count(*) AS value FROM events WHERE {S} AND kind = 'level_change' AND detail->>'to' = 'ALARM'", None, fmt="table", spark=False,
          thresholds=[{"color": GREEN, "value": None}, {"color": RED, "value": 1}]), 0, 44, 5, 3)
n.at(donut("How she checked in", f"""SELECT 'Phone' AS "via", greatest(0, (SELECT count(*) FROM events WHERE {S} AND kind = 'checkin_ack')
      - (SELECT count(*) FROM events WHERE {S} AND kind = 'device' AND detail->>'type' = 'touch')) AS "check-ins"
    UNION ALL SELECT 'Switch', (SELECT count(*) FROM events WHERE {S} AND kind = 'device' AND detail->>'type' = 'touch')""",
    {"Phone": TEAL, "Switch": PURPLE}, desc="One tap on the phone, or a touch on the Switch without unlocking it."), 5, 38, 7, 9)
n.at(area("Danger checks", [q(f"SELECT time, value AS \"score\" FROM metrics WHERE {S} AND metric = 'distress_score' AND $__timeFilter(time) ORDER BY time")],
    None, RED, "Each dot is a check of what the phone heard. Above the line alerts the contact.", draw="points", points="always", lo=0, hi=1,
    thresholds=[{"color": GREEN, "value": None}, {"color": RED, "value": 0.5}], scheme=True, tstyle="dashed"), 12, 38, 6, 9)
n.at(area("Temperature from the Switch", [q(f"SELECT time, value AS \"temperature\" FROM metrics WHERE {S} AND metric = 'temp_c' AND $__timeFilter(time) ORDER BY time")],
    "celsius", TEAL, "Blue below 5°C: likely outside in the cold.", thresholds=[{"color": BLUE, "value": None}, {"color": TEAL, "value": 5}],
    scheme=True, tstyle="dashed", width=2), 18, 38, 6, 9)
n.at(table("What happened tonight", f"""SELECT time AS "Time",
    CASE kind WHEN 'checkin_sent' THEN 'Check-in sent' WHEN 'checkin_ack' THEN 'Checked in' WHEN 'stand_down' THEN 'PIN cancelled the alarm'
      WHEN 'contact_ack' THEN 'Contact is on it' WHEN 'danger_alert' THEN 'Danger heard, contact alerted' WHEN 'distress_check' THEN 'Danger check'
      WHEN 'level_change' THEN 'Level: ' || initcap(detail->>'to') WHEN 'device' THEN 'Switch: ' || coalesce(detail->>'type', '') WHEN 'resolved' THEN 'Night ended' ELSE kind END AS "What",
    CASE WHEN kind IN ('danger_alert') OR detail->>'to' IN ('ALARM', 'CONTACT', 'WIDER') THEN 'alert' WHEN kind IN ('checkin_ack', 'stand_down', 'contact_ack', 'resolved') THEN 'ok'
      WHEN kind = 'checkin_sent' OR detail->>'to' = 'NUDGE' THEN 'waiting' ELSE 'info' END AS "Kind"
    FROM events WHERE {S} AND kind NOT IN ('heartbeat', 'summary') AND NOT (kind = 'device' AND detail->>'type' = 'reading') AND $__timeFilter(time) ORDER BY time DESC LIMIT 40""",
    [override("Time", unit="dateTimeAsLocal", **{"custom.width": 200}),
     override("Kind", **{"custom.width": 110, "custom.align": "center", "custom.cellOptions": {"type": "color-background", "mode": "gradient"},
                         "mappings": [{"type": "value", "options": {"alert": {"color": RED, "text": "Alert", "index": 0}, "ok": {"color": GREEN, "text": "OK", "index": 1},
                                                                     "waiting": {"color": ORANGE, "text": "Waiting", "index": 2}, "info": {"color": BLUE, "text": "Info", "index": 3}}}]})]), 0, 47, 24, 9)

night = dashboard("nos-night", "tenshi · Tonight", n.panels,
    [{"name": "session", "label": "Night", "type": "query", "datasource": DS,
      "query": "SELECT user_name || ' (' || to_char(armed_at AT TIME ZONE 'America/Toronto', 'Mon DD HH24:MI') || ')' AS __text, id::text AS __value FROM sessions ORDER BY armed_at DESC LIMIT 50",
      "definition": "sessions", "refresh": 2, "current": {}, "includeAll": False, "multi": False, "sort": 0}],
    "now-15m", "5s", [{"title": "The week", "type": "link", "url": "/grafana/d/nos-week", "icon": "dashboard"}],
    "One night in tenshi, live from Tiger Data.")

# ---------------------------------------------------------------- the week
P = "s.user_name = '$person' AND s.checkin_every_s >= 300"  # real nights only (demo runs check in every few seconds)
J, JA, JE = ("FROM metrics m JOIN sessions s ON s.id = m.session_id", "FROM metrics_1m m JOIN sessions s ON s.id = m.session_id",
             "FROM events e JOIN sessions s ON s.id = e.session_id")
NIGHT = "to_char(s.armed_at AT TIME ZONE 'America/Toronto', 'Dy DD')"
w = Board()
w.at(stat("Nights out", f"SELECT s.armed_at AS time, count(*) OVER (ORDER BY s.armed_at) AS value FROM sessions s WHERE {P} AND $__timeFilter(s.armed_at) ORDER BY 1", None, BLUE), 0, 0, 4, 5)
w.at(stat("Hours out", f"SELECT s.armed_at AS time, sum(EXTRACT(EPOCH FROM coalesce(resolved_at, now()) - armed_at) / 3600) OVER (ORDER BY s.armed_at) AS value FROM sessions s WHERE {P} AND $__timeFilter(s.armed_at) ORDER BY 1", "h", DPURPLE, decimals=1), 4, 0, 4, 5)
w.at(stat("Check-ins answered", f"SELECT 100.0 * count(*) FILTER (WHERE e.kind = 'checkin_ack') / NULLIF(count(*) FILTER (WHERE e.kind = 'checkin_sent'), 0) AS value {JE} WHERE {P} AND $__timeFilter(e.time)",
          "percent", fmt="table", spark=False, decimals=0, thresholds=[{"color": RED, "value": None}, {"color": ORANGE, "value": 80}, {"color": GREEN, "value": 95}]), 8, 0, 4, 5)
w.at(stat("Average reply", f"SELECT s.armed_at AS time, avg(m.value) AS value {J} WHERE {P} AND m.metric = 'reply_s' AND $__timeFilter(m.time) GROUP BY s.id, s.armed_at ORDER BY 1",
          "s", ORANGE, calc="mean", decimals=1, desc="Sparkline: average reply per night."), 12, 0, 4, 5)
w.at(stat("Alarms", f"SELECT count(*) AS value {JE} WHERE {P} AND e.kind = 'level_change' AND e.detail->>'to' = 'ALARM' AND $__timeFilter(e.time)", None, fmt="table", spark=False,
          thresholds=[{"color": GREEN, "value": None}, {"color": ORANGE, "value": 1}, {"color": RED, "value": 3}], desc="Missed check-ins that set the phone's alarm off."), 16, 0, 4, 5)
w.at(stat("Rows in Tiger Data", f"SELECT s.armed_at AS time, sum((SELECT count(*) FROM metrics WHERE session_id = s.id) + (SELECT count(*) FROM events WHERE session_id = s.id)) OVER (ORDER BY s.armed_at) AS value FROM sessions s WHERE {P} AND $__timeFilter(s.armed_at) ORDER BY 1",
          "short", TEAL, desc="Every heartbeat, metric and event this week, in the events and metrics hypertables."), 20, 0, 4, 5)

w.at(geomap("Where the nights went", [q(f"""SELECT time_bucket('5 minutes', e.time) AS time, avg(e.lat) AS latitude, avg(e.lng) AS longitude {JE}
    WHERE {P} AND e.kind = 'heartbeat' AND e.lat IS NOT NULL AND $__timeFilter(e.time) GROUP BY 1, s.id ORDER BY 1""", "table", "A")],
    [{"type": "heatmap", "name": "Nights", "filterData": {"id": "byRefId", "options": "A"}, "tooltip": False,
      "location": {"mode": "coords", "latitude": "latitude", "longitude": "longitude"},
      "config": {"blur": 18, "radius": 9, "weight": {"fixed": 1, "min": 0, "max": 1}}}], lat=43.68, lon=-79.36, zoom=11,
    desc="Heartbeat locations from every night, five-minute averages."), 0, 5, 9, 9)
w.at(donut("Time at each step", f"""WITH c AS (SELECT e.time, e.detail->>'to' AS lvl, lead(e.time) OVER (PARTITION BY e.session_id ORDER BY e.time) AS nxt {JE}
      WHERE {P} AND e.kind = 'level_change' AND $__timeFilter(e.time))
    SELECT CASE lvl WHEN 'ARMED' THEN 'Out' WHEN 'NUDGE' THEN 'Check-in' WHEN 'ALARM' THEN 'Alarm' WHEN 'CONTACT' THEN 'Contact' WHEN 'WIDER' THEN 'Backup' END AS "step",
      round((sum(EXTRACT(EPOCH FROM nxt - time)) / 60)::numeric) AS "minutes"
    FROM c WHERE nxt IS NOT NULL AND lvl <> 'RESOLVED' GROUP BY 1 ORDER BY 2 DESC""", STEP_COLORS, "m",
    "Minutes spent on each step of the ladder across the week."), 9, 5, 7, 9)
w.at(bargauge("Battery when she got home", f"""SELECT {NIGHT} AS "night", (SELECT value FROM metrics WHERE session_id = s.id AND metric = 'battery_pct' ORDER BY time DESC LIMIT 1) AS "Battery"
    FROM sessions s WHERE {P} AND $__timeFilter(s.armed_at) ORDER BY s.armed_at""", "percent",
    [{"color": RED, "value": None}, {"color": ORANGE, "value": 20}, {"color": GREEN, "value": 40}], desc="Red under 20%: a dead phone looks like silence."), 16, 5, 8, 9)
w.at(timeline("The ladder, every night", f"SELECT e.time, e.detail->>'to' AS \"level\" {JE} WHERE {P} AND e.kind = 'level_change' AND $__timeFilter(e.time) ORDER BY e.time"), 0, 14, 24, 4)

w.row("When it gets loud", 18)
HOURS = [(21, "9 PM"), (22, "10 PM"), (23, "11 PM"), (0, "12 AM"), (1, "1 AM"), (2, "2 AM")]
cols = ", ".join(f"round(avg(m.avg) FILTER (WHERE extract(hour FROM m.bucket AT TIME ZONE 'America/Toronto') = {h})::numeric, 0) AS \"{label}\"" for h, label in HOURS)
w.at(table("Loudness by hour of the night (dB)", f"""SELECT to_char((m.bucket AT TIME ZONE 'America/Toronto' - interval '12 hours')::date, 'Dy Mon DD') AS "Night", {cols}
    {JA} WHERE {P} AND m.metric = 'sound_db' AND $__timeFilter(m.bucket)
    GROUP BY (m.bucket AT TIME ZONE 'America/Toronto' - interval '12 hours')::date ORDER BY (m.bucket AT TIME ZONE 'America/Toronto' - interval '12 hours')::date DESC""",
    [override(label, **{"custom.cellOptions": {"type": "color-background", "mode": "gradient"}, "custom.align": "center", "unit": "none", "color": {"mode": "continuous-BlPu"}, "min": -50, "max": -15,
              "mappings": [{"type": "special", "options": {"match": "null", "result": {"text": " ", "color": "transparent", "index": 0}}}]}) for _, label in HOURS]
    + [override("Night", **{"custom.width": 110})],
    "Each cell averages the minute rollups (the metrics_1m continuous aggregate) for that hour. Brighter means louder."), 0, 19, 14, 9)
w.at({"type": "barchart", "title": "How loud each hour gets", "datasource": DS,
      "targets": [q(f"""SELECT to_char(make_time(h::int, 0, 0), 'HH12 AM') AS "hour", round((avg_db + 60)::numeric, 1) AS "Loudness" FROM (
          SELECT extract(hour FROM m.bucket AT TIME ZONE 'America/Toronto') AS h, avg(m.avg) AS avg_db {JA}
          WHERE {P} AND m.metric = 'sound_db' AND $__timeFilter(m.bucket) GROUP BY 1) x ORDER BY (h + 12)::int % 24""", "table")],
      "description": "Average dB above a quiet room (-60 dB), by hour.",
      "fieldConfig": {"defaults": {"color": {"mode": "continuous-BlPu"}, "min": 10, "max": 45, "unit": "dB", "custom": {"fillOpacity": 85, "gradientMode": "hue", "lineWidth": 0}}, "overrides": []},
      "options": {"orientation": "vertical", "barWidth": 0.75, "showValue": "auto", "xTickLabelRotation": 0, "legend": {"showLegend": False}, "tooltip": {"mode": "single"}}}, 14, 19, 10, 9)

w.row("Night by night", 28)
w.at(area("Reply time per night", [q(f"""SELECT s.armed_at AS time, avg(m.value) AS "average", max(m.value) AS "slowest" {J}
    WHERE {P} AND m.metric = 'reply_s' AND $__timeFilter(m.time) GROUP BY s.id, s.armed_at ORDER BY 1""")], "s", TEAL, draw="bars", fill=85, legend=True,
    overrides=[override("slowest", color={"mode": "fixed", "fixedColor": ORANGE})]), 0, 29, 9, 8)
w.at({"type": "barchart", "title": "Coldest walk home (the Switch)", "description": "Blue at 5°C or colder: likely outside in the cold.", "datasource": DS,
      "targets": [q(f"""SELECT {NIGHT} AS "night", round(min(m.value)::numeric, 1) AS "Coldest" {J}
          WHERE {P} AND m.metric = 'temp_c' AND $__timeFilter(m.time) GROUP BY s.id, s.armed_at ORDER BY s.armed_at""", "table")],
      "fieldConfig": {"defaults": {"unit": "celsius", "color": {"mode": "thresholds"}, "thresholds": {"mode": "absolute", "steps": [{"color": BLUE, "value": None}, {"color": TEAL, "value": 5}]},
                                   "custom": {"fillOpacity": 85, "gradientMode": "opacity", "lineWidth": 0}}, "overrides": []},
      "options": {"orientation": "vertical", "barWidth": 0.6, "showValue": "auto", "xTickLabelRotation": 0, "legend": {"showLegend": False}, "tooltip": {"mode": "single"}}}, 9, 29, 7, 8)
w.at(bargauge("Loudest moment each night", f"""SELECT {NIGHT} AS "night", round((max(m.max) + 60)::numeric) AS "Loudest"
    {JA} WHERE {P} AND m.metric = 'sound_peak_db' AND $__timeFilter(m.bucket) GROUP BY s.id, s.armed_at ORDER BY s.armed_at""", "dB",
    [{"color": PURPLE, "value": None}, {"color": ORANGE, "value": 45}, {"color": RED, "value": 52}], 0, 60,
    "Peak dB above a quiet room. Red is shouting territory.", mode="lcd"), 16, 29, 8, 8)
w.at(table("Every night", f"""SELECT to_char(s.armed_at AT TIME ZONE 'America/Toronto', 'Dy Mon DD, HH12:MI AM') AS "Night",
    round((EXTRACT(EPOCH FROM coalesce(s.resolved_at, now()) - s.armed_at) / 3600)::numeric, 1) AS "Hours",
    (SELECT count(*) FROM events e WHERE e.session_id = s.id AND e.kind = 'checkin_ack') AS "Check-ins",
    (SELECT round(avg(value)::numeric, 1) FROM metrics WHERE session_id = s.id AND metric = 'reply_s') AS "Avg reply (s)",
    (SELECT count(*) FROM events e WHERE e.session_id = s.id AND e.kind = 'level_change' AND e.detail->>'to' = 'ALARM') AS "Alarms",
    (SELECT round(max(value)::numeric, 1) FROM metrics WHERE session_id = s.id AND metric = 'distress_score') AS "Danger score",
    (SELECT round(min(value)::numeric, 1) FROM metrics WHERE session_id = s.id AND metric = 'temp_c') AS "Coldest (°C)",
    (SELECT value FROM metrics WHERE session_id = s.id AND metric = 'battery_pct' ORDER BY time DESC LIMIT 1) AS "Battery home (%)"
    FROM sessions s WHERE {P} AND $__timeFilter(s.armed_at) ORDER BY s.armed_at DESC""",
    [override("Night", **{"custom.cellOptions": {"type": "color-background", "mode": "gradient"}, "color": {"mode": "fixed", "fixedColor": DBLUE}}),
     override("Hours", **cells("color-background", [{"color": TEAL, "value": None}])),
     override("Check-ins", **cells("color-background", [{"color": GREEN, "value": None}])),
     override("Avg reply (s)", **cells("color-background", [{"color": GREEN, "value": None}, {"color": ORANGE, "value": 15}, {"color": RED, "value": 30}])),
     override("Alarms", **cells("color-background", [{"color": GREEN, "value": None}, {"color": RED, "value": 1}])),
     override("Danger score", **cells("color-background", [{"color": GREEN, "value": None}, {"color": ORANGE, "value": 0.3}, {"color": RED, "value": 0.5}])),
     override("Coldest (°C)", **cells("color-background", [{"color": BLUE, "value": None}, {"color": TEAL, "value": 5}])),
     override("Battery home (%)", **{"custom.cellOptions": {"type": "gauge", "mode": "gradient"}, "min": 0, "max": 100, "color": {"mode": "thresholds"},
                                     "thresholds": {"mode": "absolute", "steps": [{"color": RED, "value": None}, {"color": ORANGE, "value": 20}, {"color": GREEN, "value": 40}]}})]), 0, 37, 24, 8)

week = dashboard("nos-week", "tenshi · The week", w.panels,
    [{"name": "person", "label": "Person", "type": "query", "datasource": DS, "query": "SELECT DISTINCT user_name FROM sessions WHERE checkin_every_s >= 300 ORDER BY 1",
      "refresh": 1, "current": {"text": "Maya", "value": "Maya"}, "includeAll": False, "multi": False}],
    "now-7d", "1m", [{"title": "One night", "type": "link", "url": "/grafana/d/nos-night", "icon": "dashboard"}],
    "A week of nights out in tenshi, from Tiger Data.")

for name, d in (("night-out-switch.json", night), ("night-out-switch-week.json", week)):
    with open(os.path.join(OUT, name), "w") as f:
        json.dump(d, f, indent=2)
    print("wrote", name, len(d["panels"]), "panels")
