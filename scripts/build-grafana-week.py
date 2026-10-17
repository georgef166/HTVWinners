# Generates deploy/grafana/dashboards/night-out-switch-week.json (the week view, across nights).
import json
DS = {"type": "grafana-postgresql-datasource", "uid": "tiger"}
P = "s.user_name = '$person'"
def t(sql, fmt="time_series", ref="A"):
    return {"refId": ref, "datasource": DS, "rawQuery": True, "editorMode": "code", "format": fmt, "rawSql": sql}
def ts(id, title, x, y, w, h, targets, unit=None, desc="", draw="line", fill=14, color=None, minv=None, maxv=None, stack=False):
    p = {"id": id, "type": "timeseries", "title": title, "description": desc, "datasource": DS, "gridPos": {"x": x, "y": y, "w": w, "h": h}, "targets": targets,
         "fieldConfig": {"defaults": {"custom": {"drawStyle": draw, "lineWidth": 2, "fillOpacity": fill, "showPoints": "never" if draw == "line" else "auto",
                                                 "barAlignment": 0, "spanNulls": 3600000, "insertNulls": False},
                                      "color": {"mode": "fixed", "fixedColor": color} if color else {"mode": "palette-classic"}}, "overrides": []},
         "options": {"legend": {"displayMode": "list", "placement": "bottom"}, "tooltip": {"mode": "multi"}}}
    if unit: p["fieldConfig"]["defaults"]["unit"] = unit
    if minv is not None: p["fieldConfig"]["defaults"]["min"] = minv
    if maxv is not None: p["fieldConfig"]["defaults"]["max"] = maxv
    return p
def stat(id, title, x, w, sql, unit=None, color="#2F45FF", decimals=None):
    p = {"id": id, "type": "stat", "title": title, "datasource": DS, "gridPos": {"x": x, "y": 3, "w": w, "h": 4}, "targets": [t(sql, "table")],
         "options": {"colorMode": "value", "graphMode": "none", "justifyMode": "auto", "textMode": "value", "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False}},
         "fieldConfig": {"defaults": {"color": {"mode": "fixed", "fixedColor": color}}, "overrides": []}}
    if unit: p["fieldConfig"]["defaults"]["unit"] = unit
    if decimals is not None: p["fieldConfig"]["defaults"]["decimals"] = decimals
    return p
J = "FROM metrics m JOIN sessions s ON s.id = m.session_id"
JA = "FROM metrics_1m m JOIN sessions s ON s.id = m.session_id"
JE = "FROM events e JOIN sessions s ON s.id = e.session_id"
panels = [
  {"id": 100, "type": "text", "gridPos": {"x": 0, "y": 0, "w": 24, "h": 3}, "options": {"mode": "markdown", "content":
   "### A week of nights out, from Tiger Data\nEvery night is a session; every signal is a row in the `metrics` hypertable. The long-range panels read the `metrics_1m` **continuous aggregate**, so a week stays fast. Sample data for the demo. Audio is never stored."}},
  stat(1, "Nights out", 0, 4, f"SELECT count(*) AS value FROM sessions s WHERE {P} AND $__timeFilter(s.armed_at)"),
  stat(2, "Hours out", 4, 4, f"SELECT sum(EXTRACT(EPOCH FROM coalesce(resolved_at, now()) - armed_at)) / 3600 AS value FROM sessions s WHERE {P} AND $__timeFilter(s.armed_at)", "h", decimals=1),
  stat(3, "Check-ins answered", 8, 4, f"SELECT 100.0 * count(*) FILTER (WHERE e.kind = 'checkin_ack') / NULLIF(count(*) FILTER (WHERE e.kind = 'checkin_sent'), 0) AS value {JE} WHERE {P} AND $__timeFilter(e.time)", "percent", "#10B981", 0),
  stat(4, "Average reply", 12, 4, f"SELECT avg(m.value) AS value {J} WHERE {P} AND m.metric = 'reply_s' AND $__timeFilter(m.time)", "s", decimals=1),
  stat(5, "Alarms (missed check-ins)", 16, 4, f"SELECT count(*) AS value {JE} WHERE {P} AND e.kind = 'level_change' AND e.detail->>'to' = 'ALARM' AND $__timeFilter(e.time)", None, "#FF4D3D"),
  stat(6, "30-second checks that flagged something", 20, 4, f"SELECT count(*) AS value {J} WHERE {P} AND m.metric = 'distress_score' AND m.value >= 0.5 AND $__timeFilter(m.time)", None, "#FF4D3D"),
  {"id": 7, "type": "state-timeline", "title": "The escalation ladder, every night", "datasource": DS, "gridPos": {"x": 0, "y": 7, "w": 24, "h": 5},
   "targets": [t(f"SELECT e.time, e.detail->>'to' AS \"level\" {JE} WHERE {P} AND e.kind = 'level_change' AND $__timeFilter(e.time) ORDER BY e.time")],
   "options": {"showValue": "never", "mergeValues": True, "rowHeight": 0.8, "legend": {"showLegend": True, "displayMode": "list", "placement": "bottom"}},
   "fieldConfig": {"defaults": {"color": {"mode": "thresholds"}, "mappings": [{"type": "value", "options": {
     "ARMED": {"color": "#2F45FF", "index": 0, "text": "Armed"}, "NUDGE": {"color": "#FF9500", "index": 1, "text": "Check-in"}, "ALARM": {"color": "#FF4D3D", "index": 2, "text": "Alarm"},
     "CONTACT": {"color": "#C2121F", "index": 3, "text": "Contact alerted"}, "WIDER": {"color": "#7A0B14", "index": 4}, "RESOLVED": {"color": "#E4E6EF", "index": 5, "text": "Home"}}}]}, "overrides": []}},
  ts(8, "Sound across the week (10-minute buckets from metrics_1m)", 0, 12, 16, 8, [
      t(f"SELECT time_bucket('10 minutes', m.bucket) AS time, avg(m.avg) AS \"average dB\" {JA} WHERE {P} AND m.metric = 'sound_db' AND $__timeFilter(m.bucket) GROUP BY 1 ORDER BY 1", ref="A"),
      t(f"SELECT time_bucket('10 minutes', m.bucket) AS time, max(m.max) AS \"peak dB\" {JA} WHERE {P} AND m.metric = 'sound_peak_db' AND $__timeFilter(m.bucket) GROUP BY 1 ORDER BY 1", ref="B")], "dB"),
  {"id": 9, "type": "barchart", "title": "How loud each hour of the night gets", "datasource": DS, "gridPos": {"x": 16, "y": 12, "w": 8, "h": 8},
   "targets": [t(f"SELECT to_char(make_time(h::int, 0, 0), 'HH24:MI') AS \"hour\", round(avg_db::numeric, 1) AS \"average dB\" FROM (SELECT extract(hour FROM m.bucket AT TIME ZONE 'America/Toronto') AS h, avg(m.avg) AS avg_db {JA} WHERE {P} AND m.metric = 'sound_db' AND $__timeFilter(m.bucket) GROUP BY 1) x ORDER BY (h::int + 6) % 24", "table")],
   "options": {"orientation": "vertical", "xField": "hour", "showValue": "never", "barWidth": 0.8, "legend": {"showLegend": False}},
   "fieldConfig": {"defaults": {"color": {"mode": "fixed", "fixedColor": "#2F45FF"}, "unit": "dB", "custom": {"fillOpacity": 85, "lineWidth": 0}}, "overrides": []}},
  ts(10, "Movement across the week (metrics_1m)", 0, 20, 12, 7, [t(f"SELECT time_bucket('10 minutes', m.bucket) AS time, avg(m.avg) AS \"movement\" {JA} WHERE {P} AND m.metric = 'movement' AND $__timeFilter(m.bucket) GROUP BY 1 ORDER BY 1")], None, color="#2F45FF"),
  ts(11, "Reply time per night", 12, 20, 12, 7, [t(f"SELECT s.armed_at AS time, avg(m.value) AS \"average reply\", max(m.value) AS \"slowest reply\" {J} WHERE {P} AND m.metric = 'reply_s' AND $__timeFilter(s.armed_at) GROUP BY s.armed_at ORDER BY 1")], "s", "Replies get slower late at night, which is when check-ins tighten.", draw="bars", fill=80),
  ts(12, "Battery when she got home", 0, 27, 8, 7, [t(f"SELECT s.armed_at AS time, (SELECT value FROM metrics WHERE session_id = s.id AND metric = 'battery_pct' ORDER BY time DESC LIMIT 1) AS \"battery at home\" FROM sessions s WHERE {P} AND $__timeFilter(s.armed_at) ORDER BY 1")], "percent", "One night it got down to single digits.", draw="bars", fill=80, color="#10B981", minv=0, maxv=100),
  ts(13, "Coldest reading on the walk home (Switch)", 8, 27, 8, 7, [t(f"SELECT s.armed_at AS time, min(m.value) AS \"coldest\" {J} WHERE {P} AND m.metric = 'temp_c' AND $__timeFilter(s.armed_at) GROUP BY s.armed_at ORDER BY 1")], "celsius", "At 5°C or below the prediction engine flags cold exposure.", draw="bars", fill=80, color="#FF9500"),
  ts(14, "Check-ins per night", 16, 27, 8, 7, [
      t(f"SELECT s.armed_at AS time, count(*) FILTER (WHERE e.kind = 'checkin_ack') AS \"answered\", count(*) FILTER (WHERE e.kind = 'level_change' AND e.detail->>'to' = 'ALARM') AS \"missed\" {JE} WHERE {P} AND $__timeFilter(s.armed_at) GROUP BY s.armed_at ORDER BY 1")],
     None, draw="bars", fill=80),
  {"id": 15, "type": "table", "title": "Every night", "datasource": DS, "gridPos": {"x": 0, "y": 34, "w": 24, "h": 9},
   "targets": [t(f"""SELECT to_char(s.armed_at AT TIME ZONE 'America/Toronto', 'Dy Mon DD, HH24:MI') AS "night",
       round((EXTRACT(EPOCH FROM coalesce(s.resolved_at, now()) - s.armed_at) / 3600)::numeric, 1) AS "hours",
       (SELECT count(*) FROM events WHERE session_id = s.id AND kind = 'checkin_ack') AS "check-ins answered",
       (SELECT count(*) FROM events WHERE session_id = s.id AND kind = 'level_change' AND detail->>'to' = 'ALARM') AS "alarms",
       (SELECT count(*) FROM metrics WHERE session_id = s.id AND metric = 'distress_score' AND value >= 0.5) AS "distress flags",
       (SELECT round(avg(value)::numeric, 1) FROM metrics WHERE session_id = s.id AND metric = 'reply_s') AS "avg reply (s)",
       (SELECT round(max(value)::numeric, 1) FROM metrics WHERE session_id = s.id AND metric = 'sound_peak_db') AS "loudest (dB)",
       (SELECT round(min(value)::numeric, 1) FROM metrics WHERE session_id = s.id AND metric = 'temp_c') AS "coldest (°C)",
       (SELECT value FROM metrics WHERE session_id = s.id AND metric = 'battery_pct' ORDER BY time DESC LIMIT 1) AS "battery at home (%)"
     FROM sessions s WHERE {P} AND $__timeFilter(s.armed_at) ORDER BY s.armed_at DESC""", "table")],
   "options": {"showHeader": True, "cellHeight": "sm"}},
]
dash = {
  "uid": "nos-week", "title": "Night Out Switch: the week", "tags": ["night-out-switch", "tiger-data"], "timezone": "browser",
  "schemaVersion": 39, "version": 1, "editable": False, "graphTooltip": 1, "refresh": "1m", "time": {"from": "now-7d", "to": "now"},
  "links": [{"title": "One night", "type": "link", "url": "/grafana/d/nos-night/night-out-switch", "icon": "dashboard"}],
  "templating": {"list": [{"name": "person", "label": "Person", "type": "query", "datasource": DS, "query": "SELECT DISTINCT user_name FROM sessions ORDER BY 1",
                           "refresh": 1, "current": {"text": "Maya", "value": "Maya"}, "includeAll": False, "multi": False}]},
  "panels": panels,
}
json.dump(dash, open('deploy/grafana/dashboards/night-out-switch-week.json', 'w'), indent=2)
print('week dashboard panels:', len(panels))
