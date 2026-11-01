/** Flip when the repository is made public. Until then no GitHub link is shown in the interface. */
export const REPO_PUBLIC = false;

export const REPO = "noah-thing/openroll";
export const REPO_URL = `https://github.com/${REPO}`;
export const ISSUES_NEW_URL = `${REPO_URL}/issues/new`;
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;

/** The team's messages live in the repository, so publishing one is a commit. */
export const NEWS_FEED = `https://raw.githubusercontent.com/${REPO}/main/news/feed.json`;
export const releaseByTagApi = (tag: string) => `https://api.github.com/repos/${REPO}/releases/tags/${tag}`;
