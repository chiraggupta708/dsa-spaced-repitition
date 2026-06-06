/**
 * LeetCode problem fetcher
 * Uses LeetCode's public GraphQL API (no auth required for problem data)
 */

const LEETCODE_GRAPHQL = 'https://leetcode.com/graphql/';

const PROBLEM_QUERY = `
  query questionData($slug: String!) {
    question(titleSlug: $slug) {
      questionId
      questionFrontendId
      title
      difficulty
      content
      topicTags { name }
    }
  }
`;

/**
 * Extract title slug from LeetCode URL
 * Returns null for invalid URLs
 */
function extractSlug(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('leetcode.com')) return null;
    const match = u.pathname.match(/^\/problems\/([a-z0-9-]+)/i);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Fetch problem data from LeetCode GraphQL API
 */
async function fetchProblem(slug) {
  const response = await fetch(LEETCODE_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: PROBLEM_QUERY,
      variables: { slug }
    })
  });

  if (!response.ok) {
    throw new Error(`LeetCode API returned ${response.status}`);
  }

  const json = await response.json();

  if (json.errors && json.errors.length > 0) {
    const msg = json.errors[0].message || 'Unknown LeetCode API error';
    if (msg.includes('not find') || msg.includes('does not exist')) {
      throw new Error('Problem not found');
    }
    throw new Error(msg);
  }

  const q = json.data && json.data.question;
  if (!q) {
    throw new Error('Problem not found');
  }

  return {
    title: q.title || '',
    titleSlug: slug,
    difficulty: (q.difficulty || 'Medium').toLowerCase(),
    tags: (q.topicTags || []).map(t => t.name),
    description: cleanHtml(q.content || ''),
    url: `https://leetcode.com/problems/${slug}/`
  };
}

/**
 * Clean LeetCode HTML content to plain text
 * Handles: <p>, <pre>, <code>, <li>, <strong>, <em>, <br>, <a>
 */
function cleanHtml(html) {
  if (!html) return '';
  let text = html
    // Replace <br> and <br/> with newlines
    .replace(/<br\s*\/?>/gi, '\n')
    // Replace </p> with double newline
    .replace(/<\/p>/gi, '\n\n')
    // Replace <li> with bullet
    .replace(/<li[^>]*>/gi, '- ')
    // Replace </li> with newline
    .replace(/<\/li>/gi, '\n')
    // Replace <pre> blocks with code fences
    .replace(/<pre[^>]*>/gi, '\n')
    .replace(/<\/pre>/gi, '\n')
    // Replace <code> with backticks
    .replace(/<code[^>]*>/gi, ' `')
    .replace(/<\/code>/gi, '` ')
    // Replace <strong>/<b> with **
    .replace(/<(strong|b)[^>]*>/gi, '**')
    .replace(/<\/(strong|b)>/gi, '**')
    // Replace <em>/<i> with *
    .replace(/<(em|i)[^>]*>/gi, '*')
    .replace(/<\/(em|i)>/gi, '*')
    // Replace <a href="x">text</a> with text (url)
    .replace(/<a[^>]+href="([^"]+)"[^>]*>/gi, '')
    .replace(/<\/a>/gi, '')
    // Strip all remaining HTML tags
    .replace(/<[^>]*>/g, '')
    // Decode common HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Collapse multiple newlines to max 2
    .replace(/\n{3,}/g, '\n\n')
    // Trim each line
    .split('\n').map(l => l.trim()).join('\n')
    .trim();

  return text;
}

export { extractSlug, fetchProblem, cleanHtml };
