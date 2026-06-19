import { invoke } from "@tauri-apps/api/core";

export type ConnectionStatus =
  | { state: "not_configured" }
  | { state: "unverified" }
  | { state: "connected"; name: string };

export const setLinearKey = (key: string): Promise<void> =>
  invoke("set_linear_key", { key });

export const clearLinearKey = (): Promise<void> =>
  invoke("clear_linear_key");

export const getConnectionStatus = (): Promise<ConnectionStatus> =>
  invoke("get_connection_status");

export const testLinearConnection = (): Promise<ConnectionStatus> =>
  invoke("test_linear_connection");

/// Tauri commands reject with the backend's already-sanitized `CmdError` string
/// (e.g. "Linear rate limit reached. Try again shortly."). Normalize whatever the
/// IPC layer throws into a safe, human-readable line for a toast description.
export function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return "Unexpected error. Please try again.";
}
