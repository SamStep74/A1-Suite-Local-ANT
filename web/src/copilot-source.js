"use strict";

function getSourceLink(source) {
  const raw = typeof source?.sourceUrl === "string" ? source.sourceUrl.trim() : "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    return {
      href: url.href,
      host: url.hostname.replace(/^www\./i, "")
    };
  } catch {
    return null;
  }
}

function formatSourceDate(source) {
  const candidate = source?.latestReview?.createdAt || source?.latestReview?.reviewedAt || source?.effectiveDate;
  if (typeof candidate === "string" && /^\d{4}-\d{2}-\d{2}/.test(candidate)) {
    return candidate.slice(0, 10);
  }
  return "\u0561\u057c\u0561\u0576\u0581 \u0561\u0574\u057d\u0561\u0569\u057e\u056b";
}

exports.getSourceLink = getSourceLink;
exports.formatSourceDate = formatSourceDate;
