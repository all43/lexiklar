/**
 * Navigate to a word page, keeping the history stack bounded.
 * Once there are 2+ consecutive word pages at the top of the history stack,
 * further word-to-word navigation replaces the current entry rather than
 * pushing — so the user can always go back one word and then reach search.
 */
export function navigateToWord(
  router: { navigate: (url: string, opts?: Record<string, unknown>) => void; history?: string[] },
  file: string,
  opts?: { targetSense?: number | null },
) {
  const history = router.history ?? [];
  let wordPageDepth = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].startsWith("/word/")) wordPageDepth++;
    else break;
  }

  const navOpts: Record<string, unknown> = {};
  if (wordPageDepth >= 2) navOpts.reloadCurrent = true;
  if (opts?.targetSense != null) navOpts.props = { targetSense: opts.targetSense };

  router.navigate(`/word/${file}/`, navOpts);
}
