# The attempt path consumes the resolved Call Profile only

`src/core/call-profile.js` resolves the last unfrozen policy facts at dispatch — the Easy Summarizer Context cap (`easyContextLimit`), the CN ideograph flag (`stripChineseIdeographs`), the structural narrative-envelope flag, and whether the call carries promotion guidance — so `settings` leaves the attempt path's interfaces. `checkEasyContextGuard`, `applyChineseOutputPolicy`, and structural output validation read that resolved policy, while promotion acceptance separately requires the generated memory to reduce the live injection. `runSingleAttempt`, `RequestRunner.run`, and `processSummarizerResponse` no longer take `settings`, and no output-length repair dispatch is created: prompt guidance asks the model to compress, while malformed output and memory-expanding promotions remain blocked.

## Considered Options

- **Keeping `settings` beside the profile on the attempt interface** — a second policy channel re-opens exactly the mid-run drift ADR-0008 rejected, where an edit made while a call is in flight changed that call's policy between retries.
- **Freezing numeric output bounds beside the profile** — this preserved extension-side length policing even though the model is better guided by prompt targets; the profile now carries only structural policy.
- **Moving the promotion prompt target into the policy** — the promotion prompt is dispatch-built and immutable after, so its validation reads settings at its own dispatch.

## Consequences

Stored summaries remain readable because their envelope and snippet parsing formats are unchanged. New calls use advisory compression targets instead of output-length rejection or promotion repair; structural validation, refusal handling, and memory-reduction validation remain. Tests construct the frozen policy through `resolveCallProfile`; `SummarizerCallMetadata` remains the resolver's input, carrying the call category and dispatch provenance.
