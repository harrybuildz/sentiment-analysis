/**
 * Thin fetch wrapper for the backend API.
 *
 * All secrets (Anthropic key, Reddit creds) live server-side — this module
 * never needs them. It only needs the base URL, from VITE_API_BASE.
 */

const BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

async function request(path, { method = "GET", body, signal } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data && data.detail) detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {
      // response wasn't JSON — keep the status-only message
    }
    throw new Error(detail);
  }

  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  // Config / health
  getConfig: () => request("/api/config"),
  getHealth: () => request("/api/health"),

  // Analyze
  analyze: (payload) => request("/api/analyze", { method: "POST", body: payload }),

  // Analysis history
  listAnalyses: (limit = 50, offset = 0) =>
    request(`/api/analyses?limit=${limit}&offset=${offset}`),
  getAnalysis: (id) => request(`/api/analyses/${id}`),
  deleteAnalysis: (id) => request(`/api/analyses/${id}`, { method: "DELETE" }),

  // Lexicon
  listLexicon: () => request("/api/lexicon"),
  upsertLexicon: (phrase, weight) =>
    request("/api/lexicon", { method: "PUT", body: { phrase, weight } }),
  deleteLexicon: (phrase) =>
    request(`/api/lexicon/${encodeURIComponent(phrase)}`, { method: "DELETE" }),
  resetLexicon: () => request("/api/lexicon/reset", { method: "POST" }),
};
