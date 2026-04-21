/**
 * Shared preamble injected into every warmup and posting prompt.
 * Prevents the agent from doing anything destructive while already logged in.
 */

export const COMMON_HEADER = `Already logged in — do NOT log in. Do NOT post anything, switch accounts, message anyone, or interact with the news feed.

ABSOLUTELY FORBIDDEN — these caused infinite loops in past runs:
  ✗ Do NOT use CDP / Chrome DevTools Protocol commands (Page.setInterceptFileChooserDialog, DOM.setFileInputFiles, Target.attachToTarget). They are blocked.
  ✗ Do NOT use JavaScript to set file input .files property or dispatch synthetic events on file inputs.
  ✗ Do NOT call document.querySelector('input[type=file]') to manipulate hidden inputs.
  ✗ Do NOT navigate to facebook.com/gaming or any other tab — if a click misfires there, hit browser back ONCE.
`
