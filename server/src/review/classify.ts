// Files that don't affect a build/run. A PR touching ONLY these is reviewed without a local merge
// or a sandbox build/run. ponytail: fixed extension/basename allowlist; anything unknown counts as
// source so a real code PR is never skipped. Upgrade path: per-repo configurable globs.
export const NON_SOURCE = /(^|\/)(LICENSE|NOTICE|AUTHORS|CHANGELOG|CODEOWNERS)$|\.(md|mdx|markdown|rst|adoc|txt|png|jpe?g|gif|svg|webp|ico|pdf)$/i;

// True if any changed path is (possibly) source — i.e. not in the non-source allowlist.
export function hasSourceChange(files: string[]): boolean {
  return files.some((f) => !NON_SOURCE.test(f));
}
