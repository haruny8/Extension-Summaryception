# ADRs

Decisions live here as `NNNN-slug.md`, one paragraph each (ADR-0025; the shape and the criteria for offering one are in `docs/agents/domain.md`).

A superseded decision that keeps its file states its successor in `status:` frontmatter. A superseded decision whose successor restates it whole is **retired**: the file is deleted and its number moves to the table below.

## Retired numbers

Numbers listed here were used and are spent — nothing may reuse them. The file is gone because its successor restates the decision whole, so the title is the only remaining record of what it decided, and the successor is the authority in force. `tests/adr-shape.test.js` asserts each row's successor is still a live file and no live file claims a retired number.

| Number | Title | Superseded by |
| ------ | ----- | ------------- |
| 0004 | Structured run outcomes cross the core seam; entry renders all notices | 0019 |
| 0005 | Editorial hierarchy as the default summarizer prompts | 0015 |
