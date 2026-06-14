import { useState, useEffect, useRef } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

const API = "";  // empty = same host (proxied in dev, direct in prod)
const TOKEN_KEY = "fuel-log-token";
// One-time token injection via URL: ?token=XYZ — saves to localStorage and strips from URL
(() => {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const t = params.get("token");
  if (t && t.length >= 32) {
    localStorage.setItem(TOKEN_KEY, t.trim());
    params.delete("token");
    const newSearch = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (newSearch ? "?" + newSearch : ""));
  }
})();
const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
const apiFetch = (url, opts = {}) => fetch(url, {
  ...opts,
  headers: { ...(opts.headers || {}), "X-Auth-Token": getToken() }
});
const fmt = (d) => { const [,m,day] = d.split("-"); return `${parseInt(m)}/${parseInt(day)}`; };

async function extractMacros({ text, image }) {
  const res = await fetch("/api/extract-macros", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Auth-Token": localStorage.getItem("fuel-log-token") || "" },
    body: JSON.stringify({ text, image }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}
// Read a File as a base64 data URL
const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsDataURL(file);
});

export default function FoodTracker() {
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

  const [entries, setEntries] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [whoopData, setWhoopData] = useState({});
  const [targets, setTargets] = useState({ calories: 2175, protein: 168, carbs: 185, fat: 68 });
  const [showWhoopPrompt, setShowWhoopPrompt] = useState(false);
  const [whoopDate, setWhoopDate] = useState(yesterday);
  const [whoopForm, setWhoopForm] = useState({ recovery: "", strain: "", sleep: "", burned: "" });
  const [tab, setTab] = useState("log");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", calories: "", protein: "", carbs: "", fat: "" });
  const [selectedDate, setSelectedDate] = useState(today);
  const [lookingUp, setLookingUp] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(getToken());
  const [tokenInput, setTokenInput] = useState("");
  const [tokenError, setTokenError] = useState("");

  const initialLoadDone = useRef(false);

  // Load all data from API on mount, poll every 10s, refetch on tab focus
  useEffect(() => {
    if (!token) { setLoading(false); return; }
    let cancelled = false;

    const loadAll = async (isInitial = false) => {
      try {
        const [e, w, t, f] = await Promise.all([
          apiFetch(`${API}/api/entries`).then(r => { if (!r.ok) throw new Error("auth"); return r.json(); }),
          apiFetch(`${API}/api/whoop`).then(r => { if (!r.ok) throw new Error("auth"); return r.json(); }),
          apiFetch(`${API}/api/targets`).then(r => { if (!r.ok) throw new Error("auth"); return r.json(); }),
          apiFetch(`${API}/api/favorites`).then(r => { if (!r.ok) throw new Error("auth"); return r.json(); }),
        ]);
        if (cancelled) return;
        setEntries(e);
        setWhoopData(w);
        setTargets(t);
        setFavorites(f);
        setLoading(false);
        setTokenError("");
        if (isInitial && !initialLoadDone.current) {
          initialLoadDone.current = true;
          if (!w[yesterday] || !w[yesterday].burned) {
            setWhoopDate(yesterday);
            setTimeout(() => { if (!cancelled) setShowWhoopPrompt(true); }, 600);
          }
        }
      } catch (err) {
        if (cancelled) return;
        // Only clear token + show prompt on INITIAL load failure.
        // During polling, silently keep last good state — transient 404s
        // during server restarts shouldn't kick the user out.
        if (isInitial && err.message === "auth") {
          localStorage.removeItem(TOKEN_KEY);
          setToken("");
          setTokenError("Invalid token. Try again.");
          setLoading(false);
        }
      }
    };

    loadAll(true);
    const interval = setInterval(() => loadAll(false), 30000);
    const onVisible = () => { if (!document.hidden) loadAll(false); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [token]);

  const dayEntries = (date) => entries.filter(e => e.date === date);
  const dayTotals = (date) => dayEntries(date).reduce((acc, e) => ({
    calories: acc.calories + (e.calories || 0), protein: acc.protein + (e.protein || 0),
    carbs: acc.carbs + (e.carbs || 0), fat: acc.fat + (e.fat || 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

  const todayEntries = dayEntries(selectedDate);
  const totals = dayTotals(selectedDate);
  const remaining = {
    calories: targets.calories - totals.calories,
    protein: targets.protein - totals.protein,
    carbs: targets.carbs - totals.carbs,
    fat: targets.fat - totals.fat,
  };

  const allDates = [...new Set(entries.map(e => e.date))].sort();
  const last7 = allDates.slice(-7);
  const buildRow = (date) => {
    const t = dayTotals(date);
    const w = whoopData[date];
    const burned = w?.burned || null;
    const deficit = burned ? burned - t.calories : targets.calories - t.calories;
    return { date: fmt(date), rawDate: date, calories: t.calories, protein: t.protein, carbs: t.carbs, fat: t.fat, burned, deficit };
  };
  const trendData = last7.map(buildRow);
  // All-time data + cumulative deficit running total
  let runningDeficit = 0;
  const allTimeData = allDates.map(d => {
    const row = buildRow(d);
    runningDeficit += row.deficit;
    return { ...row, cumulativeDeficit: runningDeficit, cumulativeLbs: Number((runningDeficit / 3500).toFixed(2)) };
  });
  const cumDeficit = allTimeData.length ? allTimeData[allTimeData.length - 1].cumulativeDeficit : 0;
  const cumLbs = Number((cumDeficit / 3500).toFixed(2));

  // Autocomplete: most-recent entry per unique food name, sorted by frequency desc
  const pastFoods = (() => {
    const byName = new Map(); // name → { count, last entry }
    for (const e of entries) {
      const key = (e.name || '').trim().toLowerCase();
      if (!key) continue;
      const prev = byName.get(key);
      byName.set(key, { count: (prev?.count || 0) + 1, last: e });
    }
    return [...byName.values()].sort((a, b) => b.count - a.count).map(v => v.last);
  })();
  const matchingFoods = form.name.trim().length >= 1
    ? pastFoods.filter(f => f.name.toLowerCase().includes(form.name.trim().toLowerCase())).slice(0, 5)
    : [];

  const saveWhoopData = async () => {
    const payload = { recovery: parseInt(whoopForm.recovery) || null, strain: parseFloat(whoopForm.strain) || null, sleep: parseFloat(whoopForm.sleep) || null, burned: parseInt(whoopForm.burned) || null };
    await apiFetch(`${API}/api/whoop/${whoopDate}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setWhoopData(prev => ({ ...prev, [whoopDate]: { ...prev[whoopDate], ...payload } }));
    setShowWhoopPrompt(false);
    setWhoopForm({ recovery: "", strain: "", sleep: "", burned: "" });
  };

  const openWhoopPrompt = (date) => {
    const existing = whoopData[date] || {};
    setWhoopDate(date);
    setWhoopForm({ recovery: String(existing.recovery || ""), strain: String(existing.strain || ""), sleep: String(existing.sleep || ""), burned: String(existing.burned || "") });
    setShowWhoopPrompt(true);
  };

  const handleLookup = async () => {
    if (!form.name) return;
    setLookingUp(true);
    try {
      const macros = await extractMacros({ text: form.name });
      setForm(f => ({
        ...f,
        name: macros.name || f.name,
        calories: String(macros.calories ?? ""),
        protein: String(macros.protein ?? ""),
        carbs: String(macros.carbs ?? ""),
        fat: String(macros.fat ?? ""),
      }));
    } catch (e) { alert(`Lookup failed: ${e.message}`); }
    setLookingUp(false);
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLookingUp(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const macros = await extractMacros({ image: dataUrl, text: form.name });
      setForm(f => ({
        ...f,
        name: macros.name || f.name,
        calories: String(macros.calories ?? ""),
        protein: String(macros.protein ?? ""),
        carbs: String(macros.carbs ?? ""),
        fat: String(macros.fat ?? ""),
      }));
    } catch (err) { alert(`Photo extraction failed: ${err.message}`); }
    setLookingUp(false);
    e.target.value = ""; // allow re-upload of same file
  };

  const isFavorite = (name) => favorites.some(f => f.name.toLowerCase() === (name || "").toLowerCase());

  const toggleFavorite = async (entry) => {
    const existing = favorites.find(f => f.name.toLowerCase() === entry.name.toLowerCase());
    if (existing) {
      await apiFetch(`${API}/api/favorites/${existing.id}`, { method: "DELETE" });
      setFavorites(prev => prev.filter(f => f.id !== existing.id));
    } else {
      const res = await apiFetch(`${API}/api/favorites`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: entry.name, calories: entry.calories, protein: entry.protein, carbs: entry.carbs, fat: entry.fat }) });
      const fav = await res.json();
      if (fav && !fav.duplicate) setFavorites(prev => [...prev, fav]);
    }
  };

  const logFavorite = async (fav) => {
    const now = new Date();
    const time = now.toTimeString().slice(0, 5);
    const payload = { date: selectedDate, time, name: fav.name, calories: fav.calories, protein: fav.protein, carbs: fav.carbs, fat: fav.fat };
    const res = await apiFetch(`${API}/api/entries`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const entry = await res.json();
    setEntries(prev => [...prev, entry]);
  };

  const handleAdd = async () => {
    if (!form.name || !form.calories) return;
    const now = new Date();
    const time = now.toTimeString().slice(0, 5);
    const payload = { date: selectedDate, time, name: form.name, calories: parseInt(form.calories) || 0, protein: parseInt(form.protein) || 0, carbs: parseInt(form.carbs) || 0, fat: parseInt(form.fat) || 0 };
    const res = await apiFetch(`${API}/api/entries`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const entry = await res.json();
    setEntries(prev => [...prev, entry]);
    setForm({ name: "", calories: "", protein: "", carbs: "", fat: "" });
    setShowForm(false);
  };

  const handleDelete = async (id) => {
    await apiFetch(`${API}/api/entries/${id}`, { method: "DELETE" });
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  const startEdit = (entry) => {
    setEditingId(entry.id);
    setEditForm({ name: entry.name, calories: String(entry.calories), protein: String(entry.protein), carbs: String(entry.carbs), fat: String(entry.fat) });
  };

  const saveEdit = async () => {
    const payload = { name: editForm.name, calories: parseInt(editForm.calories) || 0, protein: parseInt(editForm.protein) || 0, carbs: parseInt(editForm.carbs) || 0, fat: parseInt(editForm.fat) || 0 };
    await apiFetch(`${API}/api/entries/${editingId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setEntries(prev => prev.map(e => e.id === editingId ? { ...e, ...payload } : e));
    setEditingId(null);
  };

  const inputStyle = { width: "100%", background: "#faf7f2", border: "1px solid #dcd5cf", borderRadius: 6, padding: "8px 10px", color: "#2a2a2a", fontFamily: "'DM Mono', monospace", fontSize: 13 };

  const MacroRow = ({ label, eaten, target, color }) => {
    const pct = Math.min((eaten / target) * 100, 100); const rem = target - eaten; const over = rem < 0;
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
          <span style={{ color: "#7a7a7a", textTransform: "uppercase", letterSpacing: 1 }}>{label}</span>
          <span><span style={{ color: "#2a2a2a", fontWeight: 500 }}>{eaten}</span><span style={{ color: "#b8b8b8" }}> / {target}g · </span><span style={{ color: over ? "#c97c7c" : color }}>{over ? `+${Math.abs(rem)} over` : `${rem} left`}</span></span>
        </div>
        <div style={{ height: 5, background: "#dcd5cf", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: over ? "#c97c7c" : color, borderRadius: 3, transition: "width 0.4s ease" }} />
        </div>
      </div>
    );
  };

  const calPct = Math.min((totals.calories / targets.calories) * 100, 100);
  const calOver = remaining.calories < 0;

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#faf7f2", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Mono', monospace", color: "#9a9a9a", fontSize: 12, letterSpacing: 2 }}>
      LOADING...
    </div>
  );

  if (!token) return (
    <div style={{ minHeight: "100vh", background: "#faf7f2", color: "#2a2a2a", fontFamily: "'DM Mono', 'Courier New', monospace", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap'); input:focus { outline: none; border-color: #a8c078 !important; }`}</style>
      <form onSubmit={(e) => { e.preventDefault(); if (tokenInput.trim()) { localStorage.setItem(TOKEN_KEY, tokenInput.trim()); setToken(tokenInput.trim()); setLoading(true); } }} style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ fontSize: 10, color: "#a8c078", letterSpacing: 3, marginBottom: 16 }}>FUEL LOG</div>
        <div style={{ fontSize: 12, color: "#6a6a6a", marginBottom: 20, lineHeight: 1.6 }}>Enter your access token to continue. You'll only need to do this once on this device.</div>
        <input type="password" autoFocus value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="paste token here" style={{ width: "100%", background: "#ffffff", border: "1px solid #dcd5cf", color: "#2a2a2a", borderRadius: 6, padding: "12px 14px", fontFamily: "inherit", fontSize: 13, marginBottom: 12 }} />
        {tokenError && <div style={{ color: "#e87979", fontSize: 11, marginBottom: 12 }}>{tokenError}</div>}
        <button type="submit" style={{ width: "100%", background: "#a8c078", color: "#111", border: "none", borderRadius: 6, padding: "12px 14px", fontFamily: "inherit", fontSize: 12, fontWeight: 500, cursor: "pointer", letterSpacing: 1, textTransform: "uppercase" }}>Unlock</button>
      </form>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#faf7f2", color: "#2a2a2a", fontFamily: "'DM Mono', 'Courier New', monospace", padding: "24px 16px", boxSizing: "border-box", maxWidth: 520, margin: "0 auto" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap'); * { box-sizing: border-box; } input:focus { outline: none; border-color: #a8c078 !important; }`}</style>

      {/* Whoop prompt */}
      {showWhoopPrompt && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }}>
          <div style={{ background: "#ffffff", border: "1px solid #dcd5cf", borderRadius: 16, padding: 24, width: "100%", maxWidth: 400 }}>
            <div style={{ fontSize: 10, color: "#a8c078", letterSpacing: 3, marginBottom: 4 }}>WHOOP CHECK-IN</div>
            <div style={{ fontSize: 16, color: "#2a2a2a", marginBottom: 16 }}>Daily metrics</div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: "#9a9a9a", marginBottom: 4 }}>DATE</div>
              <input type="date" value={whoopDate} onChange={e => setWhoopDate(e.target.value)} style={{ ...inputStyle, colorScheme: "light" }} />
            </div>
            {[["Strain", "strain", "0–21"], ["Calories Burned", "burned", "from Whoop"]].map(([label, key, hint]) => (
              <div key={key} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9a9a9a", marginBottom: 4 }}><span>{label.toUpperCase()}</span><span>{hint}</span></div>
                <input type="number" value={whoopForm[key]} onChange={e => setWhoopForm(f => ({ ...f, [key]: e.target.value }))} style={inputStyle} />
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={saveWhoopData} style={{ flex: 1, background: "#a8c078", color: "#111", border: "none", borderRadius: 8, padding: "11px", fontFamily: "inherit", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>SAVE</button>
              <button onClick={() => setShowWhoopPrompt(false)} style={{ flex: 1, background: "none", color: "#9a9a9a", border: "1px solid #dcd5cf", borderRadius: 8, padding: "11px", fontFamily: "inherit", fontSize: 12, cursor: "pointer" }}>SKIP</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 10, color: "#a8c078", letterSpacing: 3, textTransform: "uppercase", marginBottom: 4 }}>FUEL LOG</div>
          <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
            style={{ background: "none", border: "none", color: "#2a2a2a", fontSize: 20, fontFamily: "inherit", fontWeight: 500, cursor: "pointer", padding: 0, colorScheme: "light" }} />
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          {["log", "trends"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ background: tab === t ? "#a8c078" : "none", color: tab === t ? "#111" : "#9a9a9a", border: `1px solid ${tab === t ? "#a8c078" : "#dcd5cf"}`, borderRadius: 6, padding: "6px 12px", fontFamily: "inherit", fontSize: 10, cursor: "pointer", letterSpacing: 1, textTransform: "uppercase" }}>{t}</button>
          ))}
        </div>
      </div>

      {tab === "log" && <>
        {/* Summary */}
        <div style={{ background: "#ffffff", border: "1px solid #dcd5cf", borderRadius: 12, padding: "20px", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 20 }}>
            <div style={{ position: "relative", flexShrink: 0 }}>
              <svg width="80" height="80" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="32" fill="none" stroke="#dcd5cf" strokeWidth="8" />
                <circle cx="40" cy="40" r="32" fill="none" stroke={calOver ? "#c97c7c" : "#a8c078"} strokeWidth="8"
                  strokeDasharray={`${2 * Math.PI * 32}`} strokeDashoffset={`${2 * Math.PI * 32 * (1 - calPct / 100)}`}
                  strokeLinecap="round" transform="rotate(-90 40 40)" style={{ transition: "stroke-dashoffset 0.5s ease" }} />
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: calOver ? "#c97c7c" : "#a8c078" }}>{Math.round(calPct)}%</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 36, fontWeight: 500, color: calOver ? "#c97c7c" : "#a8c078", lineHeight: 1 }}>{totals.calories}</div>
              <div style={{ fontSize: 11, color: "#9a9a9a", marginTop: 4 }}>of <span style={{ color: "#6a6a6a" }}>{targets.calories}</span> kcal target</div>
              <div style={{ fontSize: 13, color: calOver ? "#c97c7c" : "#7a9ec0", marginTop: 6, fontWeight: 500 }}>
                {calOver ? `▲ ${Math.abs(remaining.calories)} over` : `▼ ${remaining.calories} under`}
              </div>
            </div>
          </div>
          <MacroRow label="Protein" eaten={totals.protein} target={targets.protein} color="#a8c078" />
          <MacroRow label="Carbs" eaten={totals.carbs} target={targets.carbs} color="#7a9ec0" />
          <MacroRow label="Fat" eaten={totals.fat} target={targets.fat} color="#c89878" />
          {whoopData[selectedDate] && (() => {
            const w = whoopData[selectedDate];
            const recoveryColor = w.recovery >= 67 ? "#a8c078" : w.recovery >= 34 ? "#c9b078" : "#c97c7c";
            return (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #ece5df", display: "flex", justifyContent: "space-between" }}>
                {w.recovery && <div style={{ textAlign: "center" }}><div style={{ fontSize: 16, fontWeight: 500, color: recoveryColor }}>{w.recovery}%</div><div style={{ fontSize: 9, color: "#b8b8b8", marginTop: 2 }}>RECOVERY</div></div>}
                {w.strain && <div style={{ textAlign: "center" }}><div style={{ fontSize: 16, fontWeight: 500, color: "#7a9ec0" }}>{w.strain}</div><div style={{ fontSize: 9, color: "#b8b8b8", marginTop: 2 }}>STRAIN</div></div>}
                {w.sleep && <div style={{ textAlign: "center" }}><div style={{ fontSize: 16, fontWeight: 500, color: "#2a2a2a" }}>{w.sleep}h</div><div style={{ fontSize: 9, color: "#b8b8b8", marginTop: 2 }}>SLEEP</div></div>}
                {w.burned && <div style={{ textAlign: "center" }}><div style={{ fontSize: 16, fontWeight: 500, color: "#c89878" }}>{w.burned}</div><div style={{ fontSize: 9, color: "#b8b8b8", marginTop: 2 }}>BURNED</div></div>}
                {w.burned && <div style={{ textAlign: "center" }}><div style={{ fontSize: 16, fontWeight: 500, color: (w.burned - totals.calories) > 0 ? "#a8c078" : "#c97c7c" }}>{Math.abs(w.burned - totals.calories)}</div><div style={{ fontSize: 9, color: "#b8b8b8", marginTop: 2 }}>NET</div></div>}
              </div>
            );
          })()}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: "#dcd5cf", letterSpacing: 1 }}>TARGETS: {targets.calories} · {targets.protein}P · {targets.carbs}C · {targets.fat}F</div>
          <button onClick={() => openWhoopPrompt(selectedDate)} style={{ background: "none", border: "1px solid #dcd5cf", color: "#9a9a9a", borderRadius: 6, padding: "4px 10px", fontFamily: "inherit", fontSize: 9, cursor: "pointer", letterSpacing: 1 }}>+ WHOOP</button>
        </div>

        {/* Entries */}
        <div style={{ marginBottom: 16 }}>
          {todayEntries.length === 0 && <div style={{ textAlign: "center", color: "#b8b8b8", padding: "32px 0", fontSize: 13 }}>No entries for this date</div>}
          {todayEntries.map(entry => (
            <div key={entry.id} style={{ background: "#f5f1ec", border: `1px solid ${editingId === entry.id ? "#b8b8b8" : "#ece5df"}`, borderRadius: 10, padding: "14px 16px", marginBottom: 8 }}>
              {editingId === entry.id ? (
                <div>
                  <div style={{ fontSize: 10, color: "#a8c078", letterSpacing: 2, marginBottom: 10 }}>EDIT</div>
                  {[["Name","name","text"],["Calories","calories","number"],["Protein","protein","number"],["Carbs","carbs","number"],["Fat","fat","number"]].map(([label, key, type]) => (
                    <div key={key} style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 10, color: "#9a9a9a", marginBottom: 3 }}>{label.toUpperCase()}</div>
                      <input type={type} value={editForm[key]} onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))} style={inputStyle} />
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button onClick={saveEdit} style={{ flex: 1, background: "#a8c078", color: "#111", border: "none", borderRadius: 8, padding: "9px", fontFamily: "inherit", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>SAVE</button>
                    <button onClick={() => setEditingId(null)} style={{ flex: 1, background: "#ffffff", color: "#7a7a7a", border: "1px solid #dcd5cf", borderRadius: 8, padding: "9px", fontFamily: "inherit", fontSize: 12, cursor: "pointer" }}>CANCEL</button>
                    <button onClick={() => { handleDelete(entry.id); setEditingId(null); }} style={{ background: "#ffffff", color: "#c97c7c", border: "1px solid #dcd5cf", borderRadius: 8, padding: "9px 12px", fontFamily: "inherit", fontSize: 12, cursor: "pointer" }}>DELETE</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ flex: 1, cursor: "pointer" }} onClick={() => startEdit(entry)}>
                    <div style={{ fontSize: 14, color: "#2a2a2a", marginBottom: 4 }}>{entry.name}</div>
                    <div style={{ fontSize: 11 }}>
                      {entry.time && <span style={{ color: "#b8b8b8", marginRight: 10 }}>{entry.time}</span>}
                      {entry.protein > 0 && <span style={{ color: "#a8c078", marginRight: 8 }}>{entry.protein}g P</span>}
                      {entry.carbs > 0 && <span style={{ color: "#7a9ec0", marginRight: 8 }}>{entry.carbs}g C</span>}
                      {entry.fat > 0 && <span style={{ color: "#c89878" }}>{entry.fat}g F</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 16, color: "#a8c078", fontWeight: 500 }}>{entry.calories}</span>
                    <button onClick={() => toggleFavorite(entry)} title={isFavorite(entry.name) ? "Remove from favorites" : "Save as favorite"}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1, color: isFavorite(entry.name) ? "#c9b078" : "#b8b8b8" }}>
                      {isFavorite(entry.name) ? "★" : "☆"}
                    </button>
                    <button onClick={() => startEdit(entry)} style={{ background: "none", border: "none", color: "#b8b8b8", cursor: "pointer", fontSize: 11, letterSpacing: 1 }}>EDIT</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add form */}
        {showForm ? (
          <div style={{ background: "#ffffff", border: "1px solid #dcd5cf", borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 10, color: "#a8c078", letterSpacing: 2, marginBottom: 14 }}>ADD ENTRY</div>
            {favorites.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#9a9a9a", marginBottom: 6, letterSpacing: 1 }}>FAVORITES — TAP TO LOG</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {favorites.map(fav => (
                    <button key={fav.id} onClick={() => logFavorite(fav)} title={`${fav.calories} cal · ${fav.protein}p / ${fav.carbs}c / ${fav.fat}f`}
                      style={{ background: "#eaf2dc", border: "1px solid #c8d8a8", color: "#3a4a1a", borderRadius: 16, padding: "5px 10px", fontFamily: "inherit", fontSize: 11, cursor: "pointer" }}>
                      {fav.name} <span style={{ color: "#7a8a5a", fontSize: 10 }}>· {fav.calories}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div style={{ marginBottom: 10, position: "relative" }}>
              <div style={{ fontSize: 10, color: "#9a9a9a", marginBottom: 4 }}>FOOD NAME</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} onKeyDown={e => e.key === "Enter" && handleLookup()} placeholder="e.g. 6 oz salmon" style={{ ...inputStyle, flex: 1 }} autoComplete="off" />
                <button onClick={handleLookup} disabled={lookingUp || !form.name} style={{ background: lookingUp ? "#dcd5cf" : "#eaf2dc", color: lookingUp ? "#9a9a9a" : "#a8c078", border: "1px solid #3a4a1a", borderRadius: 6, padding: "0 12px", fontFamily: "inherit", fontSize: 11, cursor: lookingUp ? "default" : "pointer", whiteSpace: "nowrap" }}>
                  {lookingUp ? "..." : "AI"}
                </button>
                <label style={{ background: lookingUp ? "#dcd5cf" : "#eaf2dc", color: lookingUp ? "#9a9a9a" : "#a8c078", border: "1px solid #3a4a1a", borderRadius: 6, padding: "8px 10px", fontFamily: "inherit", fontSize: 11, cursor: lookingUp ? "default" : "pointer", whiteSpace: "nowrap", display: "flex", alignItems: "center" }}>
                  📷
                  <input type="file" accept="image/*" capture="environment" onChange={handlePhotoUpload} disabled={lookingUp} style={{ display: "none" }} />
                </label>
              </div>
              {matchingFoods.length > 0 && form.name && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#ffffff", border: "1px solid #dcd5cf", borderRadius: 6, marginTop: 2, zIndex: 50, boxShadow: "0 4px 12px rgba(0,0,0,0.06)" }}>
                  {matchingFoods.map((f, i) => (
                    <button key={f.id} type="button" onClick={() => setForm(prev => ({ ...prev, name: f.name, calories: String(f.calories), protein: String(f.protein), carbs: String(f.carbs), fat: String(f.fat) }))}
                      style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderTop: i === 0 ? "none" : "1px solid #f0ece8", padding: "8px 12px", fontFamily: "inherit", fontSize: 12, color: "#2a2a2a", cursor: "pointer" }}>
                      <span style={{ fontWeight: 500 }}>{f.name}</span>
                      <span style={{ color: "#9a9a9a", fontSize: 11, marginLeft: 8 }}>{f.calories} cal · {f.protein}p / {f.carbs}c / {f.fat}f</span>
                    </button>
                  ))}
                </div>
              )}
              {!form.calories && <div style={{ fontSize: 10, color: "#b8b8b8", marginTop: 4 }}>Type to autocomplete · tap AI for text lookup · 📷 for label OR plate photo</div>}
            </div>
            {[["Calories","calories","number"],["Protein (g)","protein","number"],["Carbs (g)","carbs","number"],["Fat (g)","fat","number"]].map(([label, key, type]) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: "#9a9a9a", marginBottom: 4 }}>{label.toUpperCase()}</div>
                <input type={type} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} style={inputStyle} />
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button onClick={handleAdd} disabled={!form.name || !form.calories} style={{ flex: 1, background: form.name && form.calories ? "#a8c078" : "#dcd5cf", color: form.name && form.calories ? "#111" : "#9a9a9a", border: "none", borderRadius: 8, padding: "10px", fontFamily: "inherit", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>ADD</button>
              <button onClick={() => { setShowForm(false); setForm({ name: "", calories: "", protein: "", carbs: "", fat: "" }); }} style={{ flex: 1, background: "#ffffff", color: "#7a7a7a", border: "1px solid #dcd5cf", borderRadius: 8, padding: "10px", fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>CANCEL</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowForm(true)} style={{ width: "100%", background: "none", border: "1px dashed #dcd5cf", color: "#b8b8b8", borderRadius: 10, padding: "14px", fontFamily: "inherit", fontSize: 11, cursor: "pointer", letterSpacing: 2, marginTop: 4 }}
            onMouseEnter={e => { e.target.style.borderColor = "#9a9a9a"; e.target.style.color = "#7a7a7a"; }}
            onMouseLeave={e => { e.target.style.borderColor = "#dcd5cf"; e.target.style.color = "#b8b8b8"; }}>
            + ADD MANUALLY
          </button>
        )}
      </>}

      {tab === "trends" && (
        <div>
          {trendData.length < 2 ? <div style={{ textAlign: "center", color: "#b8b8b8", padding: "48px 0" }}>Need at least 2 days of data</div> : <>
            {/* Weekly deficit card */}
            {(() => {
              const weekCalories = trendData.reduce((s, d) => s + d.calories, 0);
              const weekBurned = trendData.reduce((s, d) => s + (d.burned || targets.calories), 0);
              const weekDeficit = weekBurned - weekCalories;
              const estLbs = (weekDeficit / 3500).toFixed(2);
              const over = weekDeficit < 0;
              const usingActual = trendData.some(d => d.burned);
              return (
                <div style={{ background: "#ffffff", border: `1px solid ${over ? "#f3d6d6" : "#dde8d6"}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: "#6a6a6a", letterSpacing: 2 }}>WEEKLY DEFICIT ({trendData.length} DAYS)</div>
                    <div style={{ fontSize: 9, color: usingActual ? "#a8c078" : "#b8b8b8" }}>{usingActual ? "WHOOP DATA" : "EST. TDEE"}</div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 32, fontWeight: 500, color: over ? "#c97c7c" : "#a8c078", lineHeight: 1 }}>{Math.abs(weekDeficit).toLocaleString()}</div>
                      <div style={{ fontSize: 11, color: "#9a9a9a", marginTop: 4 }}>{over ? "cal surplus" : "cal deficit"}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 22, fontWeight: 500, color: over ? "#c97c7c" : "#a8c078" }}>{over ? "+" : "-"}{Math.abs(estLbs)} lbs</div>
                      <div style={{ fontSize: 11, color: "#9a9a9a", marginTop: 4 }}>est. weight change</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #dcd5cf", display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9a9a9a" }}>
                    <span>Consumed: <span style={{ color: "#6a6a6a" }}>{weekCalories.toLocaleString()}</span></span>
                    <span>Burned: <span style={{ color: "#6a6a6a" }}>{weekBurned.toLocaleString()}</span></span>
                  </div>
                </div>
              );
            })()}

            {/* Calories vs Burned */}
            <div style={{ background: "#ffffff", border: "1px solid #dcd5cf", borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: "#a8c078", letterSpacing: 2, marginBottom: 16 }}>CALORIES VS BURNED</div>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={trendData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fill: "#9a9a9a", fontSize: 10, fontFamily: "DM Mono" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#9a9a9a", fontSize: 10, fontFamily: "DM Mono" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #dcd5cf", borderRadius: 8, fontFamily: "DM Mono", fontSize: 11 }} labelStyle={{ color: "#6a6a6a" }} formatter={(v, n) => [v, n === "calories" ? "Eaten" : "Burned"]} />
                  <Legend wrapperStyle={{ fontSize: 10, fontFamily: "DM Mono", paddingTop: 8 }} formatter={n => n === "calories" ? "Eaten" : "Burned (Whoop)"} />
                  <Bar dataKey="calories" fill="#a8c078" radius={[3,3,0,0]} opacity={0.85} />
                  <Bar dataKey="burned" fill="#7a9ec0" radius={[3,3,0,0]} opacity={0.6} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Daily deficit line */}
            <div style={{ background: "#ffffff", border: "1px solid #dcd5cf", borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: "#6a6a6a", letterSpacing: 2, marginBottom: 4 }}>DAILY DEFICIT</div>
              <div style={{ fontSize: 10, color: "#b8b8b8", marginBottom: 16 }}>+ = deficit · − = surplus · blue dot = Whoop actual</div>
              <ResponsiveContainer width="100%" height={130}>
                <LineChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fill: "#9a9a9a", fontSize: 10, fontFamily: "DM Mono" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#9a9a9a", fontSize: 10, fontFamily: "DM Mono" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #dcd5cf", borderRadius: 8, fontFamily: "DM Mono", fontSize: 11 }} labelStyle={{ color: "#6a6a6a" }} formatter={(v) => [`${v > 0 ? "-" : "+"}${Math.abs(v)} cal`, "Deficit"]} />
                  <Line type="monotone" dataKey="deficit" stroke="#a8c078" strokeWidth={2}
                    dot={(props) => { const { cx, cy, payload } = props; return <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={4} fill={payload.burned ? "#7a9ec0" : "#a8c078"} stroke="none" />; }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Macros */}
            <div style={{ background: "#ffffff", border: "1px solid #dcd5cf", borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: "#6a6a6a", letterSpacing: 2, marginBottom: 16 }}>MACROS (g)</div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={trendData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fill: "#9a9a9a", fontSize: 10, fontFamily: "DM Mono" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#9a9a9a", fontSize: 10, fontFamily: "DM Mono" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #dcd5cf", borderRadius: 8, fontFamily: "DM Mono", fontSize: 11 }} labelStyle={{ color: "#6a6a6a" }} />
                  <Legend wrapperStyle={{ fontSize: 10, fontFamily: "DM Mono", paddingTop: 8 }} />
                  <Line type="monotone" dataKey="protein" stroke="#a8c078" strokeWidth={2} dot={{ fill: "#a8c078", r: 3 }} />
                  <Line type="monotone" dataKey="carbs" stroke="#7a9ec0" strokeWidth={2} dot={{ fill: "#7a9ec0", r: 3 }} />
                  <Line type="monotone" dataKey="fat" stroke="#c89878" strokeWidth={2} dot={{ fill: "#c89878", r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Cumulative progress (all time) */}
            {(() => {
              const surplus = cumDeficit < 0;
              return (
                <div style={{ background: "#ffffff", border: `2px solid ${surplus ? "#f3d6d6" : "#dde8d6"}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: "#6a6a6a", letterSpacing: 2 }}>CUMULATIVE — ALL TIME ({allTimeData.length} DAYS)</div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 36, fontWeight: 500, color: surplus ? "#c97c7c" : "#a8c078", lineHeight: 1 }}>{Math.abs(cumDeficit).toLocaleString()}</div>
                      <div style={{ fontSize: 11, color: "#9a9a9a", marginTop: 4 }}>total cal {surplus ? "surplus" : "deficit"}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 28, fontWeight: 500, color: surplus ? "#c97c7c" : "#a8c078" }}>{surplus ? "+" : "-"}{Math.abs(cumLbs)} lbs</div>
                      <div style={{ fontSize: 11, color: "#9a9a9a", marginTop: 4 }}>projected change</div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Cumulative weight loss trend */}
            <div style={{ background: "#ffffff", border: "1px solid #dcd5cf", borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: "#6a6a6a", letterSpacing: 2, marginBottom: 4 }}>CUMULATIVE WEIGHT LOSS</div>
              <div style={{ fontSize: 10, color: "#b8b8b8", marginBottom: 16 }}>projected · based on 3500 cal ≈ 1 lb</div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={allTimeData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fill: "#9a9a9a", fontSize: 10, fontFamily: "DM Mono" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#9a9a9a", fontSize: 10, fontFamily: "DM Mono" }} axisLine={false} tickLine={false} tickFormatter={v => `${v} lb`} />
                  <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #dcd5cf", borderRadius: 8, fontFamily: "DM Mono", fontSize: 11 }} labelStyle={{ color: "#6a6a6a" }} formatter={(v) => [`${v} lbs`, "Projected loss"]} />
                  <Line type="monotone" dataKey="cumulativeLbs" stroke="#a8c078" strokeWidth={2} dot={{ fill: "#a8c078", r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Daily summary */}
            <div style={{ background: "#ffffff", border: "1px solid #dcd5cf", borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 10, color: "#6a6a6a", letterSpacing: 2, marginBottom: 12 }}>DAILY SUMMARY</div>
              {[...trendData].reverse().map(d => {
                const over = d.deficit < 0;
                return (
                  <div key={d.date} style={{ padding: "10px 0", borderBottom: "1px solid #f5f1ec" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: "#6a6a6a" }}>{d.date}</span>
                      <div style={{ display: "flex", gap: 12 }}>
                        <span style={{ fontSize: 13, color: "#a8c078", fontWeight: 500 }}>{d.calories} eaten</span>
                        {d.burned && <span style={{ fontSize: 13, color: "#7a9ec0", fontWeight: 500 }}>{d.burned} burned</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <div style={{ fontSize: 11 }}>
                        <span style={{ color: "#a8c078", marginRight: 8 }}>{d.protein}g P</span>
                        <span style={{ color: "#7a9ec0", marginRight: 8 }}>{d.carbs}g C</span>
                        <span style={{ color: "#c89878" }}>{d.fat}g F</span>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 500, color: over ? "#c97c7c" : "#a8c078" }}>
                        {over ? `▲ ${Math.abs(d.deficit)} surplus` : `▼ ${d.deficit} deficit`}
                        {!d.burned && <span style={{ color: "#b8b8b8", fontSize: 10 }}> est.</span>}
                      </span>
                    </div>
                    {(d.recovery || d.strain || d.sleep) && (
                      <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 10 }}>
                        {d.recovery && <span style={{ color: d.recovery >= 67 ? "#a8c078" : d.recovery >= 34 ? "#c9b078" : "#c97c7c" }}>R:{d.recovery}%</span>}
                        {d.strain && <span style={{ color: "#c89878" }}>S:{d.strain}</span>}
                        {d.sleep && <span style={{ color: "#7a9ec0" }}>💤{d.sleep}h</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>}
        </div>
      )}
    </div>
  );
}
