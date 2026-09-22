# Memo relatedness demo

Type a memo. The page highlights the **active chunk** (the blank-line block at the caret) and shows **theme chips** under the editor. If the topic drifts, prefer **새 메모로 열기**. You can still rank related notes from a fixed pool of **41 Korean memos** and rate each suggestion Yes/No.

This is **relatedness** and write-time theme propose, not category classification and not a scored answer key.

The corpus fixture is `fixtures/korean-memo-relatedness-30.json` (filename kept; `count` is 41, ids `m01`–`m41`). `ground_truth` is `null`. There is no answer key and no invented cluster map. `m31`–`m41` stay first-class pool items. `m37` is a real messy dump.

## Write-time chips (primary)

1. Type or paste in the editor. After about 350ms the page finds the active chunk, highlights it, and proposes themes.
2. Chips come from that propose. If confidence is low, chips include **기타** and **없음**.
3. If the active chunk drifts from earlier pad themes, the page also shows **새 메모로 열기** and **이 메모에 유지**.
4. **새 메모로 열기** moves the active chunk and its trailing empty lines onto a new pad and focuses that pad.
5. **이 메모에 유지** logs a refused split and hides that same drift until the chunk text changes.

With a TypeSafe key (`JEV_API_KEY` on Vercel and/or localStorage `jev_api_key`) the page sends `{ mode: "theme_chunk", chunk, priorThemes }` to `/api/jev` (or TypeSafe from the browser). The request is Noul per prior theme plus `new_topic` and `none_topic`. The model is the account default `jev-latest`. Failures show the real HTTP or parse error. There are no mocks.

With no key, chips use the labeled keyword / overlap baseline (`method: heuristic`).

## Accordion fallback

If a paste inserts **3 or more** blank-line blocks at once, a collapsed **붙여넣은 메모 구조 나누기** panel appears. It groups theme parents and child cards. You can merge, move, or detach children, then confirm. Confirm writes one pad per theme. This is not the default while typing.

## Find related

Find related still ranks the 41-memo pool against the **active pad** text. It excludes an exact self-match.

- With a key: one live TypeSafe Jev call, `POST https://api.typesafe.ai/v1/systemone`. Each candidate is a Noul question. Method label: `live_jev`.
- Without a key: keyword / overlap baseline. Method label: `heuristic`.

## Eval log

Stored in `localStorage` as `memoRelatednessEvalLog`. One array. Export JSON or JSONL. Clear wipes this browser only.

`kind: "related_run"` (Find related):

- `ts`
- `query`
- `method` (`heuristic` | `live_jev`)
- `model` (when Jev answered)
- `ranked`: `{ id, rank, score, why }`
- `ratings`: per-id `yes` / `no` / `null`
- `note` (optional)

`kind: "theme_chunk"` (every chunk propose, then chip or nudge when you choose):

- `ts`
- `chunk`
- `proposals`
- `confidence`
- `method`
- `chipChosen` (`string` or `null`)
- `newMemoNudge` (`yes` | `no` | `null`)
- `padId`
- `activeChunkId`

The page does not invent ground-truth scores against the corpus.

## Run locally

```bash
npm test
python3 -m http.server 8765
```

Open http://localhost:8765/

- Heuristic chips and Find related work with no key.
- For live Jev from the browser, paste a TypeSafe key and click **Save local key**. That value stays in `localStorage` as `jev_api_key` and is sent only to TypeSafe.
- Local `/api/jev` needs `vercel dev` (or the deployed Vercel URL). A static file server does not run the function.

## Deploy

Import `Gaoridang/jev-memo-relatedness-demo` in the Vercel dashboard, or push to GitHub and let the linked project deploy.

Public URL (after deploy): `https://jev-memo-relatedness-demo.vercel.app`

## Where the key goes

Use only these names. Do not commit values.

| Slot | Name | Who pastes it | What it enables |
| --- | --- | --- | --- |
| Vercel env | `JEV_API_KEY` | Operator, in the Vercel dashboard | `POST /api/jev` → TypeSafe `POST /v1/systemone` |
| Browser localStorage | `jev_api_key` | Operator, in the on-page field | Browser `fetch` to TypeSafe. Never posted to this site. |

If Vercel env `JEV_API_KEY` is set, live calls use `/api/jev`. The browser field stays in localStorage and is not posted to this site. A localStorage key is used only when the env is absent.

A browser call can fail with a CORS error from TypeSafe. The UI shows that error. The Vercel env path avoids browser CORS.

The functions do not log header or env values.
