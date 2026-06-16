import { useState, useEffect, useRef } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

const API = "";  // empty = same host
// Auth lives in an HttpOnly cookie set by /api/login. Browser sends it
// automatically with every same-origin request.
const apiFetch = (url, opts = {}) => fetch(url, {
  credentials: "same-origin",
  cache: "no-store", // never use browser cache for our API; always hit server
  ...opts,
});

// Magic link support: visiting /?token=XYZ calls /api/login to set the cookie,
// then strips the token from the URL.
async function tryMagicLinkLogin() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const t = params.get("token");
  if (!t || t.length < 32) return false;
  try {
    const r = await fetch("/api/auth?action=login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: t.trim() }),
      credentials: "same-origin",
    });
    if (!r.ok) return false;
  } catch { return false; }
  params.delete("token");
  const newSearch = params.toString();
  window.history.replaceState({}, "", window.location.pathname + (newSearch ? "?" + newSearch : ""));
  return true;
}
const fmt = (d) => { const [,m,day] = d.split("-"); return `${parseInt(m)}/${parseInt(day)}`; };

async function extractMacros({ text, image }) {
  const res = await fetch("/api/extract-macros", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, image }),
    credentials: "same-origin", // browser sends fl_token cookie automatically
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

// Portion-scaling modal for favorites. Lets the user pick the amount before logging,
// and edit the favorite's unit/base_amount/macros inline.
function FavoritePortionModal({ state, setState, onLog, onSave }) {
  const { fav, editing } = state;
  const [amount, setAmount] = useState(String(fav.base_amount || 1));
  const [editing_, setEditing] = useState(editing);
  const [form, setForm] = useState({
    name: fav.name,
    unit: fav.unit || "serving",
    base_amount: String(fav.base_amount || 1),
    calories: String(fav.calories),
    protein: String(fav.protein),
    carbs: String(fav.carbs),
    fat: String(fav.fat),
  });
  const [saving, setSaving] = useState(false);

  const base = parseFloat(fav.base_amount) || 1;
  const amt = parseFloat(amount) || 0;
  const scale = amt / base;
  const scaled = {
    calories: Math.round(fav.calories * scale),
    protein: Math.round(fav.protein * scale),
    carbs: Math.round(fav.carbs * scale),
    fat: Math.round(fav.fat * scale),
  };

  const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 24 };
  const card = { background: "#ffffff", border: "1px solid #dcd5cf", borderRadius: 16, padding: 22, width: "100%", maxWidth: 380 };
  const lbl = { fontSize: 10, color: "#9a9a9a", letterSpacing: 2, marginBottom: 4 };
  const ip = { width: "100%", background: "#faf7f2", border: "1px solid #dcd5cf", borderRadius: 6, padding: "10px 12px", fontFamily: "inherit", fontSize: 14, color: "#2a2a2a" };
  const btn = (primary) => ({ flex: 1, background: primary ? "#a8c078" : "#ffffff", color: primary ? "#111" : "#7a7a7a", border: primary ? "none" : "1px solid #dcd5cf", borderRadius: 8, padding: "10px", fontFamily: "inherit", fontSize: 12, cursor: "pointer", letterSpacing: 1, textTransform: "uppercase" });

  const close = () => setState(null);

  if (!editing_) {
    const unitLabel = (fav.unit && fav.unit !== "serving") ? fav.unit : (fav.base_amount > 1 ? "servings" : "serving");
    return (
      <div style={overlay} onClick={close}>
        <div style={card} onClick={(e) => e.stopPropagation()}>
          <div style={{ fontSize: 10, color: "#a8c078", letterSpacing: 3, marginBottom: 6 }}>LOG FAVORITE</div>
          <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>{fav.name}</div>
          <div style={{ fontSize: 11, color: "#9a9a9a", marginBottom: 16 }}>
            {fav.calories} cal · {fav.protein}p / {fav.carbs}c / {fav.fat}f per {fav.base_amount || 1} {unitLabel}
          </div>

          <div style={lbl}>AMOUNT ({unitLabel.toUpperCase()})</div>
          <input type="number" step="any" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} style={ip} />

          <div style={{ background: "#f5f1ec", borderRadius: 8, padding: 12, margin: "14px 0", fontSize: 13 }}>
            <div style={{ fontSize: 10, color: "#9a9a9a", letterSpacing: 1, marginBottom: 4 }}>WILL LOG</div>
            <div><strong style={{ color: "#a8c078" }}>{scaled.calories}</strong> cal · {scaled.protein}p / {scaled.carbs}c / {scaled.fat}f</div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={close} style={btn(false)}>Cancel</button>
            <button onClick={() => onLog(fav, amt)} disabled={!amt} style={btn(true)}>Log</button>
          </div>

          <div style={{ textAlign: "center", marginTop: 12 }}>
            <button onClick={() => setEditing(true)} style={{ background: "none", border: "none", color: "#9a9a9a", fontSize: 11, cursor: "pointer", textDecoration: "underline" }}>edit favorite</button>
          </div>
        </div>
      </div>
    );
  }

  // Edit mode
  return (
    <div style={overlay} onClick={close}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 10, color: "#a8c078", letterSpacing: 3, marginBottom: 12 }}>EDIT FAVORITE</div>

        <div style={lbl}>NAME</div>
        <input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} style={{ ...ip, marginBottom: 10 }} />

        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 2 }}>
            <div style={lbl}>BASE AMOUNT</div>
            <input type="number" step="any" value={form.base_amount} onChange={(e) => setForm(f => ({ ...f, base_amount: e.target.value }))} style={{ ...ip, marginBottom: 10 }} />
          </div>
          <div style={{ flex: 3 }}>
            <div style={lbl}>UNIT</div>
            <select value={form.unit} onChange={(e) => setForm(f => ({ ...f, unit: e.target.value }))} style={{ ...ip, marginBottom: 10 }}>
              <option value="serving">serving</option>
              <option value="oz">oz</option>
              <option value="cup">cup</option>
              <option value="tbsp">tbsp</option>
              <option value="tsp">tsp</option>
              <option value="piece">piece</option>
              <option value="slice">slice</option>
              <option value="medium">medium</option>
            </select>
          </div>
        </div>

        <div style={{ fontSize: 11, color: "#9a9a9a", marginBottom: 10 }}>Macros below are PER {form.base_amount} {form.unit}.</div>

        {[["Calories", "calories"], ["Protein (g)", "protein"], ["Carbs (g)", "carbs"], ["Fat (g)", "fat"]].map(([label, key]) => (
          <div key={key}>
            <div style={lbl}>{label.toUpperCase()}</div>
            <input type="number" value={form[key]} onChange={(e) => setForm(f => ({ ...f, [key]: e.target.value }))} style={{ ...ip, marginBottom: 8 }} />
          </div>
        ))}

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={() => setEditing(false)} style={btn(false)}>Cancel</button>
          <button disabled={saving} onClick={async () => {
            setSaving(true);
            const updated = await onSave(fav, {
              name: form.name,
              unit: form.unit,
              base_amount: form.base_amount,
              calories: form.calories,
              protein: form.protein,
              carbs: form.carbs,
              fat: form.fat,
            });
            setSaving(false);
            // Reset the amount default to the new base + go back to log mode
            setAmount(String(updated.base_amount || 1));
            setEditing(false);
          }} style={btn(true)}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

// First-time setup wizard. Captures daily targets + burn-tracking preference.
function SetupWizard({ me, onDone }) {
  const [step, setStep] = useState(1);
  const [targets, setTargetsLocal] = useState({ calories: 2000, protein: 150, carbs: 200, fat: 65 });
  const [burnMethod, setBurnMethod] = useState("none"); // whoop | manual | tdee | none
  const [tdeeEstimate, setTdeeEstimate] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await fetch("/api/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targets),
        credentials: "same-origin",
      });
      const prefs = {
        setup_complete: true,
        has_whoop: burnMethod === "whoop",
        burn_method: burnMethod,
      };
      if (burnMethod === "tdee" && tdeeEstimate) prefs.daily_burn_estimate = parseInt(tdeeEstimate) || 0;
      await fetch("/api/auth?action=preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
        credentials: "same-origin",
      });
      // If user picked Whoop, kick straight into OAuth
      if (burnMethod === "whoop") {
        const r = await fetch("/api/whoop-mgmt?action=connect", { credentials: "same-origin", cache: "no-store" });
        const data = await r.json();
        if (data.url) { window.location.href = data.url; return; }
      }
      onDone();
    } catch (e) {
      alert(`Save failed: ${e.message}`);
    }
    setSaving(false);
  };

  const cardStyle = { background: "#ffffff", border: "1px solid #dcd5cf", borderRadius: 12, padding: 24, maxWidth: 480, width: "100%" };
  const labelStyle = { fontSize: 10, color: "#9a9a9a", letterSpacing: 2, marginBottom: 6 };
  const inputStyle = { width: "100%", background: "#faf7f2", border: "1px solid #dcd5cf", borderRadius: 6, padding: "10px 12px", fontFamily: "inherit", fontSize: 14, color: "#2a2a2a", marginBottom: 12 };
  const btnStyle = (primary) => ({ flex: 1, background: primary ? "#a8c078" : "#ffffff", color: primary ? "#111" : "#9a9a9a", border: primary ? "none" : "1px solid #dcd5cf", borderRadius: 6, padding: "10px", fontFamily: "inherit", fontSize: 12, cursor: "pointer", letterSpacing: 1, textTransform: "uppercase" });

  return (
    <div style={{ minHeight: "100vh", background: "#faf7f2", color: "#2a2a2a", fontFamily: "'DM Mono', 'Courier New', monospace", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap'); input:focus { outline: none; border-color: #a8c078 !important; }`}</style>
      <div style={cardStyle}>
        <div style={{ fontSize: 10, color: "#a8c078", letterSpacing: 3, marginBottom: 6 }}>FUEL LOG · WELCOME</div>
        <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 4 }}>Hi {me.name}, let's set up your account.</div>
        <div style={{ fontSize: 11, color: "#9a9a9a", marginBottom: 20 }}>Step {step} of 2</div>

        {step === 1 && (
          <>
            <div style={{ fontSize: 14, marginBottom: 16 }}>What are your daily targets?</div>
            {[["Calories", "calories"], ["Protein (g)", "protein"], ["Carbs (g)", "carbs"], ["Fat (g)", "fat"]].map(([label, key]) => (
              <div key={key}>
                <div style={labelStyle}>{label.toUpperCase()}</div>
                <input type="number" value={targets[key]} onChange={e => setTargetsLocal(t => ({ ...t, [key]: parseInt(e.target.value) || 0 }))} style={inputStyle} />
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={() => setStep(2)} style={btnStyle(true)}>Next →</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div style={{ fontSize: 14, marginBottom: 16 }}>How do you track calories burned?</div>
            {[
              ["whoop", "Whoop (auto-sync via API)"],
              ["manual", "I'll enter it manually each day"],
              ["tdee", "Use a fixed daily estimate (TDEE)"],
              ["none", "Don't track burn"],
            ].map(([val, label]) => (
              <div key={val} onClick={() => setBurnMethod(val)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: burnMethod === val ? "#eaf2dc" : "#faf7f2", border: `1px solid ${burnMethod === val ? "#a8c078" : "#dcd5cf"}`, borderRadius: 8, cursor: "pointer", marginBottom: 8, fontSize: 13 }}>
                <span style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${burnMethod === val ? "#a8c078" : "#dcd5cf"}`, background: burnMethod === val ? "#a8c078" : "transparent" }} />
                {label}
              </div>
            ))}
            {burnMethod === "tdee" && (
              <div style={{ marginTop: 12 }}>
                <div style={labelStyle}>YOUR DAILY ESTIMATE (KCAL)</div>
                <input type="number" value={tdeeEstimate} onChange={e => setTdeeEstimate(e.target.value)} placeholder="e.g. 2400" style={inputStyle} />
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={() => setStep(1)} style={btnStyle(false)}>← Back</button>
              <button onClick={save} disabled={saving || (burnMethod === "tdee" && !tdeeEstimate)} style={btnStyle(true)}>
                {saving ? "Saving…" : (burnMethod === "whoop" ? "Save & connect Whoop" : "Save & finish")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function FoodTracker() {
  // Local-date string (YYYY-MM-DD) — never use toISOString() for "today"
  // because that returns UTC and is wrong in non-UTC timezones late at night / early morning.
  const toLocalYMD = (d) => {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const today = toLocalYMD(new Date());
  const yesterday = toLocalYMD(new Date(Date.now() - 86400000));

  const [entries, setEntries] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [whoopData, setWhoopData] = useState({});
  const [whoopStatus, setWhoopStatus] = useState(null);
  const [me, setMe] = useState(null);  // { id, name, preferences }
  const [favoriteModal, setFavoriteModal] = useState(null); // { fav, editing }
  const [aiPortion, setAiPortion] = useState(null); // { name, unit, base_amount, calories, ... }
  const [aiAmount, setAiAmount] = useState("");
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
  const [authed, setAuthed] = useState(null);  // null = checking, true/false = known
  const [tokenInput, setTokenInput] = useState("");
  const [tokenError, setTokenError] = useState("");

  const initialLoadDone = useRef(false);

  // Load all data from API on mount. If unauthorized → show token form.
  // After successful auth: poll every 30s, refetch on tab focus.
  useEffect(() => {
    let cancelled = false;
    let interval;

    const loadAll = async (isInitial = false) => {
      try {
        const [u, e, w, t, f, ws] = await Promise.all([
          apiFetch(`${API}/api/auth?action=me`).then(r => { if (!r.ok) throw new Error("auth"); return r.json(); }),
          apiFetch(`${API}/api/entries`).then(r => { if (!r.ok) throw new Error("auth"); return r.json(); }),
          apiFetch(`${API}/api/whoop`).then(r => { if (!r.ok) throw new Error("auth"); return r.json(); }),
          apiFetch(`${API}/api/targets`).then(r => { if (!r.ok) throw new Error("auth"); return r.json(); }),
          apiFetch(`${API}/api/favorites`).then(r => { if (!r.ok) throw new Error("auth"); return r.json(); }),
          apiFetch(`${API}/api/whoop-mgmt?action=status`).then(r => r.ok ? r.json() : { connected: false }),
        ]);
        if (cancelled) return;
        setMe(u);
        setEntries(e);
        setWhoopData(w);
        setTargets(t);
        setFavorites(f);
        setWhoopStatus(ws);
        setAuthed(true);
        setLoading(false);
        setTokenError("");
        if (isInitial && !initialLoadDone.current) {
          initialLoadDone.current = true;
          const burnMethod = u?.preferences?.burn_method;
          if (burnMethod === "whoop") {
            // Always sync on app load — pulls latest finalized cycles silently.
            // (In-progress cycle is skipped server-side, so today's data won't appear until the cycle ends.)
            apiFetch(`${API}/api/whoop-mgmt?action=sync&days=3`)
              .then(r => r.json())
              .then(res => {
                if (res.ok) {
                  apiFetch(`${API}/api/whoop`).then(r => r.json()).then(setWhoopData);
                }
              })
              .catch(() => {});
          } else if (burnMethod === "manual" && (!w[yesterday] || !w[yesterday].burned)) {
            // Show the manual entry prompt as before
            setWhoopDate(yesterday);
            setTimeout(() => { if (!cancelled) setShowWhoopPrompt(true); }, 600);
          }
          // burn_method === "none" or "tdee" → no prompt, no sync
        }
      } catch (err) {
        if (cancelled) return;
        if (isInitial && err.message === "auth") {
          setAuthed(false);
          setLoading(false);
        }
        // For polling: silently keep last good state (transient 404s OK)
      }
    };

    const onVisible = () => { if (!document.hidden) loadAll(false); };

    (async () => {
      await tryMagicLinkLogin();
      if (cancelled) return;
      await loadAll(true);
      if (cancelled) return;
      interval = setInterval(() => loadAll(false), 30000);
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("focus", onVisible);
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

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

  // After AI returns macros, open the portion modal so the user can confirm
  // the amount (and see what unit/base AI used) before the macros land in the form.
  const openAiPortion = (macros) => {
    setAiPortion(macros);
    setAiAmount(String(macros.base_amount || 1));
  };

  const handleLookup = async () => {
    if (!form.name) return;
    setLookingUp(true);
    try {
      const macros = await extractMacros({ text: form.name });
      openAiPortion(macros);
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
      openAiPortion(macros);
    } catch (err) { alert(`Photo extraction failed: ${err.message}`); }
    setLookingUp(false);
    e.target.value = ""; // allow re-upload of same file
  };

  // Confirm the AI portion: scale macros to user's amount and fill the add form.
  const applyAiPortion = () => {
    if (!aiPortion) return;
    const base = parseFloat(aiPortion.base_amount) || 1;
    const amt = parseFloat(aiAmount) || 0;
    if (!amt) return;
    const scale = amt / base;
    const isServing = (aiPortion.unit || "serving") === "serving";
    const finalName = isServing
      ? (amt === 1 ? aiPortion.name : `${aiPortion.name} (x${amt})`)
      : `${aiPortion.name} ${amt}${aiPortion.unit}`;
    setForm(f => ({
      ...f,
      name: finalName,
      calories: String(Math.round((aiPortion.calories || 0) * scale)),
      protein: String(Math.round((aiPortion.protein || 0) * scale)),
      carbs: String(Math.round((aiPortion.carbs || 0) * scale)),
      fat: String(Math.round((aiPortion.fat || 0) * scale)),
    }));
    setAiPortion(null);
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

  const openFavoriteModal = (fav) => setFavoriteModal({ fav, editing: false });

  const logScaledFavorite = async (fav, amount) => {
    const base = fav.base_amount || 1;
    const scale = (parseFloat(amount) || 0) / base;
    const now = new Date();
    const time = now.toTimeString().slice(0, 5);
    const unit = fav.unit && fav.unit !== "serving" ? ` ${amount}${fav.unit}` : "";
    const payload = {
      date: selectedDate,
      time,
      name: fav.name + unit,
      calories: Math.round(fav.calories * scale),
      protein: Math.round(fav.protein * scale),
      carbs: Math.round(fav.carbs * scale),
      fat: Math.round(fav.fat * scale),
    };
    const res = await apiFetch(`${API}/api/entries`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const entry = await res.json();
    setEntries(prev => [...prev, entry]);
    setFavoriteModal(null);
  };

  const updateFavorite = async (fav, updates) => {
    const res = await apiFetch(`${API}/api/favorites/${fav.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    const updated = await res.json();
    setFavorites(prev => prev.map(f => f.id === fav.id ? updated : f));
    return updated;
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

  if (authed === false) return (
    <div style={{ minHeight: "100vh", background: "#faf7f2", color: "#2a2a2a", fontFamily: "'DM Mono', 'Courier New', monospace", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap'); input:focus { outline: none; border-color: #a8c078 !important; }`}</style>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const t = tokenInput.trim();
        if (!t) return;
        setTokenError("");
        try {
          const r = await fetch("/api/auth?action=login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: t }),
            credentials: "same-origin",
          });
          if (r.ok) {
            // Cookie set — reload to re-run the effect with auth in place
            window.location.reload();
          } else {
            setTokenError("Invalid token. Try again.");
          }
        } catch {
          setTokenError("Network error. Try again.");
        }
      }} style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ fontSize: 10, color: "#a8c078", letterSpacing: 3, marginBottom: 16 }}>FUEL LOG</div>
        <div style={{ fontSize: 12, color: "#6a6a6a", marginBottom: 20, lineHeight: 1.6 }}>Enter your access token to continue. You'll only need to do this once on this device.</div>
        <input type="password" autoFocus value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="paste token here" style={{ width: "100%", background: "#ffffff", border: "1px solid #dcd5cf", color: "#2a2a2a", borderRadius: 6, padding: "12px 14px", fontFamily: "inherit", fontSize: 13, marginBottom: 12 }} />
        {tokenError && <div style={{ color: "#e87979", fontSize: 11, marginBottom: 12 }}>{tokenError}</div>}
        <button type="submit" style={{ width: "100%", background: "#a8c078", color: "#111", border: "none", borderRadius: 6, padding: "12px 14px", fontFamily: "inherit", fontSize: 12, fontWeight: 500, cursor: "pointer", letterSpacing: 1, textTransform: "uppercase" }}>Unlock</button>
      </form>
    </div>
  );

  // Setup wizard for first-time users
  if (me && !me.preferences?.setup_complete) {
    return <SetupWizard me={me} onDone={() => window.location.reload()} />;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#faf7f2", color: "#2a2a2a", fontFamily: "'DM Mono', 'Courier New', monospace", padding: "24px 16px", boxSizing: "border-box", maxWidth: 520, margin: "0 auto" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap'); * { box-sizing: border-box; } input:focus { outline: none; border-color: #a8c078 !important; }`}</style>

      {favoriteModal && (
        <FavoritePortionModal
          state={favoriteModal}
          setState={setFavoriteModal}
          onLog={logScaledFavorite}
          onSave={updateFavorite}
        />
      )}

      {aiPortion && (() => {
        const base = parseFloat(aiPortion.base_amount) || 1;
        const amt = parseFloat(aiAmount) || 0;
        const scale = amt / base;
        const unitLabel = aiPortion.unit || "serving";
        const overlayStyle = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 24 };
        const cardStyle = { background: "#ffffff", border: "1px solid #dcd5cf", borderRadius: 16, padding: 22, width: "100%", maxWidth: 380 };
        const inputBox = { width: "100%", background: "#faf7f2", border: "1px solid #dcd5cf", borderRadius: 6, padding: "10px 12px", fontFamily: "inherit", fontSize: 14, color: "#2a2a2a" };
        const btn = (primary) => ({ flex: 1, background: primary ? "#a8c078" : "#ffffff", color: primary ? "#111" : "#7a7a7a", border: primary ? "none" : "1px solid #dcd5cf", borderRadius: 8, padding: "10px", fontFamily: "inherit", fontSize: 12, cursor: "pointer", letterSpacing: 1, textTransform: "uppercase" });
        return (
          <div style={overlayStyle} onClick={() => setAiPortion(null)}>
            <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
              <div style={{ fontSize: 10, color: "#a8c078", letterSpacing: 3, marginBottom: 6 }}>AI ESTIMATE</div>
              <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>{aiPortion.name}</div>
              <div style={{ fontSize: 11, color: "#9a9a9a", marginBottom: 16 }}>
                {aiPortion.calories} cal · {aiPortion.protein}p / {aiPortion.carbs}c / {aiPortion.fat}f per {aiPortion.base_amount} {unitLabel}
              </div>

              <div style={{ fontSize: 10, color: "#9a9a9a", letterSpacing: 2, marginBottom: 4 }}>HOW MUCH DID YOU HAVE? ({unitLabel.toUpperCase()})</div>
              <input type="number" step="any" autoFocus value={aiAmount} onChange={(e) => setAiAmount(e.target.value)} style={inputBox} />

              <div style={{ background: "#f5f1ec", borderRadius: 8, padding: 12, margin: "14px 0", fontSize: 13 }}>
                <div style={{ fontSize: 10, color: "#9a9a9a", letterSpacing: 1, marginBottom: 4 }}>WILL ENTER</div>
                <div><strong style={{ color: "#a8c078" }}>{Math.round((aiPortion.calories || 0) * scale)}</strong> cal · {Math.round((aiPortion.protein || 0) * scale)}p / {Math.round((aiPortion.carbs || 0) * scale)}c / {Math.round((aiPortion.fat || 0) * scale)}f</div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setAiPortion(null)} style={btn(false)}>Cancel</button>
                <button onClick={applyAiPortion} disabled={!amt} style={btn(true)}>Use</button>
              </div>
            </div>
          </div>
        );
      })()}

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
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button onClick={() => { const d = new Date(selectedDate + "T00:00:00"); d.setDate(d.getDate() - 1); setSelectedDate(toLocalYMD(d)); }}
              title="Previous day"
              style={{ background: "none", border: "none", color: "#9a9a9a", fontSize: 20, cursor: "pointer", padding: "0 6px", lineHeight: 1, fontFamily: "inherit" }}>‹</button>
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
              style={{ background: "none", border: "none", color: "#2a2a2a", fontSize: 20, fontFamily: "inherit", fontWeight: 500, cursor: "pointer", padding: 0, colorScheme: "light" }} />
            <button onClick={() => { const d = new Date(selectedDate + "T00:00:00"); d.setDate(d.getDate() + 1); setSelectedDate(toLocalYMD(d)); }}
              title="Next day"
              disabled={selectedDate >= today}
              style={{ background: "none", border: "none", color: selectedDate >= today ? "#dcd5cf" : "#9a9a9a", fontSize: 20, cursor: selectedDate >= today ? "default" : "pointer", padding: "0 6px", lineHeight: 1, fontFamily: "inherit" }}>›</button>
          </div>
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 8 }}>
          <div style={{ fontSize: 10, color: "#dcd5cf", letterSpacing: 1 }}>TARGETS: {targets.calories} · {targets.protein}P · {targets.carbs}C · {targets.fat}F</div>
          <div style={{ display: "flex", gap: 6 }}>
            {me?.preferences?.has_whoop && whoopStatus && !whoopStatus.connected && (
              <button onClick={async () => {
                const r = await apiFetch(`${API}/api/whoop-mgmt?action=connect`);
                const data = await r.json();
                if (data.url) window.location.href = data.url;
                else alert(data.error || "Failed to start Whoop OAuth");
              }} style={{ background: "#eaf2dc", border: "1px solid #c8d8a8", color: "#3a4a1a", borderRadius: 6, padding: "4px 10px", fontFamily: "inherit", fontSize: 9, cursor: "pointer", letterSpacing: 1 }}>CONNECT WHOOP</button>
            )}
            {me?.preferences?.has_whoop && whoopStatus && whoopStatus.connected && (
              <button onClick={async () => {
                const r = await apiFetch(`${API}/api/whoop-mgmt?action=sync&days=7`);
                const data = await r.json();
                alert(data.ok ? `Synced ${data.synced} day(s): ${data.dates.join(", ")}` : `Sync failed: ${data.error}`);
                if (data.ok) location.reload();
              }} title={whoopStatus.last_sync_at ? `Last sync: ${new Date(whoopStatus.last_sync_at).toLocaleString()} — ${whoopStatus.last_sync_status}` : "Never synced yet"}
                style={{ background: "none", border: "1px solid #dcd5cf", color: "#9a9a9a", borderRadius: 6, padding: "4px 10px", fontFamily: "inherit", fontSize: 9, cursor: "pointer", letterSpacing: 1 }}>SYNC WHOOP</button>
            )}
            {me?.preferences?.burn_method && me.preferences.burn_method !== "none" && (
              <button onClick={() => openWhoopPrompt(selectedDate)} style={{ background: "none", border: "1px solid #dcd5cf", color: "#9a9a9a", borderRadius: 6, padding: "4px 10px", fontFamily: "inherit", fontSize: 9, cursor: "pointer", letterSpacing: 1 }}>+ MANUAL</button>
            )}
          </div>
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
                    <button key={fav.id} onClick={() => openFavoriteModal(fav)}
                      title={`${fav.calories} cal per ${fav.base_amount || 1}${fav.unit && fav.unit !== "serving" ? fav.unit : " serving"}`}
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
              {matchingFoods.length > 0 && form.name && !form.calories && (
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
