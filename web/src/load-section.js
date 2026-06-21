"use strict";

async function loadOr(fallback, fetcher) {
  try {
    return await fetcher();
  } catch (error) {
    if (error && error.status === 401) throw error;
    return fallback;
  }
}

exports.loadOr = loadOr;
