# Script_Testing — story → poster CSV (standalone)

Isolated test harness. **Does not** touch Editor / Automate / Projects / server APIs.

## What it does

1. Reads multiple **stories** (JSON).
2. Extracts poster field values via:
   - **deterministic** — regex / heuristics (no API cost)
   - **llm** — your personal prompt + OpenAI-compatible API
   - **both** — write two CSVs to compare
3. Writes CSV columns used by poster bulk generate:
   `college,category,name,player_name,stat_name,stat_value,story,class_position,opponent_score`

## Setup

```bash
cd Script_Testing
cp .env.example .env
# set OPENROUTER_API_KEY=sk-or-v1-...
# set OPENROUTER_MODEL=openai/gpt-4o-mini
# edit prompts/extract_fields.txt with YOUR extraction prompt
```

Uses **OpenRouter** by default (`https://openrouter.ai/api/v1`). Model ids look like `openai/gpt-4o-mini`.

No npm install required (Node 18+ `fetch`).

## Run

```bash
# Deterministic only (safe default — no LLM)
node extract_stories_to_csv.mjs --mode deterministic \
  --stories samples/stories.json
# → out/deterministic.csv

# LLM only (uses prompts/extract_fields.txt)
node extract_stories_to_csv.mjs --mode llm \
  --stories samples/stories.json \
  --prompt prompts/extract_fields.txt
# → out/llm.csv

# Compare both (two separate files)
node extract_stories_to_csv.mjs --mode both \
  --stories samples/stories.json
# → out/compare_deterministic.csv + out/compare_llm.csv
```

## Your LLM prompt

Put instructions in `prompts/extract_fields.txt`.  
The script appends the story JSON and asks for **one JSON object** with the field keys above.

## Stories input shape

```json
[
  {
    "id": "story_1",
    "college": "Wisconsin",
    "category": "player",
    "title": "optional",
    "text": "Full story narrative goes here…"
  }
]
```

Optional per-story overrides: `player_name`, `stat_name`, `stat_value`, etc. — copied through if already present.

## LLM vs deterministic (when to use which)

| Approach | Best for | Weakness |
|----------|----------|----------|
| Deterministic | Clear “142 rushing yards”, structured blurbs | Misses soft/narrative-only stories |
| LLM + your prompt | Messy prose, implied stats, class/position | Cost, latency, needs API key |

Use `--mode both` on real stories, then pick.
