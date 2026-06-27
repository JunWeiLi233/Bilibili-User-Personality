#!/bin/bash
# Tieba scraper: searches one query, extracts matching threads and comments
# Usage: bash .claude/tieba_scrape_one.sh "query_string" "keyword_term"
QUERY="$1"
TERM="$2"
OUTDIR=".claude/tieba_scrape"
mkdir -p "$OUTDIR"
SAFE_NAME=$(echo "$TERM" | sed 's/[^a-zA-Z0-9_一-鿿-]/_/g')
OUTFILE="$OUTDIR/${SAFE_NAME}.json"

browser-harness -c "
import json, urllib.parse, time

query = '''$QUERY'''
term = '''$TERM'''
outfile = r'$OUTFILE'

encoded = urllib.parse.quote(query)
url = f'https://tieba.baidu.com/f/search/res?qw={encoded}&sm=2'
smart_open(url)
wait_for_load()
wait(3)

# Check for safety verification
body = js('document.body.innerText.substring(0, 500)')
if '安全验证' in str(body):
    print('SAFETY_VERIFICATION: blocked')
    result = {'ok': False, 'error': 'safety_verification', 'threads': [], 'comments': []}
else:
    # Extract thread links
    raw = js('''
    JSON.stringify(
      Array.from(document.querySelectorAll('a'))
        .filter(a => a.href && a.href.includes('/p/'))
        .map(a => ({href: a.href, text: (a.innerText || a.textContent || '').trim().substring(0, 200)}))
        .filter(x => x.text.length > 0)
        .slice(0, 10)
    )
    ''')
    threads = json.loads(raw) if raw else []
    print(f'Search threads: {len(threads)}')

    comments = []
    # Visit top 3 threads
    for i, t in enumerate(threads[:3]):
        if i > 0:
            time.sleep(3)
        try:
            smart_open(t['href'])
            wait_for_load()
            wait(2)
            post_raw = js('''
            JSON.stringify(
              Array.from(document.querySelectorAll('.d_post_content, .p_content'))
                .map(el => (el.innerText || el.textContent || '').trim())
                .filter(t => t.length > 0)
                .slice(0, 30)
            )
            ''')
            posts = json.loads(post_raw) if post_raw else []
            matching = [p for p in posts if term.lower() in p.lower()]
            if matching:
                print(f'  Thread {i+1}: {len(matching)} matching posts')
                for m in matching:
                    comments.append({'thread_url': t['href'][:200], 'text': m[:500]})
        except Exception as e:
            print(f'  Thread {i+1} error: {e}')

    result = {'ok': True, 'threads': threads, 'comments': comments}

with open(outfile, 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=2)
print(f'Saved to {outfile}')
print(f'Comments found: {len(comments)}')
"
