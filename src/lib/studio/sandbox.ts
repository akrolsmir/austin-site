// The few things the code lane does with a Vercel Sandbox (docs/editable-site.md, "Code lane"), as an interface small enough
// to fake in tests, and its real implementation over @vercel/sandbox. The SDK is imported on first use, so nothing here
// runs (or needs credentials) at import time. Every call has a time limit: the Sandbox API can hang without answering,
// and a function killed at maxDuration cannot mark its run failed.
export const SANDBOX_ROOT = "/vercel/sandbox";
export type Box = {
  name: string;
  /** Runs a command. Detached: returns once it has started, with no exit code or output. `env` is all the command gets beyond the sandbox's own. */
  run(cmd: string, args: string[], options?: { env?: Record<string, string>; cwd?: string; detached?: boolean; ms?: number }): Promise<{ exitCode: number | null; output: string }>;
  /** A file's bytes, null when it does not exist. Throws TooBig as soon as it passes `max` bytes. */
  read(path: string, max: number): Promise<Buffer | null>;
  write(files: Array<{ path: string; content: string }>): Promise<void>;
  stop(): Promise<void>;
};
export type SandboxClient = {
  /** A new sandbox with the repo's branch cloned (shallow) at SANDBOX_ROOT. */
  create(options: { name: string; repo: string; revision: string; timeoutMs: number }): Promise<Box>;
  /** The running sandbox of that name, or null when there is none. */
  get(name: string): Promise<Box | null>;
};
export class TimedOut extends Error { constructor(what: string) { super(`${what} did not answer in time`); this.name = "TimedOut"; } }
export class TooBig extends Error { constructor() { super("A file is too large"); this.name = "TooBig"; } }

/** Runs `call` for at most `ms`; on time out its signal is aborted and this throws TimedOut whether or not `call` notices. */
export async function withTimeLimit<T>(what: string, ms: number, call: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new TimedOut(what)); }, ms); });
  try { return await Promise.race([call(controller.signal), timeout]); } finally { clearTimeout(timer); }
}

const CREATE_MS = 120000, CALL_MS = 30000, COMMAND_MS = 90000, STOP_MS = 15000;
type Sdk = typeof import("@vercel/sandbox");
type Real = Awaited<ReturnType<Sdk["Sandbox"]["get"]>>;
const box = (sandbox: Real): Box => ({
  name: sandbox.name,
  async run(cmd, args, { env, cwd = SANDBOX_ROOT, detached = false, ms = COMMAND_MS } = {}) {
    // A detached command's signal is only aborted if starting it times out, so the command itself keeps running.
    if (detached) { await withTimeLimit(`starting ${cmd}`, CALL_MS, (signal) => sandbox.runCommand({ cmd, args, cwd, env, detached: true, signal })); return { exitCode: null, output: "" }; }
    return withTimeLimit(cmd, ms, async (signal) => { const done = await sandbox.runCommand({ cmd, args, cwd, env, signal }); return { exitCode: done.exitCode, output: await done.output("both", { signal }) }; });
  },
  read: (path, max) => withTimeLimit("reading a file", CALL_MS, async (signal) => {
    const stop = new AbortController(), stream = await sandbox.readFile({ path }, { signal: AbortSignal.any([signal, stop.signal]) });
    if (!stream) return null;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array);
      if ((size += bytes.length) > max) { stop.abort(); throw new TooBig(); }
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  }),
  write: (files) => withTimeLimit("writing files", CALL_MS, (signal) => sandbox.writeFiles(files, { signal })),
  stop: async () => { await withTimeLimit("stopping the sandbox", STOP_MS, (signal) => sandbox.stop({ signal })); },
});
/** The real client. Credentials are Vercel's own (the deployment's OIDC token, or VERCEL_TOKEN with team and project ids). */
export const vercelSandbox = (): SandboxClient => ({
  async create({ name, repo, revision, timeoutMs }) {
    const { Sandbox } = await import("@vercel/sandbox");
    return box(await withTimeLimit("creating the sandbox", CREATE_MS, (signal) => Sandbox.create({ name, source: { type: "git", url: `https://github.com/${repo}.git`, revision, depth: 1 }, resources: { vcpus: 4 }, timeout: timeoutMs, persistent: false, signal })));
  },
  async get(name) {
    const { Sandbox } = await import("@vercel/sandbox");
    try { return box(await withTimeLimit("finding the sandbox", CALL_MS, (signal) => Sandbox.get({ name, signal }))); }
    catch (error) { if (error instanceof TimedOut) throw error; return null; }
  },
});
