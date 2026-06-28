const fs = require("fs");
let c = fs.readFileSync("src/main.jsx", "utf-8");

// Extract handlePublicSearch function body
const fnBody = `  const handlePublicSearch = async (searchUid) => {
    setQuery(searchUid);
    setUid(searchUid);
    setAnalysisState('loading');
    setFetchState({ status: 'loading', message: ` + "`正在获取 UID ${searchUid} 的评论数据...`" + ` });
    try {
      const response = await fetch('/api/bilibili/analyze-uid', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uid: searchUid }),
      });
      if (!response.ok) throw new Error(` + "`服务器错误 (${response.status})`" + `);
      const data = await response.json();
      if (!data.ok) {
        setFetchState({ status: 'error', message: data.error || '获取失败' });
        setAnalysisState('ready');
        return;
      }
      const user = data.user || data;
      const commentText = user.combinedText || user.commentText || '';
      setCommentText(commentText);
      const generated = scoreComments({
        name: ` + "`UID ${user.uid || searchUid}`" + `,
        uid: ` + "`mid ${user.uid || searchUid}`" + `,
        text: commentText,
        runtimeLexicon,
        analysisMode: 'hybrid',
      });
      setProfiles([generated]);
      setSelectedId(generated.id);
      setActiveError('全部');
      setFetchState({
        status: 'ready',
        message: ` + "`${user.commentCount || generated.sampleSize} 条评论 · ${data.cached ? '已缓存' : '新获取'}`" + `,
      });
      setAnalysisState('ready');
    } catch (error) {
      setFetchState({ status: 'error', message: ` + "`获取失败：${error.message}`" + ` });
      setAnalysisState('ready');
    }
  };`;

// Remove handlePublicSearch from inside perThousand
c = c.replace(/  const handlePublicSearch = async \(searchUid\) => \{[\s\S]*?\n  \};/, "  // handlePublicSearch moved to App component body");

// Insert handlePublicSearch just before the App return
const returnMarker = "  // 获得用户真实评论数据并以关键词匹配法分析其对抗性行为\n  return (";
c = c.replace(returnMarker, fnBody + "\n\n" + returnMarker);

fs.writeFileSync("src/main.jsx", c, "utf-8");
console.log("Done");
