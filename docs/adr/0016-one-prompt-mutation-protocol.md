# One prompt-mutation protocol at the Foreground Gate

Every prompt slot write and every commit crosses the Foreground Gate (`src/core/foreground-gate.js`, one instance built at the composition root), and the gate — not the writer — decides whether the work runs now, queues until the freeze lifts, or re-runs when it lifts: an effect that reports it could not finish is re-run by the gate, and a commit that reports itself stale makes the gate ask for a fresh pass through its requeue dependency, so re-running is never the caller's job. Prompt renderers are plain writers with no freeze self-check: the composition root wraps the Refresh Port effects in `runEffect`, and `beginGeneration({ beforeFreeze })` runs its sync hook first, reasserts the committed injection, then sets the freeze.

## Considered Options

- **Enforcing slot writes in the foundation host facade** — the freeze is core policy, a facade boolean hides the drop reason, and every call site still needs a wrapper.
- **Routing each renderer through the gate itself** — the gate becomes re-entrant on itself and the queue-versus-run decision splits across two layers.
- **Keeping the old two-protocol split documented** — the renderer self-check is what shipped the stale-heal hole, so documenting it preserves the bug.
- **Letting a deferred effect queue its own replacement** — the gate and the effect would share one queue, the flush's termination rests on a false return meaning the freeze, and the doc comment it replaced already claimed the gate did it.

## Consequences

Refreshes requested mid-generation now queue and land in the one flush at `endGeneration` that commits already use, instead of being skipped; slot content during a generation is unchanged. The renderers hold no import of the gate, so the feature layer no longer depends on core run control, and the `beforeFreeze` hook stays sync-typed, so a heal can never interleave between the pre-freeze refresh and the freeze. The gate's surface is instance operations such as `beginGeneration`, `endGeneration`, `commitWhenSafe`, `runEffect`, `promptWorkGate`, `heal`, `isFrozen`, and `reset`, replacing shared module state and a test-only reset; the freeze, epoch, and queues have one owner, and a test builds its own instance.
