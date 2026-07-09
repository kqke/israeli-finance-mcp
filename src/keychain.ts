import { execFileSync } from "child_process";
import * as os from "os";

// macOS Keychain lookup. Convention: service "israeli-bank.<ENV_VAR_NAME>",
// account = current user, e.g.:
//   security add-generic-password -a "$USER" -s israeli-bank.DISCOUNT_ID -w
// Lookup order in the server is: env var -> keychain -> stored session.
const cache = new Map<string, string | undefined>();

export function keychainLookup(envName: string): string | undefined {
  if (process.platform !== "darwin") {
    return undefined;
  }
  if (cache.has(envName)) {
    return cache.get(envName);
  }

  let value: string | undefined;
  try {
    const output = execFileSync(
      "security",
      ["find-generic-password", "-a", os.userInfo().username, "-s", `israeli-bank.${envName}`, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    // strip the trailing newline only — passwords may legitimately contain spaces
    value = output.replace(/\n$/, "") || undefined;
  } catch {
    value = undefined; // not present or access denied
  }

  cache.set(envName, value);
  return value;
}
