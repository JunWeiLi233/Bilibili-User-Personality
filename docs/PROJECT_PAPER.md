# Bilibili User Personality Analysis

**A Research Prototype for Argumentative-Behavior Risk Assessment on Chinese Social Media Platforms**

**Author:** JunWeiLi233 — https://github.com/JunWeiLi233/Bilibili_User_Personality

---

> **Abstract.** This paper presents a research prototype for evaluating argumentative-behavior risk in Chinese-language online discourse. The system analyzes public comments, replies, and danmaku (bullet-screen comments) from the Bilibili video platform to produce a multi-dimensional behavioral profile for individual users. The analysis rests on three interlocking components: (1) a six-axis behavioral scoring framework grounded in argumentation theory and the psychology of online discourse, (2) an auditable Chinese internet-slang dictionary with 4,956 entries organized into six semantic families, each backed by Bilibili-sourced evidence, and (3) three iterative coverage loops—corpus mining, local expansion, and auto-coverage harvesting—that progressively close the evidence gap through a combination of offline text matching and live API-driven comment collection validated by large language models. The system produces a radar chart, a composite trolling index, and sentence-level diagnostic output for each analyzed user. We describe the architecture, the dictionary construction pipeline, the coverage-driven quality mechanism, and current limitations. The prototype is released as open-source software under the MIT License.

---

## 1. Introduction

Online discourse on Chinese social media platforms exhibits a distinctive set of argumentative behaviors that differ from those observed in English-language contexts. On Bilibili—a platform with over 300 million monthly active users—public discussion often features *passive-aggressive rhetoric*, *absolute quantification*, *burden-of-proof shifting*, and *categorical refusal to correct errors* when confronted with counter-evidence. These behaviors, colloquially referred to as "杠精" (*gang jing*, or "argumentative troll"), are not captured by existing toxicity-detection models trained on English corpora, nor by lexicon-based Chinese sentiment analyzers that lack context-aware semantic judgment.

This project addresses a bounded research question: **given a Bilibili user's publicly available comment history, can we produce a reliable, evidence-backed assessment of their argumentative-behavior risk across multiple interpretable dimensions?** The output is explicitly framed as a behavior-risk analysis over a limited public sample, not as a clinical diagnosis or definitive personality judgment.

The contribution of this work is threefold:

1. A **six-dimensional behavioral scoring framework** tailored to Chinese-language argumentative discourse, with each dimension scored 0–100 and backed by at least one quoted comment from the analyzed user.
2. An **auditable dictionary** of 4,956 Chinese internet-slang terms organized into six semantic families, each requiring a minimum of three pieces of Bilibili-sourced evidence before contributing full weight to the final score.
3. Three **iterative coverage-loop mechanisms** that progressively populate the dictionary with real-world evidence through a combination of offline text matching and live API-driven harvesting validated by DeepSeek V4.

The remainder of this paper is organized as follows. Section 2 surveys related work. Section 3 defines the six behavioral dimensions and the scoring methodology. Section 4 describes the dictionary system and coverage mechanism. Section 5 details the coverage loops. Section 6 presents the system architecture. Section 7 discusses current status and limitations. Section 8 outlines future work, and Section 9 concludes.

## 2. Related Work

### 2.1 Toxicity Detection in Social Media

Conventional toxicity detection systems [1, 2] classify text into broad categories (toxic, severe toxic, obscene, threat, insult, identity hate) using supervised classifiers trained on crowd-annotated datasets. While effective for English-language social media, these systems are poorly calibrated for Chinese internet discourse, where toxicity frequently manifests through *semantic indirection*—sarcasm, allusion, inverted meaning, and meme-dense language—rather than through explicit profanity.

### 2.2 Chinese NLP for Social Media

Chinese-specific NLP work has made significant progress in word segmentation, named-entity recognition, and sentiment analysis. However, most existing Chinese sentiment lexicons (e.g., NTUSD [3], HowNet [4]) are designed for general-domain text and fail to capture the fluid, rapidly evolving internet slang that characterizes Bilibili discourse. Bilibili-specific NLP work is scarce, partly because the platform's public API imposes strict rate limits and the danmaku comment format—short, context-dependent, often ironic—poses unique challenges for conventional NLP pipelines.

### 2.3 Argumentation Mining

Argumentation mining [5, 6] aims to automatically identify argumentative structures in text: claims, premises, conclusions, and attack/support relations. Our work draws on this tradition but applies it at a coarser granularity: rather than reconstructing full argumentation trees, we score six behavioral dimensions that proxy for argumentative quality. This pragmatic approach reflects the constraints of real-world deployment—short comments, noisy text, and platform-specific linguistic conventions.

### 2.4 LLM-Assisted Content Analysis

Recent work demonstrates that large language models can serve as effective annotators for social-science content analysis, often matching or exceeding crowd-worker reliability. Our system adopts this paradigm: DeepSeek V4 performs the dual role of (1) extracting candidate dictionary terms with meanings and semantic families from crawled comments, and (2) judging sentence-level context to validate whether a matched term is being used in a way that genuinely reflects the associated behavioral dimension. The model does not fine-tune; it operates in a zero-shot or few-shot configuration with structured output schemas.

## 3. The Six Behavioral Dimensions

The core of the evaluation framework consists of six orthogonal behavioral dimensions, each scored on a 0–100 scale and backed by at least one quoted sentence from the user's own comment history. The dimensions draw on argumentation theory, the psychology of online discourse, and empirical observation of Bilibili comment patterns.

### 3.1 Definition of Dimensions

1. **Adversarial Motivation (Attack).** Measures the extent to which the user attacks *people* (ad hominem, group labeling, credential questioning) rather than engaging with *ideas*. High scores indicate frequent personal attacks; low scores indicate idea-focused discussion.

2. **Cognitive Closure.** Measures the extent to which the user employs absolute quantifiers ("always," "never," "everyone knows"), categorical assertions, and refusals to acknowledge ambiguity or nuance. Draws on Kruglanski's concept of need for cognitive closure [7].

3. **Evidence Sensitivity.** Measures whether the user provides or requests verifiable evidence, cites sources, and acknowledges the evidentiary burden of their claims. Low scores indicate burden-shifting, hand-waving, and refusal to engage with evidence.

4. **Logical Consistency.** Measures the prevalence of common logical fallacies: straw-man arguments, false equivalences, causal leaps, appeals to popularity, and circular reasoning. Low scores indicate frequent fallacious reasoning.

5. **Cooperative Discussion.** Measures whether the user builds on others' contributions (clarification, paraphrase, concession, conditional framing) or dismisses them (refusal to engage, topic-shifting, non-response). Draws on Grice's cooperative principle [8].

6. **Correction Willingness.** Measures the user's response when shown to be wrong: do they admit error, edit their statement, lower their conclusion strength? Or do they double down, ignore correction, or attribute error to others? High scores indicate willingness to self-correct.

### 3.2 Scoring Methodology

Each comment is scored independently by a hybrid analyzer that combines two paths:

**Lexicon Path:** The comment is matched against the 4,956-term dictionary using exact substring matching and (optionally) semantic similarity via a local embedding model (`all-MiniLM-L6-v2`, 384-dimensional vectors). Each matched term contributes evidence to its associated dimension. The contribution weight is proportional to the dictionary entry's confidence score and evidence count.

**Semantic Judge Path:** The full comment text is sent to DeepSeek V4 with a structured output schema that requires the model to identify the speech act, target, stance, context role, and axis impacts (direction: risk/positive, strength: 0–1) for each relevant dimension. The model must provide reasoning and a direct quote as evidence.

The two paths are combined according to the selected analysis mode: **Hybrid** (lexicon + semantic judge), **Semantic Judge** (LLM only), or **Lexicon** (dictionary only, fully auditable). The composite trolling index *T* ∈ [0, 100] is computed as a weighted combination of the six axis scores:

```
T = Σᵢ wᵢ · sᵢ,    Σ wᵢ = 1
```

where *sᵢ* is the score for dimension *i* and *wᵢ* is the dimension-specific weight learned from logistic regression over human-labeled data (`python_backend/analysis/calibration.py`).

## 4. The Dictionary System

### 4.1 Structure and Storage

The dictionary is the project's central data structure. It maps Chinese internet-slang terms to six semantic families that align with the behavioral dimensions. Each entry contains:

- `term` — The cleaned keyword (2–12 characters).
- `family` — One of `attack`, `absolutes`, `evidence`, `evasion`, `cooperation`, or `correction`.
- `meaning` — A one-sentence definition of the term's pragmatic function.
- `risk` — `high`, `medium`, or `positive` (positive-risk terms indicate constructive behavior).
- `confidence` — Model confidence in the term-family assignment (0–1).
- `evidenceCount` — Number of Bilibili-sourced evidence samples.
- `evidenceSamples` — Up to 5 quoted comment excerpts containing the term.
- `evidenceSources` — Metadata for each sample (source URL, UID, text).

The dictionary is stored in **split JSON shards** under `server/data/`. A manifest file (`deepseekKeywordDictionary.json`) indexes all shards; term definitions are partitioned into 23 entry shards across six families; evidence samples are stored in separate evidence shards that grow over time as the harvesting pipeline populates them. The split-storage design ensures atomic writes per shard and bounds individual file sizes to approximately 64 KB.

### 4.2 Coverage: A Quality Gate

> **Definition (Coverage Ratio).** Let 𝓓 be the set of all dictionary entries, |𝓓| = *N*. Let τ be the target evidence threshold (default τ = 3). Let 𝓦 = {*e* ∈ 𝓓 | evidenceCount(*e*) < τ} be the set of weak entries. The coverage ratio is:
>
> ```
> 𝓒(𝓓, τ) = (N − |𝓦|) / N
> ```

Coverage ratio is the project's core quality metric. High coverage means more dictionary terms are backed by real Bilibili comments, which means the behavioral analysis has a stronger evidence base. The evidence deficit Δ is the total number of additional evidence hits needed to reach full coverage:

```
Δ = Σ (τ − evidenceCount(e))    for all e ∈ 𝓦
```

Each term must accumulate τ pieces of Bilibili-sourced evidence (comments, replies, or danmaku) before it contributes full weight to the scoring. Until then, it contributes proportionally to its evidence count. This mechanism ensures that dictionary expansion (adding new candidate terms) temporarily lowers the coverage ratio, creating a self-regulating feedback loop: expansion introduces new candidate terms → coverage drops → harvesting runs restore coverage → expansion can continue.

## 5. The Coverage Loops

Three iterative mechanisms progressively close the evidence gap. They are designed to be run in a pipeline: offline mining first (no API calls, no rate limits), then local expansion (DeepSeek over existing corpus), then live auto-coverage harvesting (Bilibili API + DeepSeek validation).

### 5.1 Corpus Mining Loop

The corpus mining loop scans pre-collected local comment data for exact substring matches against dictionary terms. It runs two passes:

1. **Strict pass:** Only counts comment-backed evidence (the matched text appears in a Bilibili comment, reply, or danmaku with source metadata).
2. **Relaxed pass:** Counts any text match, including video context and title text. This pass runs after strict mining to catch terms that appear in secondary sources.

The loop requires no Bilibili API access and no rate limiting. It is the first step in the pipeline because it maximizes the use of already-collected data.

### 5.2 Local Expansion Loop

When the Bilibili cookie is unavailable, the local expansion loop uses DeepSeek V4 to extract candidate terms from the existing local corpus. It samples diverse comments (up to 30,000 characters per run), sends them to DeepSeek for keyword extraction, and merges validated terms into the dictionary. The loop operates as a Claude Code `/loop` command:

```bash
$env:EXPAND_WRITE="1"; npm run dictionary:expand && \
  npm run dictionary:mine-local && \
  npm run dictionary:coverage && \
  npm run stats:update
```

Each iteration processes approximately 30,000 characters of comment text (~120 messages) and takes 5–8 minutes. With the full 512K-message local corpus, a complete sweep requires approximately 70 iterations (~9 hours at 15-minute intervals) and yields 5–20 new terms plus approximately 1,500 evidence boosts for existing terms.

### 5.3 Auto-Coverage Loop

The auto-coverage loop is the most powerful—and most constrained—path. It requires a valid Bilibili session cookie (SESSDATA) for live API access. Each cycle consists of six stages:

1. **Audit:** Build a coverage audit of all dictionary terms, identifying weak terms (evidence count < target) and zero-evidence terms.
2. **Query Generation:** Generate Bilibili search queries for weak terms using term-specific query templates.
3. **Harvest:** Search Bilibili videos for each query, scan the top comment pages, and collect candidate comments containing the target term.
4. **Validate:** DeepSeek V4 verifies that the collected comments genuinely contain or exemplify the term in context, rejecting false positives.
5. **Prune:** Remove terms that remain unverifiable after a configurable number of attempts (≥ 3 is recommended for convergence).
6. **Repeat:** Loop until the coverage target is reached or the cycle limit is exhausted.

The loop is intentionally conservative: sequential requests, brief caching on success, capped pages per video, and a cooldown period on rate-limit blocks rather than fast retries. Pacing is controlled via environment variables (`BILIBILI_CRAWLER_MIN_DELAY_MS`, `BILIBILI_CRAWLER_JITTER_MS`, `BILIBILI_CRAWLER_BLOCK_COOLDOWN_MS`), defaulting to 900 ms delay, 700 ms jitter, and 45 s cooldown.

Convergence to near-100% coverage requires sustained harvesting, exhausted-term pruning, parallelization across isolated git worktrees, and merging of parallel agent outputs.

## 6. System Architecture

The system follows a hybrid JavaScript + Python architecture. JavaScript (React 19 + Vite frontend, Hono Node.js API backend) handles all real-time operations: user interaction, API routing, live Bilibili scraping, and dictionary harvesting. Python (standard library, 3.12+) handles offline data-heavy work: coverage auditing, calibration, harvest planning, and statistics generation. The two runtimes communicate exclusively through JSON payloads and CLI commands.

### 6.1 Component Diagram

```
┌─────────────────┐     /api/*      ┌──────────────────┐     HTTP      ┌─────────────────┐
│  React 19+Vite  │ ──────────────→ │  Hono Node.js    │ ───────────→ │  Bilibili       │
│  Frontend (SPA) │                 │  API (:8787)     │              │  Public API     │
└─────────────────┘                 └───┬───┬───┬──────┘              └─────────────────┘
                                        │   │   │
                           ┌────────────┘   │   └────────────┐
                           ▼                ▼                ▼
                  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
                  │  Keyword     │  │  Bilibili    │  │  DeepSeek    │
                  │  Harvester   │  │  Crawler     │  │  V4 Router   │
                  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
                         │                 │                  │
                         ▼                 ▼                  ▼
                  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
                  │  Dictionary  │  │  Local       │  │  DeepSeek    │
                  │  (.entries   │  │  Corpus      │  │  API         │
                  │  + .evidence)│  │  (comments   │  └──────────────┘
                  └──────┬───────┘  │  + danmaku)  │
                         │          └──────────────┘
                         ▼
                  ┌──────────────┐
                  │  Python 3.12 │
                  │  CLI utils   │
                  └──────┬───────┘
                         │
                         ▼
                  ┌──────────────┐
                  │  README      │
                  │  Stats+SVGs  │
                  └──────────────┘
```

**Figure 1.** System architecture. The frontend communicates with the Hono API over Vite-proxied HTTP; the API orchestrates Bilibili scraping, dictionary harvesting, and DeepSeek validation. Python utilities operate on the dictionary and corpus data offline.

### 6.2 Data Flow

The dictionary pipeline operates as a closed loop:

1. Bilibili public API → Crawler → local comment/danmaku corpus.
2. Corpus → Dictionary Harvester (DeepSeek extracts terms, meanings, families; substring + semantic matching locates evidence).
3. Harvester output → split JSON shards (`.entries/` + `.evidence/`).
4. Coverage Audit reads the dictionary, identifies weak/zero-evidence terms, and generates harvest action items.
5. Action items feed back into the Harvester, closing the loop.

The user analysis path is a separate, read-only flow:

> Browser (UID input) → Vite proxy → Hono API → Bilibili API + Dictionary → Hybrid Analyzer (DeepSeek + lexicon matching) → JSON response → React SPA radar chart + sentence breakdown.

## 7. Current Status and Limitations

### 7.1 Empirical Status

As of the most recent data snapshot:

- **Corpus size:** 8,972 comments/replies; 153,875 danmaku; 434 timeline data points tracking growth over time.
- **Dictionary size:** 4,956 terms across 6 families (attack: 642, absolutes: 842, evidence: 861, evasion: 931, cooperation: 868, correction: 812).
- **Coverage ratio:** 0.30% (15 terms reaching the τ = 3 evidence threshold). The dictionary was recently expanded from 1,639 to 4,956 terms; on the previous smaller dictionary, coverage was 96%+. Recovery is in progress through the coverage loops.
- **Evidence deficit:** Δ = 14,806 additional evidence hits needed for full coverage at τ = 3.

### 7.2 Limitations

1. **Sample representativeness.** The analysis operates on a bounded public comment sample. Users may exhibit different behavior in private messages, on other platforms, or in deleted/removed comments that are not accessible via the public API.

2. **Language evolution.** Chinese internet slang evolves rapidly. Dictionary terms can become obsolete or shift meaning within months. The coverage loops provide a mechanism for continuous refresh but require sustained operation.

3. **Model dependence.** The semantic judge path depends on DeepSeek V4's ability to understand Chinese internet pragmatics. While the model performs well on standard Chinese text, it may misclassify highly niche, community-specific in-jokes.

4. **Cookie requirement.** The auto-coverage loop requires a valid Bilibili session cookie, which imposes a practical barrier for new users and limits automated CI/CD integration.

5. **Bilingual tooling.** While the documentation and output are bilingual (Chinese + English), the underlying analysis pipeline is optimized for Chinese text.

6. **Calibration data.** The logistic regression weights *wᵢ* are learned from human-labeled data. The current labeled dataset is small (*n* < 100), limiting confidence in the weight estimates.

## 8. Future Work

Several directions would strengthen the system:

1. **Large-scale annotation.** A crowd-sourced or expert annotation campaign (*n* ≥ 1,000) would improve the calibration of the logistic regression weights and enable more sophisticated models.

2. **Temporal analysis.** Tracking a user's dimension scores over time would reveal whether argumentative behavior is stable or context-dependent.

3. **Cross-platform generalization.** Adapting the dictionary and scoring framework to other Chinese-language platforms (Weibo, Douyin, Zhihu) would test the generalizability of the six-dimension model.

4. **Semantic matching improvements.** The current local embedding model (`all-MiniLM-L6-v2`) achieves only 27% recall on Chinese internet slang. A domain-adapted or larger multilingual model could improve semantic matching.

5. **Automated coverage convergence.** Integrating the three coverage loops into a fully autonomous CI/CD pipeline would enable continuous dictionary improvement with minimal human intervention.

6. **Explainability.** Providing an interactive interface that allows clicking on any radar-chart point to see the specific comments and dictionary terms that contributed to that score.

## 9. Conclusion

We have presented a research prototype for argumentative-behavior risk assessment on the Bilibili platform. The system combines a theory-grounded six-dimensional scoring framework with an auditable Chinese internet-slang dictionary and three iterative coverage loops that progressively close the evidence gap. The hybrid JS + Python architecture separates real-time user-facing operations from offline data-heavy work, communicating through JSON contracts. While the current dictionary coverage is low (0.30%) following a recent expansion, the coverage-loop mechanisms provide a principled path to convergence. The system is released as open-source software under the MIT License at https://github.com/JunWeiLi233/Bilibili_User_Personality.

---

## References

1. T. Davidson, D. Warmsley, M. Macy, and I. Weber, "Automated hate speech detection and the problem of offensive language," in *Proc. ICWSM*, 2017.

2. A. Founta et al., "Large scale crowdsourcing and characterization of Twitter abusive behavior," in *Proc. ICWSM*, 2018.

3. L.-W. Ku, Y.-T. Liang, and H.-H. Chen, "Opinion extraction, summarization and tracking in news and blog corpora," in *Proc. AAAI Spring Symposium*, 2007.

4. Z. Dong and Q. Dong, *HowNet and the Computation of Meaning*. World Scientific, 2006.

5. M. Stede and J. Schneider, "Argumentation mining," *Synthesis Lectures on Human Language Technologies*, vol. 11, no. 2, 2018.

6. A. Peldszus and M. Stede, "From argument diagrams to argumentation mining in texts," *International Journal of Cognitive Informatics and Natural Intelligence*, vol. 7, no. 1, 2013.

7. A. W. Kruglanski and D. M. Webster, "Motivated closing of the mind: 'Seizing' and 'freezing'," *Psychological Review*, vol. 103, no. 2, pp. 263–283, 1996.

8. H. P. Grice, "Logic and conversation," in *Syntax and Semantics, Vol. 3: Speech Acts*, Academic Press, 1975, pp. 41–58.
