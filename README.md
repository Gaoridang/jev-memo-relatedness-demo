# Find related memos

Write a memo in the editor. **Find related** ranks that memo against the pool of 41.

## Run the page

```bash
npm test
python3 -m http.server 8765
```

Open the page, type in the editor, and click **Find related**.

Click a pool card to copy that memo into the editor. **Clear pad** empties the editor and the result list. It leaves the log in place.

## Rank

With no Jev key, Find related uses the keyword baseline. The method is `heuristic`.

With `JEV_API_KEY` on the server, the page posts `{ query, candidates }` to `/api/jev`. The method is `live_jev`.

With no server key and a browser `jev_api_key`, the page posts the TypeSafe body to `https://api.typesafe.ai/v1/systemone`. The method is `live_jev`.

If the live call fails, the page shows the error. It does not run the keyword ranker instead.

## Rate and export

Each successful Find related appends one `related_run` to the `localStorage` key `memoRelatednessEvalLog`.

Click **Yes** or **No** on a result. The optional note is stored on that run. Export **JSON** or **JSONL**. **Clear** wipes the log in this browser only.

On load, the page removes rows that are not relatedness runs and writes the array back.

## Corpus

The pool file is `fixtures/korean-memo-relatedness-30.json`. The count is 41. The ids run from m01 through m41. `ground_truth` is null.
