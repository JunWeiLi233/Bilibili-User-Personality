import { join } from 'node:path';

export const DATA_DIR = join(process.cwd(), 'server', 'data');
export const DEFAULT_DICTIONARY_PATH = join(DATA_DIR, 'deepseekKeywordDictionary.json');
export const DEFAULT_HARVEST_STATE_PATH = join(DATA_DIR, 'keywordHarvestState.json');
export const DEFAULT_HARVEST_REPORT_PATH = join(DATA_DIR, 'keywordHarvestReport.json');
export const DEFAULT_HARVEST_LOCK_PATH = join(DATA_DIR, '.keyword-harvest.lock');
export const DEFAULT_COVERAGE_AUDIT_REPORT_PATH = join(DATA_DIR, 'keywordCoverageAudit.json');
export const DEFAULT_COVERAGE_QUERY_FILE_PATH = join(DATA_DIR, 'keywordCoverageQueries.txt');
export const DEFAULT_COVERAGE_ACTION_FILE_PATH = join(DATA_DIR, 'keywordCoverageActions.json');
export const DEFAULT_COVERAGE_LOOP_REPORT_PATH = join(DATA_DIR, 'keywordCoverageLoopReport.json');
export const DEFAULT_HUGGINGFACE_CORPUS_PATH = join(DATA_DIR, 'huggingFaceKeywordCorpus.json');
