# AGENTS.md

## Commits must follow Conventional Commits

Releases are fully automated. Every push to `main` runs
[semantic-release](https://semantic-release.gitbook.io), which reads the commit messages since
the last tag to decide the next version and creates the GitHub release with the Windows exe
attached (`.github/workflows/release.yml`, the `release` config in `package.json`, `build.js`).

A commit that doesn't follow the format is invisible to the release builder: it ships no
release and is left out of the release notes. Every commit on `main` must look like:

```
<type>(<optional scope>): <short summary, lowercase, no period>
```

| Type | Release | Use for |
|---|---|---|
| `feat` | minor (1.**2**.0) | new user-facing behavior |
| `fix`, `perf`, `revert` | patch (1.2.**1**) | bug fixes, speedups, reverting a commit |
| a `BREAKING CHANGE:` footer, with any type | major (**2**.0.0) | changes that break saved files or ratings files |
| `docs`, `refactor`, `test`, `build`, `ci`, `chore`, `style` | none | everything else |

Don't use the `!` shorthand (`feat!: ...`): semantic-release's default parser can't read it.

Adding a friend's ratings file to `shared/` changes what is built into the exe, so commit it
as `feat: add <name>'s ratings` to ship it in a release.

## Keep shared rating files compatible

`shared/*.json` rows are read by `rank.js` on everyone's machine. Renaming or changing the
meaning of a feature column breaks older files, so add columns rather than changing them, and
give `rank.js` a default for rows that lack a new column.

## Personal data stays out of git

The repo is public. `data/`, `out/`, `config.json`, `render/` and `received/` (friends' replays,
which name their opponents) are local. Only the anonymised `shared/*.json` files carry ratings.
