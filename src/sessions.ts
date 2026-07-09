import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Long-lived login artifacts (OTP long-term tokens, session cookies) are
// persisted here instead of being returned into the LLM conversation.
const SESSIONS_DIR = path.join(os.homedir(), ".israeli-finance-mcp", "sessions");

export type SessionData = Record<string, string>;

interface SessionFile {
  createdAt: string;
  data: SessionData;
}

function sessionPath(platformId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(platformId)) {
    throw new Error(`Invalid platform id: ${platformId}`);
  }
  return path.join(SESSIONS_DIR, `${platformId}.json`);
}

export function saveSession(platformId: string, data: SessionData): void {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
  const file: SessionFile = { createdAt: new Date().toISOString(), data };
  fs.writeFileSync(sessionPath(platformId), JSON.stringify(file, null, 2), { mode: 0o600 });
}

export function loadSession(platformId: string): SessionData | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(sessionPath(platformId), "utf8")) as SessionFile;
    return parsed.data;
  } catch {
    return undefined;
  }
}

export function clearSession(platformId: string): void {
  try {
    fs.unlinkSync(sessionPath(platformId));
  } catch {
    // already gone
  }
}
