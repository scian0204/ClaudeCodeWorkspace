// One rule for reading the CLI's account-usage answer, shared by everything that asks for it.
//
// The control-channel call answers with whatever the CLI has at that instant. A subprocess that has
// just started may not have finished its claude.ai account lookup, and then it replies
// `rate_limits: null` WHILE `rate_limits_available` is already true — "this credential may read plan
// windows, I just don't have them yet". Reading that as a real answer is the bug that kept coming
// back: the usage popover cached it and showed "no plan limits", and the 5-hour window primer would
// have spent a message opening a window that was already running.
//
// `rate_limits_available: false` (an API key, or an inference-only setup-token) IS a settled answer:
// that credential has no plan windows and never will, so callers should take it at face value.
export function limitsSettled(u: any): boolean {
  return !!u && (!!u.rate_limits || u.rate_limits_available === false);
}
