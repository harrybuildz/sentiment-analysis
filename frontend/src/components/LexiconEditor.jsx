import { useEffect, useMemo, useState } from "react";
import {
  Settings as SettingsIcon,
  Loader2,
  AlertCircle,
  Plus,
  Trash2,
  Search,
  RotateCcw,
  Save,
  CheckCircle2,
  Info,
} from "lucide-react";
import { api } from "../api";

/**
 * Lexicon tab — view, add, edit, delete, and reset the custom phrase lexicon
 * used by the lexicon-based scorer (and surfaced in matched_phrases on the
 * LLM/transformer paths for reference).
 *
 * Server-side validation constrains:
 *   - phrase: 1..200 chars, lower-cased & stripped on input
 *   - weight: -1.0..1.0
 *
 * We mirror that client-side so users see inline feedback before the PUT.
 */
export default function LexiconEditor() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Form state for the "add new" row.
  const [newPhrase, setNewPhrase] = useState("");
  const [newWeight, setNewWeight] = useState(0);
  const [addingBusy, setAddingBusy] = useState(false);
  const [addingError, setAddingError] = useState(null);

  // Filter box
  const [query, setQuery] = useState("");

  // Row-level state for edit/save/delete
  const [drafts, setDrafts] = useState({}); // { phrase: weight }
  const [rowBusy, setRowBusy] = useState({}); // { phrase: "saving" | "deleting" }
  const [rowFlash, setRowFlash] = useState({}); // { phrase: "saved" } — shows check briefly

  // Reset-to-defaults confirmation + progress
  const [resetBusy, setResetBusy] = useState(false);

  // -----------------------------------------------------------------------
  async function loadEntries() {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.listLexicon();
      setEntries(rows);
      setDrafts({}); // discard any unsaved edits on refresh
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEntries();
  }, []);

  // -----------------------------------------------------------------------
  // Filtering + sorting. Sorted by |weight| desc so the strongest signals
  // float to the top; ties broken alphabetically by phrase.
  const visibleEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? entries.filter((e) => e.phrase.includes(q))
      : entries.slice();
    filtered.sort((a, b) => {
      const diff = Math.abs(b.weight) - Math.abs(a.weight);
      if (Math.abs(diff) > 1e-9) return diff;
      return a.phrase.localeCompare(b.phrase);
    });
    return filtered;
  }, [entries, query]);

  const stats = useMemo(() => {
    let pos = 0;
    let neg = 0;
    let neu = 0;
    for (const e of entries) {
      if (e.weight > 0) pos += 1;
      else if (e.weight < 0) neg += 1;
      else neu += 1;
    }
    return { total: entries.length, pos, neg, neu };
  }, [entries]);

  // -----------------------------------------------------------------------
  // Add new entry
  // -----------------------------------------------------------------------
  async function handleAdd(e) {
    if (e) e.preventDefault();
    const phrase = newPhrase.trim().toLowerCase();
    const weight = Number(newWeight);
    const validation = validate(phrase, weight);
    if (validation) {
      setAddingError(validation);
      return;
    }
    setAddingBusy(true);
    setAddingError(null);
    try {
      const saved = await api.upsertLexicon(phrase, weight);
      // Upsert — replace if it already existed, else append.
      setEntries((prev) => {
        const i = prev.findIndex((x) => x.phrase === saved.phrase);
        if (i === -1) return [...prev, saved];
        const next = prev.slice();
        next[i] = saved;
        return next;
      });
      setNewPhrase("");
      setNewWeight(0);
      flashSaved(saved.phrase);
    } catch (err) {
      setAddingError(err.message);
    } finally {
      setAddingBusy(false);
    }
  }

  // -----------------------------------------------------------------------
  // Edit existing row
  // -----------------------------------------------------------------------
  function onDraftChange(phrase, value) {
    setDrafts((prev) => ({ ...prev, [phrase]: value }));
  }

  async function handleSaveRow(phrase) {
    const raw = drafts[phrase];
    const weight = Number(raw);
    const validation = validate(phrase, weight);
    if (validation) {
      setError(validation);
      return;
    }
    setRowBusy((prev) => ({ ...prev, [phrase]: "saving" }));
    try {
      const saved = await api.upsertLexicon(phrase, weight);
      setEntries((prev) =>
        prev.map((x) => (x.phrase === saved.phrase ? saved : x))
      );
      // Drop the draft — the row now reflects server truth.
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[phrase];
        return next;
      });
      flashSaved(phrase);
    } catch (err) {
      setError(`Save failed for "${phrase}": ${err.message}`);
    } finally {
      setRowBusy((prev) => {
        const next = { ...prev };
        delete next[phrase];
        return next;
      });
    }
  }

  async function handleDelete(phrase) {
    if (!window.confirm(`Delete "${phrase}" from the lexicon?`)) return;
    setRowBusy((prev) => ({ ...prev, [phrase]: "deleting" }));
    try {
      await api.deleteLexicon(phrase);
      setEntries((prev) => prev.filter((x) => x.phrase !== phrase));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[phrase];
        return next;
      });
    } catch (err) {
      setError(`Delete failed for "${phrase}": ${err.message}`);
    } finally {
      setRowBusy((prev) => {
        const next = { ...prev };
        delete next[phrase];
        return next;
      });
    }
  }

  // -----------------------------------------------------------------------
  // Reset-to-defaults
  // -----------------------------------------------------------------------
  async function handleReset() {
    if (
      !window.confirm(
        "Reset lexicon to defaults? Your custom edits will be lost."
      )
    )
      return;
    setResetBusy(true);
    setError(null);
    try {
      const rows = await api.resetLexicon();
      setEntries(rows);
      setDrafts({});
    } catch (err) {
      setError(`Reset failed: ${err.message}`);
    } finally {
      setResetBusy(false);
    }
  }

  // -----------------------------------------------------------------------
  // Flash a "saved" checkmark next to a row for ~1.5s.
  function flashSaved(phrase) {
    setRowFlash((prev) => ({ ...prev, [phrase]: "saved" }));
    setTimeout(() => {
      setRowFlash((prev) => {
        const next = { ...prev };
        delete next[phrase];
        return next;
      });
    }, 1500);
  }

  // -----------------------------------------------------------------------
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl md:text-2xl font-bold text-slate-900 flex items-center gap-2">
          <SettingsIcon className="w-5 h-5 text-indigo-500" />
          Lexicon editor
        </h2>
        <button
          onClick={handleReset}
          disabled={resetBusy || loading}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
          title="Wipe and re-seed from defaults"
        >
          {resetBusy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RotateCcw className="w-4 h-4" />
          )}
          Reset to defaults
        </button>
      </div>
      <p className="text-slate-600 text-sm mb-4">
        Phrases and their weights drive the lexicon-based scorer. Positive
        weights (&gt; 0) push sentiment up; negative weights pull it down.
        Weight range is <code>-1.0</code> to <code>1.0</code>.
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Stats strip */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <MiniStat label="Total phrases" value={stats.total} />
        <MiniStat
          label="Positive"
          value={stats.pos}
          tint="emerald"
        />
        <MiniStat
          label="Negative"
          value={stats.neg}
          tint="rose"
        />
        <MiniStat label="Neutral" value={stats.neu} />
      </div>

      {/* Add new row */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">
          Add or update a phrase
        </h3>
        <form
          onSubmit={handleAdd}
          className="flex flex-col md:flex-row md:items-end gap-3"
        >
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Phrase
            </label>
            <input
              type="text"
              value={newPhrase}
              onChange={(e) => setNewPhrase(e.target.value)}
              placeholder='e.g. "works flawlessly"'
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
              maxLength={200}
            />
          </div>
          <div className="md:w-64">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Weight{" "}
              <span className="font-normal text-slate-400">
                ({Number(newWeight).toFixed(2)})
              </span>
            </label>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.05}
              value={newWeight}
              onChange={(e) => setNewWeight(parseFloat(e.target.value))}
              className="w-full accent-indigo-600"
            />
            <div
              className="flex justify-between text-slate-400 mt-0.5"
              style={{ fontSize: "10px" }}
            >
              <span>-1.00</span>
              <span>0.00</span>
              <span>+1.00</span>
            </div>
          </div>
          <button
            type="submit"
            disabled={addingBusy}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-1.5 whitespace-nowrap"
          >
            {addingBusy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            Add / update
          </button>
        </form>

        {addingError && (
          <div className="mt-3 flex items-start gap-2 text-xs text-rose-700">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>{addingError}</span>
          </div>
        )}

        <div className="mt-3 flex items-start gap-2 text-xs text-slate-500">
          <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            Adding an existing phrase updates its weight (upsert). Phrases are
            normalized to lowercase.
          </span>
        </div>
      </div>

      {/* Filter */}
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter phrases…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        <span className="text-xs text-slate-500 whitespace-nowrap">
          {visibleEntries.length} of {entries.length}
        </span>
      </div>

      {/* Entries */}
      {loading && entries.length === 0 ? (
        <div className="flex items-center gap-2 text-slate-600 text-sm py-8">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading lexicon…
        </div>
      ) : visibleEntries.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500 text-sm">
          {entries.length === 0
            ? "No lexicon entries yet. Add one above, or reset to defaults."
            : "No phrases match your filter."}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <ul className="divide-y divide-slate-200">
            {visibleEntries.map((entry) => (
              <LexiconRow
                key={entry.phrase}
                entry={entry}
                draft={drafts[entry.phrase]}
                onDraftChange={(v) => onDraftChange(entry.phrase, v)}
                onSave={() => handleSaveRow(entry.phrase)}
                onDelete={() => handleDelete(entry.phrase)}
                busy={rowBusy[entry.phrase]}
                flash={rowFlash[entry.phrase]}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------
function LexiconRow({
  entry,
  draft,
  onDraftChange,
  onSave,
  onDelete,
  busy,
  flash,
}) {
  // `draft` holds the in-progress edited weight; if it's undefined, the row
  // is showing the committed weight from the server.
  const current = draft !== undefined ? Number(draft) : entry.weight;
  const dirty = draft !== undefined && Number(draft) !== entry.weight;
  const tint =
    current > 0
      ? "text-emerald-700"
      : current < 0
        ? "text-rose-700"
        : "text-slate-600";

  // Inline bar showing the weight as a signed value centered on 0.
  const barLeft = Math.min(50, 50 + current * 50); // left edge of bar
  const barWidth = Math.abs(current) * 50; // width of bar

  return (
    <li className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="font-mono text-sm text-slate-900 truncate">
          {entry.phrase}
        </div>
        <div
          className="text-slate-400 mt-0.5"
          style={{ fontSize: "11px" }}
        >
          Updated {new Date(entry.updated_at).toLocaleDateString()}
        </div>
      </div>

      {/* Slider + bar */}
      <div className="md:w-80 flex-shrink-0">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className={`font-medium ${tint}`}>
            {current > 0 ? "+" : ""}
            {current.toFixed(2)}
          </span>
          {dirty && (
            <span
              className="text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5"
              style={{ fontSize: "10px" }}
            >
              unsaved
            </span>
          )}
        </div>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.05}
          value={current}
          onChange={(e) => onDraftChange(parseFloat(e.target.value))}
          disabled={!!busy}
          className="w-full accent-indigo-600"
        />
        {/* Centered-on-zero track visualization (purely decorative) */}
        <div className="relative h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
          <div className="absolute inset-y-0 left-1/2 w-px bg-slate-300" />
          <div
            className={`absolute inset-y-0 ${
              current >= 0 ? "bg-emerald-400" : "bg-rose-400"
            }`}
            style={{
              left: `${barLeft}%`,
              width: `${barWidth}%`,
            }}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        {flash === "saved" && (
          <span className="inline-flex items-center gap-1 text-emerald-700 text-xs">
            <CheckCircle2 className="w-4 h-4" />
            Saved
          </span>
        )}
        <button
          onClick={onSave}
          disabled={!dirty || !!busy}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          title={dirty ? "Save weight change" : "No changes to save"}
        >
          {busy === "saving" ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          Save
        </button>
        <button
          onClick={onDelete}
          disabled={!!busy}
          className="p-1.5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600 disabled:opacity-50"
          title="Delete phrase"
        >
          {busy === "deleting" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
        </button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Small helper: stat card variant without icon
// ---------------------------------------------------------------------------
function MiniStat({ label, value, tint = "slate" }) {
  const tints = {
    slate: "bg-white border-slate-200 text-slate-900",
    emerald: "bg-emerald-50/50 border-emerald-200 text-emerald-900",
    rose: "bg-rose-50/50 border-rose-200 text-rose-900",
  };
  return (
    <div className={`rounded-xl border p-3 ${tints[tint] || tints.slate}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-bold mt-0.5">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Client-side mirror of the pydantic constraints on LexiconEntryIn. Returns
// an error string, or null if the input is valid.
// ---------------------------------------------------------------------------
function validate(phrase, weight) {
  if (!phrase || phrase.length === 0) return "Phrase is required.";
  if (phrase.length > 200) return "Phrase must be 200 characters or fewer.";
  if (!Number.isFinite(weight)) return "Weight must be a number.";
  if (weight < -1 || weight > 1)
    return "Weight must be between -1.0 and 1.0.";
  return null;
}
