# Memo relatedness demo

Paste a **query memo** and rank **related memos** from a fixed pool of **41 Korean memos**. Rate each suggestion Yes/No. The eval log stays in the browser so matching can be improved later.

This is **relatedness**, not category classification.

The corpus fixture is `fixtures/korean-memo-relatedness-30.json` (filename kept; `count` is 41, ids `m01`–`m41`). `ground_truth` is `null`. There is no answer key and no invented cluster map. `m31`–`m41` are longer multi-topic dumps and stay first-class pool items (`m37` is a real messy dump; `m38`–`m41` are synthetic workshop/lab/club/field dumps).

## How query → related works

1. The UI loads all 41 memos from the fixture. Click a pool card or paste any text.
2. **Find related** excludes an exact self-match, then ranks the rest.
3. **With a TypeSafe key** (`JEV_API_KEY` on Vercel and/or localStorage `jev_api_key`): one live TypeSafe Jev call, `POST https://api.typesafe.ai/v1/systemone`. The state is `{ query_memo, pool }`. Each candidate is a **Noul** question: is this memo related to the query? Results are sorted by `noul` (P(related)). Method label: `live_jev`. Failures show the real HTTP/parse error. There are no mocks, stubs, or canned Jev JSON.
4. **Without a key**: a labeled **keyword / overlap baseline** still returns ranked candidates (Korean tokens + character bigrams). Method label: `heuristic`.

## Eval log

Stored in `localStorage` as `memoRelatednessEvalLog`. Each run records:

- `ts`
- `query`
- `method` (`heuristic` | `live_jev`)
- `model` (when Jev answered)
- `ranked`: `{ id, rank, score, why }`
- `ratings`: per-id `yes` / `no` / `null`
- `note` (optional)

Export JSON or JSONL from the page. Clear wipes this browser only.

## Run locally

```bash
npm test
python3 -m http.server 8765
```

Open http://localhost:8765/

- Heuristic Find related works with no key.
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
| Browser localStorage | `jev_api_key` | Operator, in the on-page field | Browser `fetch` to TypeSafe. Never posted to this site’s server. |

If Vercel env `JEV_API_KEY` is set, Find related uses `/api/jev`. The browser field stays in localStorage and is not posted to this site. A localStorage key is used only when the env is absent.

A browser call can fail with a CORS error from TypeSafe. The UI shows that error. The Vercel env path avoids browser CORS.

The functions do not log header or env values.
