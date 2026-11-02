/** Turn off to hide every GitHub link in the interface, for a private fork. */
export const REPO_PUBLIC = true;

export const REPO = "noah-thing/openroll";
export const REPO_URL = `https://github.com/${REPO}`;
export const ISSUES_NEW_URL = `${REPO_URL}/issues/new`;
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;

/** The team's messages live in the repository, so publishing one is a commit. */
export const NEWS_FEED = `https://raw.githubusercontent.com/${REPO}/main/news/feed.json`;
/** Community templates live in the repository too: a pull request adds a file and a line in the index. */
export const TEMPLATES_BASE = `https://raw.githubusercontent.com/${REPO}/main/templates/`;
export const releaseByTagApi = (tag: string) => `https://api.github.com/repos/${REPO}/releases/tags/${tag}`;
