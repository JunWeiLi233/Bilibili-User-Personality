import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  extractJsonObject,
  getDeepSeekConfig,
  mergeEntriesIntoDictionary,
  normalizeKeywordEntries,
  trainKeywordDictionary,
} from './deepseekKeywordTrainer.js';

test('selects configured DeepSeek V4 model when the key is present', async () => {
  const config = await getDeepSeekConfig({
    env: {
      DEEPSEEK_API_KEY: 'test-key',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
      DEEPSEEK_MODEL: 'deepseek-v4-pro',
    },
    fetch: async (url, options) => {
      assert.equal(String(url), 'https://api.deepseek.com/models');
      assert.equal(options.headers.authorization, 'Bearer test-key');
      return {
        ok: true,
        json: async () => ({
          data: [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro' }],
        }),
      };
    },
  });

  assert.equal(config.provider, 'deepseek');
  assert.equal(config.model, 'deepseek-v4-pro');
  assert.equal(config.available, true);
  assert.equal(config.keyConfigured, true);
});

test('reports DeepSeek API key missing without exposing secrets', async () => {
  const config = await getDeepSeekConfig({ env: {} });

  assert.equal(config.provider, 'deepseek');
  assert.equal(config.model, 'deepseek-v4-flash');
  assert.equal(config.available, false);
  assert.equal(config.keyConfigured, false);
});

test('normalizes DeepSeek keyword output into supported dictionary families', () => {
  const entries = normalizeKeywordEntries([
    { term: '不会真有人', family: 'sarcasm', meaning: '反讽式资格审查', variants: ['不会真有人觉得'] },
    { term: '懂的都懂', family: 'evidenceShift', meaning: '拒绝解释，把举证责任推给对方' },
    { term: '我说重了', family: 'correction', meaning: '自我降级修正' },
    { term: '变体1', family: 'attack', meaning: '中文含义和语用功能' },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.family]), [
    ['不会真有人', 'attack'],
    ['不会真有人觉得', 'attack'],
    ['懂的都懂', 'evasion'],
    ['我说重了', 'correction'],
  ]);
});

test('extracts JSON object from verbose DeepSeek responses', () => {
  const parsed = extractJsonObject('```json\n{"keywords":[{"term":"典中典","family":"attack"}]}\n```');
  assert.deepEqual(parsed, { keywords: [{ term: '典中典', family: 'attack' }] });
});

test('merges learned keyword entries into a persistent local dictionary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-keywords-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    const dictionary = await mergeEntriesIntoDictionary(
      [
        { term: '典中典', family: 'attack', meaning: '套娃式嘲讽' },
        { term: '自己查', family: 'evasion', meaning: '转移举证责任' },
      ],
      { dictionaryPath },
    );

    assert.deepEqual(dictionary.families.attack, ['典中典']);
    assert.deepEqual(dictionary.families.evasion, ['自己查']);
    const persisted = JSON.parse(await readFile(dictionaryPath, 'utf8'));
    assert.equal(persisted.entries.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('trains dictionary through DeepSeek V4 chat output and persists learned terms', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-train-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  const seen = [];
  try {
    const result = await trainKeywordDictionary(
      {
        text: '不会真有人觉得这叫证据吧，懂的都懂。',
        uid: '453244911',
      },
      {
        dictionaryPath,
        env: {
          DEEPSEEK_API_KEY: 'test-key',
          DEEPSEEK_MODEL: 'deepseek-v4-flash',
        },
        fetch: async (url, options = {}) => {
          seen.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null, headers: options.headers });
          if (String(url).endsWith('/models')) {
            return { ok: true, json: async () => ({ data: [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro' }] }) };
          }
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      keywords: [
                        { term: '不会真有人', family: 'sarcasm', meaning: '用反问包装资格审查' },
                        { term: '懂的都懂', family: 'evidenceShift', meaning: '暗示无需证明' },
                      ],
                    }),
                  },
                },
              ],
            }),
          };
        },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.provider, 'deepseek');
    assert.equal(result.model, 'deepseek-v4-flash');
    assert.equal(result.entries.length >= 2, true);
    assert.equal(result.dictionary.families.attack.includes('不会真有人'), true);
    assert.equal(result.dictionary.families.evasion.includes('懂的都懂'), true);
    assert.equal(seen.some((call) => call.url === 'https://api.deepseek.com/chat/completions'), true);
    assert.equal(seen.find((call) => call.body?.model)?.body.response_format.type, 'json_object');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
