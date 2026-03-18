/**
 * Data reporting utility for Lexiklar.
 *
 * Sends user reports (missing words, incorrect data) to a Cloudflare Worker
 * which creates GitHub issues for triage.
 */

import { getDbVersion } from "./db.js";

const REPORT_URL = "https://lexiklar-reports.evgeniimalikov.workers.dev/report";

interface ReportOptions {
  type: "missing_word" | "incorrect_data";
  word: string;
  details?: string;
  file?: string;
  source?: string;
}

interface ReportResult {
  ok: boolean;
  error?: string;
}

/**
 * Submit a data report.
 *
 * @param {Object} opts
 * @param {'missing_word' | 'incorrect_data'} opts.type
 * @param {string} opts.word - The word being reported
 * @param {string} [opts.details] - Optional user-provided details
 * @param {string} [opts.file] - File key (e.g. "nouns/Tisch"), for incorrect_data reports
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function submitReport({ type, word, details, file, source }: ReportOptions): Promise<ReportResult> {
  try {
    let dbVersion: string | null = null;
    try {
      const info = await getDbVersion();
      dbVersion = info.version?.slice(0, 8) || null;
    } catch {
      // DB may not be initialized
    }

    const body = {
      type,
      word,
      details: details || null,
      file: file || null,
      source: source || null,
      appVersion: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : null,
      dbVersion,
    };

    const resp = await fetch(REPORT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return { ok: false, error: text || `HTTP ${resp.status}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
