const fs = require('fs');
const path = require('path');

// Test assertions
console.log('=== TESTS WITHOUT ASSERTIONS ===');
try {
  for (const f of fs.readdirSync('server/services')) {
    if (!f.endsWith('.test.js')) continue;
    const fp = path.join('server/services', f);
    const content = fs.readFileSync(fp, 'utf8');
    const hasAssert = /assert\.|strictEqual|deepEqual|ok\(|equal\(|\.toBe|\.toEqual|expect\(/.test(content);
    if (!hasAssert) console.log('  WARNING: ' + fp);
  }
} catch(e) {}

// Gitignore gaps
console.log('\n=== GITIGNORE GAPS ===');
const gi = fs.readFileSync('.gitignore', 'utf8');
const missingPatterns = ['_browser_tieba_results', '_danmaku_matches', 'db_selected', 'extracted_uids', 'all_entries.json', 'selected_users_report', 'analyze_100_users', 'analyze_db_users', 'personality_analysis_data', 'collect_uids.py', 'extract_uids.py'];
for (const p of missingPatterns) {
  if (!gi.includes(p)) console.log('  MISSING from .gitignore: ' + p);
}

// Broken npm scripts
console.log('\n=== BROKEN NPM SCRIPTS ===');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
for (const [name, cmd] of Object.entries(pkg.scripts)) {
  const m = String(cmd).match(/(?:node|python)\s+(\S+)/);
  if (m && !cmd.includes('{') && !cmd.includes('$(')) {
    const target = m[1];
    if (!fs.existsSync(target)) console.log('  BROKEN: ' + name + ' -> ' + target);
  }
}
