# Memo relatedness demo

Paste or type a **query memo** and rank **related memos** from a fixed pool of **41 Korean memos**. Rate each suggestion Yes/No. The eval log stays in the browser so matching can be improved later.

This is **relatedness**, not category classification.

## Write-time themes (primary)

While you type, the demo judges the **active chunk** (blank-line block at the caret). It does not wait for submit.

1. The active chunk is **highlighted** in the editor.
2. **Theme chips** render directly under that row (debounced).
3. Live TypeSafe Jev when `JEV_API_KEY` (Vercel) or localStorage `jev_api_key` is set. Otherwise a labeled **keyword / overlap baseline**.
4. Low confidence always offers **`기타`** and **`없음`**.
5. On topic drift, prefer **`새 메모로 열기`** (moves the drifted chunk to a new pad). **`이 메모에 유지`** dismisses that nudge for the same chunk fingerprint.
6. Choosing a theme chip tags the pad. Find related marks same-theme siblings when a theme chip is set.

## Fallback (paste only)

If you paste a dump with **3+ blank-line blocks**, a collapsed **붙여넣은 메모 구조 나누기** panel appears. It proposes theme parents with child cards. You can merge themes, move cards, or detach a card to a standalone theme, then confirm into pads. This path is secondary. Write-time chips remain the main loop.

## Corpus

The fixture is `fixtures/korean-memo-relatedness-30.json` (filename kept; `count` is 41, ids `m01`–`m41`). `ground_truth` is `null`. There is no answer key. `m31`–`m41` are longer multi-topic dumps. `m37` is a real messy dump. `m38`–`m41` are synthetic workshop/lab/club/field dumps. The pool UI shows all 41.

## How Find related works

1. Load all 41 memos. Click a pool card or type in a pad.
2. **Find related** excludes an exact self-match, then ranks the rest.
3. **With a TypeSafe key**: one live TypeSafe Jev call, `POST https://api.typesafe.ai/v1/systemone`. Method label: `live_jev`. Failures show the real HTTP/parse error. No mocks.
4. **Without a key**: labeled keyword / overlap baseline. Method label: `heuristic`.

Theme-chunk live calls use the same key paths with `mode: "theme_chunk"` on `/api/jev` (or browser TypeSafe). Account default model only (`jev-latest` in the request body). No model override UI.

## Eval / test log

Stored in `localStorage` as `memoRelatednessEvalLog`. Entries use a `kind` field.

**`theme_chunk`** (write-time test mode):

- `ts`
- `chunk`
- `proposals` (themes + 기타/없음/새 메모로 열기 when offered)
- `confidence`
- `method` (`heuristic` | `live_jev`)
- `chipChosen`
- `newMemoNudge` (`yes` | `no` | `null`)
- `padId`, `activeChunkId`

**`related_run`** (Find related):

- `ts`, `query`, `method`, `model`, `ranked`, `ratings` (Yes/No), `note`

**`theme_edit`** (paste fallback moves/merges).

Export JSON or JSONL from the page. Clear wipes this browser only.

## Run locally

```bash
npm test
python3 -m http.server 8765
```

Open http://localhost:8765/

- Heuristic theme chips and Find related work with no key.
- For live Jev from the browser, paste a TypeSafe key and click **Save local key**.
- Local `/api/jev` needs `vercel dev` (or the deployed Vercel URL).

## Deploy

Import `Gaoridang/jev-memo-relatedness-demo` in the Vercel dashboard, or push to GitHub and let the linked project deploy.

Public URL: `https://jev-memo-relatedness-demo.vercel.app`

## Where the key goes

Use only these names. Do not commit values.

| Slot | Name | Who pastes it | What it enables |
| --- | --- | --- | --- |
| Vercel env | `JEV_API_KEY` | Operator, in the Vercel dashboard | `POST /api/jev` → TypeSafe `POST /v1/systemone` |
| Browser localStorage | `jev_api_key` | Operator, in the on-page field | Browser `fetch` to TypeSafe. Never posted to this site’s server. |

If Vercel env `JEV_API_KEY` is set, live calls use `/api/jev`. A localStorage key is used only when the env is absent. Real errors only. The functions do not log header or env values.
