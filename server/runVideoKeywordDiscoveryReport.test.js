import test from 'node:test';
import assert from 'node:assert/strict';

import { serializeVideoKeywordDiscoveryReport } from './runVideoKeywordDiscoveryReport.js';

test('serializeVideoKeywordDiscoveryReport keeps per-query diagnostics for harvest triage', () => {
  const report = serializeVideoKeywordDiscoveryReport(
    {
      requestedRounds: 1,
      growth: { before: 1, after: 1 },
      coverage: { coverageRatio: 0.5 },
      coverageActions: [],
      state: { searchedQueries: ['target 评论区'] },
      rounds: [
        {
          queries: ['target 评论区'],
          candidateQueries: ['target 评论区'],
          growth: { before: 1, after: 1 },
          coverage: { evidenceDeficit: 2 },
          coverageProgress: { evidenceGained: 0, evidenceDeficitReduced: 0 },
          termAttemptSummary: { attemptedTerms: 1 },
          warnings: [],
          trainingDiagnostics: { deepseekCalls: 1, evidenceRejected: 2, dictionaryEvidenceTerms: 0 },
          queryDiagnostics: [
            {
              query: 'target 评论区',
              commentsCollected: 240,
              trainingTextChars: 4096,
              targetExistingTerms: ['target'],
              acceptedTerms: [],
              evidenceRejected: 2,
            },
          ],
          results: [
            {
              query: 'target 评论区',
              result: {
                ok: true,
                videos: [{ bvid: 'BV1target', title: 'target title', sourceUrl: 'https://www.bilibili.com/video/BV1target/' }],
                comments: [{ rpid: 1 }],
                keywordTraining: { evidenceRejected: 2, dictionaryEvidenceEntries: [] },
                entries: [],
              },
            },
          ],
        },
      ],
    },
    'state.json',
    'report.json',
  );

  assert.deepEqual(report.rounds[0].trainingDiagnostics, { deepseekCalls: 1, evidenceRejected: 2, dictionaryEvidenceTerms: 0 });
  assert.deepEqual(report.rounds[0].queryDiagnostics, [
    {
      query: 'target 评论区',
      commentsCollected: 240,
      trainingTextChars: 4096,
      targetExistingTerms: ['target'],
      acceptedTerms: [],
      evidenceRejected: 2,
    },
  ]);
});
