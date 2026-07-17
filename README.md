# PR #1067 real-world QA

Tested head: `96666c9e0c840e6793312cffa548ae31c73c3de5`

## Browser-driven scenarios

- Ordinary Git, Bun runtime: Git status, tree, commits, stage, and unstage all passed.
- Ordinary Git on a branch literally named `gitbutler/workspace`: remained on the normal Git path. No false GitButler detection.
- Real JJ repository: current, last, line of work, evolution, and all-files views all switched and rendered correctly.
- Real GitButler 0.21 repository: workspace, stacked branch, individual branch, and parallel branch diffs rendered the exact expected files.
- GitButler freshness: an unassigned working-file edit raised `Diff out of date`; Refresh displayed the new line.
- GitButler topology freshness: applying a parallel branch raised the stale notice; Refresh added the new branch and file.
- GitButler branch removal: unapplying the selected branch raised the stale notice; Refresh showed the explicit vanished-branch error and the selector recovered to Workspace.
- Mixed non-VCS parent: one Git child, one JJ child, and one GitButler child were combined with correct folder-prefixed paths.
- Pi runtime: GitButler workspace and stack views passed; ordinary Git stage and unstage passed.
- Browser console audit: zero warnings or errors in every scenario.
- Empty non-VCS directory: exited cleanly with `Not in a VCS repo and no nested Git/JJ/GitButler repositories were found.`

## Real CLI coverage

- GitButler CLI `0.21.0`: real stack, stacked branches, parallel branches, apply, unapply, exact diffs, and conflict prevention.
- Git `2.50.1`: real repositories and real index staging.
- Jujutsu `0.41.0`: real colocated repository and real evolution history.
- Actual GitButler conflict attempt: GitButler returned `conflictAborted` and did not create a conflicted commit.

## Automated and CI coverage

- Full local suite: 2,080 passed, 90 optional skipped, 0 failed.
- Typecheck and Bun/Pi/review/hook/marketing/OpenCode builds passed.
- GitHub: Linux tests/build/smoke/install passed; Windows tests, Pi runtime, smoke binary, PowerShell installer, and cmd installer passed.

## Remaining honest gaps

- No licensed Perforce server or `p4` executable was available; P4 is covered by its existing fake-CLI contract suite, not a real depot.
- GitButler itself was exercised on macOS. Linux and Windows CI cover Plannotator build/install regressions, but do not install and drive the GitButler desktop/CLI product.
- GitButler prevented a real conflict during apply. A repository already containing GitButler conflict metadata remains covered by contract fixtures rather than a naturally created real repository.
