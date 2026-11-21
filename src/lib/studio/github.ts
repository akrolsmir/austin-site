// The GitHub calls the code lane makes (docs/editable-site.md, "Code lane"): plain REST plus one GraphQL mutation, with
// fetch injected for tests. Only server code calls this; the sandbox never gets GITHUB_TOKEN. Every call has a time
// limit, and errors carry the method, path, and status only: never a response body, never the token.
export const DEFAULT_REPO = "akrolsmir/austin-site", BASE_BRANCH = "main";
const CALL_MS = 20000;
type Env = Record<string, string | undefined>;
export class GitHubError extends Error { constructor(public status: number, what: string) { super(`GitHub ${what} answered ${status}`); this.name = "GitHubError"; } }
export type FileChange = { path: string; mode: "100644" | "100755"; content: Buffer } | { path: string; deleted: true };
export type PullRequest = { number: number; url: string; title: string; head: string; branch: string; open: boolean; merged: boolean; mergeSha: string | null; createdAt: Date; nodeId: string };
/** `none`: GitHub knows of no deployment for the commit at all (Vercel has not picked it up, or is not connected). */
export type Preview = { state: "success" | "failure" | "pending"; url?: string; none?: boolean };
export type GitHub = NonNullable<ReturnType<typeof github>>;
export const repoOf = (env: Env) => /^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO ?? "") ? env.GITHUB_REPO! : DEFAULT_REPO;
export const httpsUrl = (value: unknown) => { try { const url = new URL(String(value)); return url.protocol === "https:" ? url.href : undefined; } catch { return undefined; } };

/** A client for the site's repo, or null when GITHUB_TOKEN is not set. */
export function github(env: Env = process.env, fetchImpl: typeof fetch = fetch) {
  const token = env.GITHUB_TOKEN, repo = repoOf(env);
  if (!token) return null;
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      method, signal: AbortSignal.timeout(CALL_MS), body: body === undefined ? undefined : JSON.stringify(body),
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "site-studio", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    });
    if (!response.ok) throw new GitHubError(response.status, `${method} ${path.split("?")[0]}`);
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }
  const r = `/repos/${repo}`;
  type RawPr = { number: number; html_url: string; title: string; state: string; merged?: boolean; merge_commit_sha: string | null; created_at: string; node_id: string; head: { sha: string; ref: string } };
  const shaped = (pr: RawPr): PullRequest => ({ number: pr.number, url: httpsUrl(pr.html_url) ?? "", title: pr.title, head: pr.head.sha, branch: pr.head.ref, open: pr.state === "open", merged: pr.merged === true, mergeSha: pr.merged ? pr.merge_commit_sha : null, createdAt: new Date(pr.created_at), nodeId: pr.node_id });
  return {
    repo,
    /** Whether `sha` is main's head or one of its ancestors. */
    async onMain(sha: string): Promise<boolean> {
      try { return ["ahead", "identical"].includes((await call<{ status: string }>("GET", `${r}/compare/${sha}...${BASE_BRANCH}`)).status); }
      catch (error) { if (error instanceof GitHubError && error.status === 404) return false; throw error; }
    },
    /**
     * One commit on top of `parent` with `files` changed, on a new branch (never a force push: an existing branch is an
     * error). No author is named, so GitHub records the token's own user: Vercel can refuse to build a commit whose
     * author is not a member of the team, and the message's Co-Authored-By line says who wrote it.
     */
    async commit({ branch, parent, message, files }: { branch: string; parent: string; message: string; files: FileChange[] }): Promise<string> {
      const base = await call<{ tree: { sha: string } }>("GET", `${r}/git/commits/${parent}`);
      const tree: Array<{ path: string; mode: string; type: "blob"; sha: string | null }> = [];
      for (let i = 0; i < files.length; i += 6) tree.push(...await Promise.all(files.slice(i, i + 6).map(async (file) => "deleted" in file
        ? { path: file.path, mode: "100644", type: "blob" as const, sha: null }
        : { path: file.path, mode: file.mode, type: "blob" as const, sha: (await call<{ sha: string }>("POST", `${r}/git/blobs`, { content: file.content.toString("base64"), encoding: "base64" })).sha })));
      const made = await call<{ sha: string }>("POST", `${r}/git/trees`, { base_tree: base.tree.sha, tree });
      const commit = await call<{ sha: string }>("POST", `${r}/git/commits`, { message, tree: made.sha, parents: [parent] });
      await call("POST", `${r}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
      return commit.sha;
    },
    openPr: async ({ branch, title, body }: { branch: string; title: string; body: string }) => shaped(await call<RawPr>("POST", `${r}/pulls`, { head: branch, base: BASE_BRANCH, title, body })),
    pr: async (number: number) => shaped(await call<RawPr>("GET", `${r}/pulls/${number}`)),
    /** The deployments GitHub knows for a commit (Vercel reports its preview there): all succeeded, any failed, or still going. */
    async preview(sha: string): Promise<Preview> {
      const deployments = await call<Array<{ id: number }>>("GET", `${r}/deployments?sha=${sha}&per_page=20`);
      const latest = (await Promise.all(deployments.map(async ({ id }) => (await call<Array<{ state: string; environment_url?: string }>>("GET", `${r}/deployments/${id}/statuses?per_page=1`))[0]))).filter((status) => status && status.state !== "inactive");
      const url = latest.map((status) => httpsUrl(status.environment_url)).find(Boolean);
      if (latest.some((status) => status.state === "failure" || status.state === "error")) return { state: "failure", url };
      return latest.length && latest.every((status) => status.state === "success") ? { state: "success", url } : { state: "pending", url, ...(deployments.length ? {} : { none: true }) };
    },
    /** Squash-merges only if the PR's head is still `head`. Returns the merge commit. */
    merge: async (number: number, head: string, title: string) => (await call<{ sha: string }>("PUT", `${r}/pulls/${number}/merge`, { merge_method: "squash", sha: head, commit_title: title })).sha,
    closePr: async (number: number) => { await call("PATCH", `${r}/pulls/${number}`, { state: "closed" }); },
    deleteBranch: async (branch: string) => { await call("DELETE", `${r}/git/refs/heads/${branch}`); },
    /** Opens the pull request that reverts a merged one (GitHub's own Revert button). */
    async revertPr(nodeId: string): Promise<{ number: number; url: string; head: string; branch: string }> {
      const answer = await call<{ data?: { revertPullRequest?: { revertPullRequest?: { number: number; url: string; headRefOid: string; headRefName: string } } } }>("POST", "/graphql", {
        query: "mutation($id: ID!) { revertPullRequest(input: { pullRequestId: $id }) { revertPullRequest { number url headRefOid headRefName } } }", variables: { id: nodeId },
      });
      const pr = answer.data?.revertPullRequest?.revertPullRequest;
      if (!pr) throw new GitHubError(422, "revertPullRequest");
      return { number: pr.number, url: httpsUrl(pr.url) ?? "", head: pr.headRefOid, branch: pr.headRefName };
    },
  };
}
