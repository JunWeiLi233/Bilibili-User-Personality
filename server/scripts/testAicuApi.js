const AICU_API = 'https://api.aicu.cc/api/v3/search/getreply';

async function testApi() {
  try {
    const response = await fetch(`${AICU_API}?uid=100000&pn=1&ps=5&mode=0&keyword=`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.aicu.cc/',
      },
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✅ API is accessible');
      console.log(`   Response code: ${data.code}`);
      console.log(`   Comments found: ${data.data?.replies?.length || 0}`);
      return true;
    } else {
      console.log(`❌ API returned HTTP ${response.status}`);
      return false;
    }
  } catch (err) {
    console.log(`❌ API error: ${err.message}`);
    return false;
  }
}

testApi().then(ok => {
  if (ok) {
    console.log('\nYou can now run: npm run aicu:batch -- --start=100000 --end=200000');
  } else {
    console.log('\nAPI is still blocked. Try again later.');
  }
});
