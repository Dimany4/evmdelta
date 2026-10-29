# evmdelta

**Cross-implementation differential testing harness for EVM execution.**

Ethereum's safety model assumes that independent implementations of the EVM compute
exactly the same result for the same inputs. When they diverge, the consequence is a
consensus split or a chain-halting bug. Existing coverage is either hand-curated test
vectors (ethereum/tests, execution-spec-tests) or lives inside a single client's own
fuzzing setup. There is no small, reusable tool that compares implementations on
demand, shrinks a divergence to a minimal reproducer, and records evidence a third
party can verify.

evmdelta is that tool. It is written in Go and Rust.

## What it does

- runs the same pre-state and transaction sequence against two or more EVM
  implementations and compares the **complete** outcome: gas used, return data, logs,
  storage writes, revert reason and error kind;
- exposes a small adapter interface so adding an implementation is bounded work
  (geth and one Rust implementation first);
- generates deterministic inputs aimed at boundaries: gas accounting at limits,
  memory expansion, precompiles, stack depth, integer boundaries, recent opcode
  semantics; seeds are recorded so a campaign can be repeated exactly;
- minimises a detected divergence to the smallest bytecode and transaction sequence
  that still diverges;
- packages every divergence as an evidence bundle: inputs, pre-state, implementation
  versions and configuration, hashes, plus a verifier command that re-runs the case
  and checks the recorded artifacts were produced by that run.

## Plan

| Weeks | Deliverable |
|-------|-------------|
| 1-2 | harness skeleton in Go, adapter interface, geth adapter and a Rust adapter, full outcome comparator, first end-to-end run with a published agreement baseline |
| 3-4 | deterministic input generator, first campaign, every divergence triaged into harness defects and real disagreements, both published |
| 5 | reproducer minimiser, evidence bundle format, verifier command |
| 6 | documentation, CI campaign, public report: a reproducible divergence write-up or a documented statement of agreement over the covered surface |

## Status

Planned. This repository is being prepared as part of a grant application to the
Ethereum Foundation Ecosystem Support Program. The work has not started yet; the
milestones above are the proposed plan.

## Why it is a public good

The result is a permissively licensed tool with no token, no hosted service and no
lock-in. Any client team, audit firm or independent researcher can run it, add an
adapter, or lift the generator and the comparator into their own pipeline. It
strengthens the ecosystem's ability to detect consensus divergences, which is a
security outcome, and it is usable by parties that do not trust one another, which is
the censorship-resistance angle of the CROPS principles.

## Licence

Apache-2.0.
