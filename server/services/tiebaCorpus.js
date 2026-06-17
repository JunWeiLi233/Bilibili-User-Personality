export function uniqueTiebaComments(comments = []) {
  return [...new Map(
    comments
      .filter((comment) => String(comment?.message || '').trim())
      .map((comment) => [`${comment.sourceUrl || ''}\n${comment.rpid || ''}\n${comment.message}`, comment]),
  ).values()];
}

export function buildTiebaCorpusUpdate(corpus, run, generatedAt = new Date().toISOString()) {
  const existingCorpus = corpus && Array.isArray(corpus.runs)
    ? corpus
    : { version: 1, updatedAt: null, runs: [], comments: [] };
  const newComments = (run?.results || []).flatMap((result) => result.comments || []);
  if (newComments.length === 0) {
    return { changed: false, corpus: existingCorpus, newComments: [] };
  }

  const comments = uniqueTiebaComments([...(existingCorpus.comments || []), ...newComments]);
  return {
    changed: true,
    newComments,
    corpus: {
      version: 1,
      updatedAt: generatedAt,
      runs: [...(existingCorpus.runs || []).slice(-49), run],
      comments,
    },
  };
}
