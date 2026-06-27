"""Mine existing corpus for weak-coverage keyword evidence."""
import json
import glob
import os
import sys

# Fix encoding for Windows
sys.stdout.reconfigure(encoding='utf-8')

WEAK_KEYWORDS = [
    '说八百遍了','都说八百遍了','就是鬼畜标签','就算六个齐上也不是我对手',
    '没有成为炒饭的资格','男的就是这样','男的就是这样爱推卸责任',
    '缺点只有一个','缺点只有一个贵','茶庄10个有9个洗钱的',
    '谁都受不住','8打5的雷霆','一个多亿','侮辱乐手',
    '分不清轻重','分不清轻重就乱套','基本没有音乐理解',
    '就是要干你','换个地方再就业','有什么值得炫耀的',
]

# Also add all weak terms from the strict audit
WEAK_KEYWORDS += [
    '百分百一定是', '百分百对的', '百分百正确', '百分百错了',
    '百分百有问题', '百分百假的', '不可能有', '不可能没有',
    '不可能不知道', '不可能相信', '不可能这么', '永远都是',
    '永远不可能', '永远没有', '永远都是这样', '绝对不可能',
    '绝对没有', '绝对是', '绝对是假的', '绝对是真',
    '绝对是错的', '绝对是对的', '全是假的', '全是错的',
    '全是对的', '根本没有', '肯定没有', '肯定有问题',
]

com_dir = 'server/data/bilibiliDirectProbeCorpus.comments'
matches = {}
founds = set()

files = sorted(glob.glob(os.path.join(com_dir, 'comments-*.json')))
print(f"Searching {len(files)} shard files for {len(WEAK_KEYWORDS)} weak keywords...")

for i, fpath in enumerate(files):
    if i % 50 == 0:
        print(f"  Processing shard {i+1}/{len(files)}... found {len(founds)} keywords so far")
    try:
        with open(fpath, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"  Error reading {os.path.basename(fpath)}: {e}")
        continue

    comments = data.get('comments', [])
    for comment in comments:
        msg = comment.get('message', '')
        if not msg:
            continue
        for kw in WEAK_KEYWORDS:
            if kw in msg and kw not in founds:
                founds.add(kw)
                matches[kw] = {
                    'term': kw,
                    'message': msg[:500],
                    'source': comment.get('source', ''),
                    'uid': comment.get('uid', ''),
                    'file': os.path.basename(fpath),
                }
                if len(founds) % 5 == 0:
                    print(f"  Found '{kw}' in shard {os.path.basename(fpath)}")

    if len(founds) >= len(WEAK_KEYWORDS):
        break

print(f"\nResults: {len(founds)}/{len(WEAK_KEYWORDS)} keywords found in corpus")
print("\nKeywords FOUND:")
for kw in WEAK_KEYWORDS:
    if kw in founds:
        m = matches[kw]
        print(f"  ✓ {kw}")
        print(f"    Comment: ...{m['message'][:150]}...")
        print(f"    Source: {m['source']}")

print("\nKeywords NOT FOUND:")
for kw in WEAK_KEYWORDS:
    if kw not in founds:
        print(f"  ✗ {kw}")

# Save matches for evidence addition
with open('.claude/weak_keyword_matches.json', 'w', encoding='utf-8') as f:
    json.dump(matches, f, ensure_ascii=False, indent=2)
print(f"\nSaved {len(matches)} matches to .claude/weak_keyword_matches.json")
