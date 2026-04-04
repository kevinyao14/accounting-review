// ── Shared storage helpers ────────────────────────────────────────────────
// Single source of truth for all KV / Blob / utility functions used across
// serverless API endpoints. Import what you need:
//
//   import { kvGet, kvSet, kvDel, blobGet, encodePropertyName } from "../lib/storage.js";

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

// ── KV primitives ────────────────────────────────────────────────────────

export async function kvGet(key) {
  const res = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(["GET", key]),
  });
  const { result } = await res.json();
  return result;
}

export async function kvSet(key, value) {
  await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(["SET", key, value]),
  });
}

export async function kvDel(key) {
  await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(["DEL", key]),
  });
}

// ── Blob helpers ─────────────────────────────────────────────────────────

export async function blobGet(url) {
  if (!url) return null;
  try {
    // Support kv: prefix — seed-memory-direct.js stores small payloads
    // directly in KV and writes "kv:<key>" as the blob pointer.
    if (url.startsWith("kv:")) {
      const raw = await kvGet(url.slice(3));
      if (!raw) return null;
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    }
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${BLOB_TOKEN}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ── Naming helpers ───────────────────────────────────────────────────────

export function encodePropertyName(name) {
  return encodeURIComponent(name).replace(/%20/g, "_");
}

export function slugify(name) {
  return (name || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
}

export function feedbackKey(blobUrl) {
  const match = blobUrl.match(/reviews\/[^?]+/);
  return "feedback:" + (match ? match[0] : blobUrl.slice(-60));
}

// ── Token estimation (4 chars ~ 1 token) ─────────────────────────────────

export function estimateTokens(obj) {
  if (!obj) return 0;
  const str = typeof obj === "string" ? obj : JSON.stringify(obj);
  return Math.ceil(str.length / 4);
}
