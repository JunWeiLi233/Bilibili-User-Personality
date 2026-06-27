# Cross-Domain Analysis Report — Gaming vs History Discourse

> Generated: 2026-06-27T23:45:00.000Z
> Phase 2 Step 3: Cross-Domain Validation

---

## 1. Methodology

Two-domain comparison using the same 1,669-term keyword dictionary across 6 axes:

| Domain | Source | Sample Size | Analysis Unit |
|--------|--------|-------------|---------------|
| **Gaming** | Fresh Bilibili video comment scrape (6 seeds, 18 videos) | 76 comments, 70 UIDs | Per-comment keyword matching |
| **History** | AICU database 100-user baseline (seed: 中华, BV1m54y1Q7eQ) | 100 users, 4,449 messages | Per-user keyword matching |

**Metric for comparison:** keyword hits per message — this normalizes for the sample size difference.
For gaming: `total_hits / 76 comments`. For history: `total_hits / 4,449 messages`.

### Gaming Seeds Used

| Seed | Comments | Videos with comments |
|------|----------|---------------------|
| 游戏 | 22 | 3/3 |
| 原神 | 25 | 3/3 |
| 王者荣耀 | 17 | 3/3 |
| 吃鸡 | 11 | 3/3 |
| 电竞 | 1 | 1/3 |
| LOL英雄联盟 | 0 | 0/3 |

---

## 2. Raw Axis Distribution

### Gaming Domain (76 comments)

| Axis | Family | Raw Hits | Hits/Comment | Dictionary Terms |
|------|--------|----------|-------------|-----------------|
| 情绪过激 | attack | 16 | 0.211 | 985 |
| 绝对化表达 | absolutes | 12 | 0.158 | 130 |
| 合作讨论 | cooperation | 29 | 0.382 | 350 |
| 回避讨论 | evasion | 2 | 0.026 | 93 |
| 逻辑混乱 | evidence | 0 | 0.000 | 57 |
| 其他问题 | correction | 0 | 0.000 | 54 |
| **All axes** | | **59** | **0.776** | **1,669** |

### History Domain (100 users, 4,449 messages)

| Axis | Family | Raw Hits | Hits/Message | Users Activated |
|------|--------|----------|-------------|----------------|
| 合作讨论 | cooperation | 920 | 0.207 | 80/100 (80%) |
| 情绪过激 | attack | 484 | 0.109 | 66/100 (66%) |
| 绝对化表达 | absolutes | 320 | 0.072 | 65/100 (65%) |
| 逻辑混乱 | evidence | 44 | 0.010 | 27/100 (27%) |
| 回避讨论 | evasion | 30 | 0.007 | 24/100 (24%) |
| 其他问题 | correction | 14 | 0.003 | 9/100 (9%) |
| **All axes** | | **1,812** | **0.407** | **94/100 (94%)** |

---

## 3. Normalized Comparison

| Axis | Gaming (hits/comment) | History (hits/msg) | Ratio (G/H) | Direction |
|------|----------------------|-------------------|-------------|-----------|
| 情绪过激 | 0.211 | 0.109 | 1.93× | 📈 Gaming higher |
| 绝对化表达 | 0.158 | 0.072 | 2.19× | 📈 Gaming higher |
| 合作讨论 | 0.382 | 0.207 | 1.85× | 📈 Gaming higher |
| 回避讨论 | 0.026 | 0.007 | 3.86× | 📈 Gaming higher |
| 逻辑混乱 | 0.000 | 0.010 | 0.00× | 📉 Gaming lower |
| 其他问题 | 0.000 | 0.003 | 0.00× | 📉 Gaming lower |
| **Overall** | **0.776** | **0.407** | **1.91×** | 📈 Gaming higher |

**Key finding:** Gaming comments produce nearly 2× the keyword hit rate of history messages (0.776 vs 0.407 hits per message). This is driven by higher rates of attack, absolutes, and cooperation terms. Evidence and correction terms — already the sparsest axes — show zero hits in the small gaming sample.

---

## 4. Interpretation

### Expected vs Observed

| Hypothesis | Expected | Observed | Verdict |
|-----------|----------|----------|---------|
| Gaming → more attack/emotional language | Higher 情绪过激 | 1.93× higher | ✅ Confirmed |
| Gaming → more absolutes/overstatement | Higher 绝对化表达 | 2.19× higher | ✅ Confirmed |
| Gaming → less cooperative discussion | Lower 合作讨论 | 1.85× higher | ❌ Opposite |
| Gaming → more meme/emote density | Higher evasion | 3.86× higher | ✅ Directionally confirmed |
| Axes shift predictably across domains | ≠ history distribution | 4/6 shifted | ✅ Partially confirmed |

### Analysis

**Confirmed predictions:**
- **Higher attack (1.93×):** Gaming discourse contains more negation ("不是"), insults ("垃圾", "nt"), and confrontational language ("超标", "抄袭"). This aligns with the known toxicity of gaming communities.
- **Higher absolutes (2.19×):** Terms like "没有", "都是", "全是" appear more frequently in gaming comments, consistent with the absolute/overstatement style common in gaming trash-talk.
- **Higher evasion (3.86×):** Terms like "和谐", "自己看" appear in the gaming sample but the absolute numbers are very small (2 hits in 76 comments).

**Surprising findings:**
- **Higher cooperation (1.85×):** Gaming comments had more cooperative terms than expected — "笑哭", "打call", "吃瓜", "确实" appeared frequently. This may reflect the social/community nature of gaming discourse (shared excitement, calling friends, positive reactions) as much as cooperative argumentation. The cooperation axis includes many general positive-social terms that are not specific to argumentative discourse.

**Sparse axes remain sparse:**
- Evidence (逻辑混乱) and correction (其他问题) had zero hits in the gaming sample. With only 76 comments and these being the smallest families (57 and 54 terms respectively from dictionary coverage audit; note: entry shards contain 87 and 84 terms after auto-harvest expansion), zero hits is expected by chance. Larger samples needed.

---

## 5. Top Gaming Keywords (by match count)

| Term | Family | Hits | Context |
|------|--------|------|---------|
| 没有 | absolutes | 8 | "并没有", "从来没有", "没有很吵闹" |
| 笑哭 | cooperation | 7 | "果然七神有八个[笑哭]" |
| 不是 | attack | 6 | "我不是嘲讽", "这不是早就说了吗" |
| nt | attack | 2 | Gaming-specific insult abbreviation |
| 垃圾 | attack | 2 | "纯纯的垃圾游戏" |
| 超标 | attack | 2 | Gaming balance terminology |
| 都是 | absolutes | 2 | "外面全是粉丝" |
| 可能 | cooperation | 2 | Hedging language |
| 打call | cooperation | 2 | "有可能搜不到[打call]" |
| 吃瓜 | cooperation | 2 | Spectator stance marker |

---

## 6. Gaming Comment Samples (matched)

<details>
<summary>30 matched comments from gaming videos</summary>

- **原神** | 好家伙，桑多涅也太好玩了吧【原神】创作体验服
  > 官方是不是故意的，让你们up集体今天12点发视频，自己又放个至冬PV大招出来，把你们撞飞[笑哭]

- **原神** | 《原神》超越PV——「骤雪」
  > 果然七神有八个[笑哭]

- **王者荣耀** | 赵云再次迎来史诗级加强！
  > 不如碎心锤赵云，我觉得碎心锤赵云才是版本答案[汤圆]

- **游戏** | steam上的十一款巨大娘游戏推荐
  > Save giant girl from monsters也算吗？那不是纯纯的垃圾游戏吗？总不能是包含gts元素的都算吧[doge]

- **游戏** | iPhone一定要玩的4个游戏
  > 我就不玩，你能怎样？打我啊笨蛋[吃瓜][doge][doge]

- **王者荣耀** | 赵云再次迎来史诗级加强！
  > 爱鸽坐在匹若曹鼻子上，问道：你觉得我会做碎星锤吗？ 匹若曹说不，爱鸽娇哼一声：你说谎了[笑哭]

- **游戏** | 我要直播吃各种美食来成为大胃王主播！ROBLOX
  > 末日降临，外面全是粉丝，但你七哥却在屋子里享受大餐

- **原神** | 《原神》超越PV——「骤雪」
  > 火神之心并没有出现，所以真的是消失了而不是到了女皇手中。

- **游戏** | steam上的十一款巨大娘游戏推荐
  > Steam版乐园应该不会上线了，因为白皮想独吞这个游戏的成果。

- **原神** | 至冬女皇单挑死之执政！北极熊看原神超越PV竟然这么爆！
  > 莫名和谐，不愧是雪王[doge]

</details>

---

## 7. Limitations

1. **Small gaming sample (76 comments vs 4,449 history messages).** The gaming domain has ~1.7% of the history baseline's message count. Statistical comparisons are directional only.
2. **Per-comment vs per-user analysis.** Gaming analysis operates on individual comments; history analysis on aggregated user profiles. Hit rates are not directly comparable — per-user aggregation amplifies signal (a user with 10 attack keywords counts as 10 hits, not 1).
3. **Video-level sampling bias.** Gaming videos were selected by search relevance, not comment quality/quantity. Several videos had zero usable comments.
4. **Cooperation axis ambiguity.** The cooperation family (350 terms) includes both argumentative cooperation ("确实", "可能", "我觉得") and general social positivity ("打call", "三连", "加油"). The latter inflates gaming cooperation scores artificially.
5. **Sparse axis floor effect.** Evidence and correction — the families this Phase 2 expansion targeted — had 0 hits in 76 comments. Larger samples (500+ comments) are needed to assess these axes cross-domain.
6. **No emote/danmaku analysis.** Gaming discourse is emote-heavy; keyword matching misses non-textual discourse markers.

---

## 8. Verdict

**The model detects domain-specific discourse patterns, but the comparison is underpowered.**

The 1.91× higher overall keyword hit rate in gaming comments suggests real discourse differences: gaming comments are denser in attack, absolutes, and cooperation terms. However, the 76-comment sample is too small to draw statistically reliable conclusions, and the per-comment analysis unit differs from the per-user baseline.

**What this tells us:**
- ✅ The dictionary captures terms that appear in gaming discourse — it's not purely history-domain vocabulary.
- ✅ The axis structure (attack higher in gaming) matches qualitative expectations.
- ⚠️ The cooperation axis conflates argumentative hedging with social positivity — needs refinement for cross-domain use.
- ❌ Evidence and correction remain too sparse to evaluate cross-domain.

**Recommendation:** Scale up to 500+ gaming comments (or 50+ gaming user profiles) for a statistically meaningful comparison. The scraping infrastructure and analysis pipeline demonstrated here can be reused directly.
