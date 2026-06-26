# Parameter reference

The `parameters` list drives three behaviors, in this precedence: **flag** (`--kebab-case`, validated, skips prompt) → **interactive prompt** (in list order) → **default** (non-interactive `--yes`/CI). A `required: true` parameter with no default and no flag fails fast in CI — it never hangs.

## Fields common to every parameter

| Field | Required | Notes |
|---|---|---|
| `name` | yes | snake_case `^[a-z][a-z0-9_]{1,40}$`. Interpolation var, `arkho.json` key, flag base. |
| `type` | yes | `string` `integer` `number` `boolean` `choice` `multichoice` `secret`. |
| `prompt` | no | The interactive question. Write it as a real question. Falls back to `name`. |
| `description` | no | Hint under the prompt and `--help` text. |
| `required` | no | Default `false`. If `true`, value cannot be empty. |
| `default` | no | Type must match `type`. Pre-fills prompt + used non-interactively. (Forbidden on `secret`.) |
| `when` | no | Conditional over PRIOR parameters. False → not asked, no flag, takes `default` (or absent). |

## Validation rules by type

- **string** — `pattern` (full-value regex), `patternHint` (ALWAYS pair with `pattern`), `minLength`, `maxLength`. Validated live in prompt and on the flag.
- **integer / number** — `minimum`, `maximum` (inclusive). `integer` rejects decimals; `number` accepts them.
- **boolean** — no extra rules. Confirm (yes/no); generates `--<name>` / `--no-<name>`.
- **choice** — requires `choices`; value must be one. Item is a string or `{ value, label, hint }` (`value` is stored/interpolated; flag accepts `value`).
- **multichoice** — like `choice`, value is a list; `default` is a list; flag accepts comma-separated (`--feats a,b`).
- **secret** — like `string` (same validations) but masked in the prompt and **never persisted** to `arkho.json` or logs. No `default`. Prefer runtime env; use only as last resort.

## Conventional parameters

No parameters are built in — everything comes from this list. The team keeps **naming conventions** so flags/interpolation/tooling stay consistent. First convention: `package_manager` (choice: `npm`/`pnpm`/`yarn`, default `pnpm`) for Node toolchains. Declare it only when needed (a Go/Python template omits it; a `when` can condition it), and interpolate it as `{{ package_manager }}` in scripts, docs, and `nextSteps`. Do NOT pin a single corepack `"packageManager": "{{ package_manager }}@<version>"` field across all three managers — one literal version cannot fit them (pnpm/npm are 10.x, yarn is 4.x), so a yarn project would get a non-existent `yarn@10.0.0`. Either omit the field or pin a version valid for the chosen manager. After generation `package.json` is the source of truth, not `arkho.json`.

## The `when` mini-language

```
operands     parameter names, literals: 'text', 42, 3.14, true, false
comparison   ==  !=  >  >=  <  <=
membership   'value' in multichoice_parameter
logical      &&   ||   !   ( )
```

Examples: `zones >= 3`, `language == 'python'`, `'streaming' in glue_features`, `enable_lakeformation && zones > 2`. No arithmetic, functions, or external access. A `when` on a *parameter* only governs whether that parameter is asked — it never makes files appear or disappear. To make a whole FILE conditional, list it under `templating.include` with its own `when`; template files never carry conditional logic of their own (the engine does flat `{{ token }}` substitution only — no `{{#if}}`/`{{#each}}`). Referencing a LATER parameter is a manifest validation error.
