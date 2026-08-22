# Analysis Pipeline

How a Bilibili user's comments get scored for argumentative tendency ("杠精倾向").

## Data Flow

```
Bilibili API (comments/replies/danmaku)
        │
        ▼
┌──────────────────────────────────────┐
│ 1. Text Split & Preprocess           │
│    splitComments() → comment array   │
│    isMemeOrQuotedNonAttackText()     │
└──────────────────────────────────────┘
        │
        ├──────────────────┐
        ▼                  ▼
┌──────────────┐  ┌──────────────────┐
│ 2a. Speech   │  │ 2b. Dictionary   │
│ Act Rules    │  │ Matching         │
│              │  │                  │
│ 7 regex      │  │ ~1,579 terms     │
│ patterns     │  │ in 6 families    │
│ classify each│  │ scanned per      │
│ comment      │  │ comment          │
└──────────────┘  └──────────────────┘
        │                  │
        ▼                  ▼
┌──────────────────────────────────────┐
│ 3. Score Fusion                      │
│    semanticSeed (baseline + deltas)  │
│    lexiconSeed (density-based)      │
│    hybrid: 65% semantic + 35% lex   │
└──────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────┐
│ 4. 6-Axis Radar Output               │
│    对抗性动机 | 绝对化思维            │
│    证据敏感   | 逻辑一致              │
│    合作讨论   | 修正意愿              │
│    Each: 0-100 score + benchmark     │
└──────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────┐
│ 5. Troll Index                       │
│    Weighted sum across 6 axes        │
│    (0-100, higher = more arg-prone)  │
└──────────────────────────────────────┘
```

## Step 1: Text Split

`splitComments(text)` — `src/main.jsx:298`

Splits raw text on newlines. Each line becomes a separate analysis unit. Caveat: multi-paragraph comments lose context (C18 in probe).

## Step 2a: Speech Act Rules

`classifySpeechAct(comment, index, total)` — `src/main.jsx:313`

7 regex rules ordered by severity:

| Rule | Pattern | Target | Delta |
|------|---------|--------|-------|
| 人身攻击/资格审查 | 你懂, 智商, 急了, 典, 孝, 绷... | 人 | attack +28, cooperation -18 |
| 扣立场/动机揣测 | 洗地, 收钱, 水军, 粉红, 来电了... | 动机 | attack +20, logic -24 |
| 甩举证责任 | 自己查, 懂的都懂, 不解释... | 证明责任 | evidence -28 |
| 一棍子打死 | 所有, 全部, 没有一个, 从来... | 命题范围 | closure +26, logic -20 |
| 铁口直断不给证据 | 不可能, 绝对, 毫无疑问... | 事实 | closure +18, evidence -16 |
| 留余地/讲道理 | 可能, 不一定, 仅供参考... | 观点 | cooperation +24 (positive) |
| 认错/改口 | 我错了, 你说得对, 记错了... | 自我修正 | correction +32 (positive) |

Each rule has a regex pattern with a character window (`.{0,20}` or `.{0,24}`). Matching is first-match-wins within each comment. The meme gate (C26, fixed) reduces deltas by 50% for meme-flagged text instead of blocking entirely.

## Step 2b: Dictionary (Lexicon) Matching

`findLexiconMarks(comment, ...)` — `src/main.jsx:376`

Scans each comment against all loaded dictionary terms across 6 families:

| Family | Terms | Axis | Polarity |
|--------|-------|------|----------|
| attack | ~45 (你急了, 典, 孝, 小丑, 查成分...) | 对抗性动机 | risk |
| absolutes | ~30 (所有, 全部, 永远, 必然...) | 绝对化思维 | risk |
| evasion | ~20 (自己查, 懂的都懂, 不解释...) | 证据敏感 | risk |
| evidence | ~20 (数据, 来源, 链接, 参考文献...) | 证据敏感 | support |
| cooperation | ~25 (可能, 不一定, 补充...) | 合作讨论 | support |
| correction | ~15 (我错了, 更正, 记错了...) | 修正意愿 | support |

Terms come from two sources: `baseLexicons` (hardcoded in `main.jsx:78-127`) and the DeepSeek-trained dictionary (`server/data/deepseekKeywordDictionary.json`, 1,579 entries).

**C10 fix**: 1-2 char Chinese terms now require word-boundary check — "都" won't match inside "首都".

## Step 3: Score Fusion

`scoreComments({...})` — `src/main.jsx:486`

### Semantic Seed
Each axis starts at a baseline:
```
attack=26, closure=30, evidence=56, logic=68, cooperation=46, correction=36
```
Speech act rule matches apply deltas to these baselines. Multiple rules can stack.

### Lexicon Seed
Density-based scoring:
```
attack = 28 + riskDensity(attack_terms) * 24 + perThousand * 2.8
evidence = 55 + density(evidence) * 16 - riskDensity(evasion) * 22
...
```
Where `riskDensity` = matches in risk-filtered text, `density` = matches in full text.

### Hybrid Blend
```
hybrid = semantic * 0.65 + lexicon * 0.35
```
All values clamped to [0, 100].

## Step 4: Radar Scores

6 axes output with:
- `value`: computed score (0-100)
- `benchmark`: reference threshold (hand-tuned)
- `note`: human-readable explanation of what contributed

Inverse axes (`证据敏感, 逻辑一致, 合作讨论, 修正意愿`): lower = riskier.

## Step 5: Troll Index

```
weights = {对抗性动机: 0.20, 绝对化思维: 0.16, 证据敏感: 0.18, 逻辑一致: 0.18, 合作讨论: 0.16, 修正意愿: 0.12}
trollIndex = Σ normalizeForRisk(score[axis]) * weight[axis]
```

## Known Limitations

See `autoresearch/probe-*/constraints.md` for full constraint list. Key ones addressed:
- C10: Short-term substring false positives → word-boundary guard
- C26: Meme gate too aggressive → halved deltas instead of blocking
- C32: Dead `best` mode → removed, modes now 3

Remaining:
- No ground truth calibration (C27)
- No thread context awareness (C37)
- No temporal decay (C38)
- Evidence axis asymmetry — 3.5× more sensitive to evasion than provision (C16)
