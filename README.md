# Memo relatedness demo

Type a memo. The page highlights the **active chunk** (the blank-line block at the caret). Tag chips show under that chunk only when the tag gate clears. Rate a shown tag Yes or No and leave an optional note. **새 메모로 열기** shows up only when that chunk clearly leaves the earlier topic in the same memo. A new pad starts with a clean chip row. Session theme priors can still carry labels forward. You can still rank related notes from a fixed pool of **41 Korean memos** and rate each suggestion Yes/No.

Find related still ranks the memo pool. Write-time tags are a separate suggestion on the chunk you are typing. Tags do not replace that ranking. There is no scored answer key.

The corpus fixture is `fixtures/korean-memo-relatedness-30.json` (filename kept; `count` is 41, ids `m01`–`m41`). `ground_truth` is `null`. There is no answer key and no invented cluster map. `m31`–`m41` stay first-class pool items. `m37` is a real messy dump.

## Write-time chips (primary)

1. Type or paste in the editor. After about 350ms the page scores each blank-line chunk. Chips render only when the tag gate clears. A quiet chunk stays blank.
2. Yes accepts a tag and keeps it on the row. No rejects it and keeps the chip on the row. An optional note is stored with the rating.
3. A picked or rated chip stays on that row after the next propose.
4. **새 메모로 열기** appears on a chunk only when its vocab topic conflicts with earlier chunks in the same memo, or a live Jev `new_topic` score says so and the chunk is not the same vocab. A same-topic continuation does not nudge. The old low-overlap nudge is logged as `falsePositive` so a rater can mark `shouldNotSplit`.
5. **새 메모로 열기** opens a dialog. The dialog text starts as that chunk and keeps the chunk's sticky label and ratings. Dismiss leaves the original pad untouched. Confirm appends a new pad, removes that paragraph from the original pad, and opens the new pad. `sessionThemePriors` stay.
6. **같은 주제예요** sets `shouldNotSplit` and hides the nudge.

With a TypeSafe key (`JEV_API_KEY` on Vercel and/or localStorage `jev_api_key`) the page sends `{ mode: "theme_chunk", chunk, priorThemes }` to `/api/jev` (or TypeSafe from the browser). The request is Noul per prior theme plus `new_topic` and `none_topic`. The model is the account default `jev-latest`. Failures show the real HTTP or parse error. There are no mocks.

Chip labels never come from chunk word prefixes. The judge first matches **session priors + a fixed Korean theme vocab**. You can also type a custom tag. If there is still no good match and an OpenAI key is present (`OPENAI_API_KEY` on Vercel and/or localStorage `openai_api_key`), the page calls Chat Completions with Sol (`gpt-5.6-sol`) to invent a **short theme title**, then stores that label in session priors. A title still has to clear the tag gate below before the page shows it.

## Tag gate

The page shows tag chrome only when the top score clears a fixed bar and leads the runner-up by a fixed margin. The numbers are `TAG_TOP` **0.54**, `TAG_MARGIN` **0.12**, and `TAG_AUTO` **0.66** in `theme-offer.js`. One vocab hit scores 0.54. Two hits score 0.66. These are not a relatedness cutoff, and **0.8 is not a gate**.

| Outcome | When | What you see |
| --- | --- | --- |
| Quiet | Top score is below 0.54, or the runner-up is also below 0.54 while the margin is under 0.12 | No tag chips and no question. The gate line still names the thresholds. |
| Ask | Both the top score and the runner-up are at least 0.54, and the margin is under 0.12 | The existing parent or drink question. A weak tie, including a score near 0.13, stays quiet. |
| Ready | Top score is at least 0.54 and under 0.66, and the margin is at least 0.12 | Matching parent and child chips, plus **적용**. Nothing is written until you apply. |
| Auto | Top score is at least 0.66 and the margin is at least 0.12 | The leading tag is applied. **되돌리기** restores the previous tag. The line above the chips shows `이전 … → …`. |

Several children under the winning parent stay on the row. The gate does not keep only the first chip. Yes and No on a chip still write the eval log only.

The chrome follows that outcome. Quiet, ask, ready, and auto are different blocks. The pattern is generative UI from a Jev outcome ([note](https://x.com/tenkoh88/status/2101812964387151878), [writeup](https://zenn.dev/foxtail88/articles/jev-generative-ui)) and a choice gate that stays quiet under the bar ([choice gate](https://x.com/ddebowczyk/status/2100655022149165111), [low confidence halted](https://x.com/fange151818/status/2101845479697031578), [typesafe as a judge](https://github.com/E-FL/typesafe-as-a-judge), [choice note](https://x.com/leejpjack/status/2102052263749472262)).

With a TypeSafe key the scores come from live Jev. With no key the same thresholds run on the keyword baseline.

With no Jev key, theme match uses the labeled keyword / vocab baseline (`method: heuristic`).

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
- `inventedLabelBefore` / `inventedLabelAfter` (when a short title is invented)
- `needsTitle`
- `labelSource`
- `chunkKey`
- `ratings`: per-label `{ verdict: yes|no|null, note }`
- `stickyLabel`
- `splitKind` (`none` | `nudge` | `candidate`)
- `legacyWouldNudge`
- `falsePositive`
- `shouldNotSplit` (`true` or `null`)
- `ratedAt` (when a tag rating or the split flag changes)
- `tagGate` (`disposition`, `top`, `second`, `margin`, `topMin`, `marginMin`, `autoMin`)
- `suggestion` (`action` `accept`, `reject`, `adjust`, or `null` while an auto-apply is still waiting, plus `label` and `previous`)

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

## Where the keys go

Use only these names. Do not commit values.

| Slot | Name | Who pastes it | What it enables |
| --- | --- | --- | --- |
| Vercel env | `JEV_API_KEY` | Operator, in the Vercel dashboard | `POST /api/jev` → TypeSafe `POST /v1/systemone` |
| Browser localStorage | `jev_api_key` | Operator, in the on-page field | Browser `fetch` to TypeSafe. Never posted to this site. |
| Vercel env | `OPENAI_API_KEY` | Operator, in the Vercel dashboard | `POST /api/llm` → OpenAI Chat Completions (`gpt-5.6-sol`) for short theme titles |
| Browser localStorage | `openai_api_key` | Operator, in the on-page field | Browser `fetch` to OpenAI for invent titles. Never posted to this site. |

If Vercel env `JEV_API_KEY` is set, live Jev calls use `/api/jev`. If `OPENAI_API_KEY` is set, invent-title calls use `/api/llm`. Browser fields stay in localStorage and are not posted to this site. A localStorage key is used only when the matching env is absent.

A browser call can fail with a CORS error from TypeSafe or OpenAI. The UI shows that error. The Vercel env path avoids browser CORS.

The functions do not log header or env values.
