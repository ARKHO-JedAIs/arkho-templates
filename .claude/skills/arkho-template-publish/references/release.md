# Release reference

## Tag format

Each published version is the annotated git tag `<name>@<version>` — e.g. `datalake-s3@1.4.0`. The CLI resolves versions by filtering tags on the `<name>@` prefix, so this namespace is mandatory (a `<name>/v<version>` tag is NOT recognized). The template's full history is its tags:

```bash
git tag -l 'datalake-s3@*'
```

## Immutability

Published versions never change. `push` verifies the tag does not already exist and fails if it does. This guarantees that anyone who pinned a version (or whose generated project recorded `template.tag` + `template.commit`) can reproduce the exact same output later. To fix a bad release, bump the version and push a new tag — do not move or delete the old one.

## Bump examples

- `patternHint` text fixed, no field change → **PATCH** (`1.4.0` → `1.4.1`).
- Added an optional `enable_x` parameter, added a new generated file → **MINOR** (`1.4.1` → `1.5.0`).
- Renamed `zones` → `zone_count`, or changed a `choice` to `multichoice`, or restructured output → **MAJOR** (`1.5.0` → `2.0.0`); a prerelease may stage it (`2.0.0-beta.1`).

## Why validate is separate from the editor

The `$schema` line gives live editor checks for *shape* (`additionalProperties: false`, types, required fields). `arkho-cli template validate` adds *coherence* checks the schema cannot express (name↔folder match, defaults satisfying their own rules, `when` parsing and ordering — on parameters and `templating.include` entries — glob compilation, duplicate `choices` values). Both must pass before a PR merges.
