# Code style

- TypeScript, strict. Small modules with one job.
- Comments explain why, never what. No banner comments, no comment on every function, no "This function..." docblocks.
- Names say what things are. No abbreviations beyond the common ones (ctx, px, t).
- No defensive noise: validate at boundaries (IPC, file input), trust internal calls.
- UI copy: sentence case, plain words, short. No em dashes, avoid hyphenated compounds, no exclamation marks, no "Oops".
- Every edit to a project goes through `Editor.apply` with a short label used by Undo.
- Times are integer microseconds in the model.
- Tests: pure logic gets vitest tests in test/. UI flows get a scenario in qa/ run with `node qa/launch.mjs qa/<file>.mjs`.
