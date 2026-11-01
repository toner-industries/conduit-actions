// The memory engine's routes these scripts use. The key travels only in the Authorization header:
// never put it in a message, a log line or an output.
const DEFAULT_TIMEOUT_MS = 20_000;
const USER_AGENT = 'conduit-actions-memory-citations/1.0';

/** Every call answers {status, body}; status 0 means the engine could not be reached in time. */
export function createEngine({ url, key, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!key) throw new Error('the memory key is not set: pass the repository memory key as the memory_api_key secret');
  const base = url.replace(/\/$/, '');

  async function call(method, path, body) {
    try {
      const response = await fetchImpl(base + path, {
        method,
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'user-agent': USER_AGENT },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    } catch {
      return { status: 0, body: null };
    }
  }

  return {
    search: (id) => call('GET', `/v1/retrievals/${encodeURIComponent(id)}`),
    memory: (id) => call('GET', `/v1/memories/${encodeURIComponent(id)}`),
    reviewOutcome: (retrievalId, rewards) => call('POST', '/v1/feedback', { retrievalId, rewards, kind: 'review_outcome' }),
    ingest: (memories) => call('POST', '/v1/memories', memories),
  };
}

export function isRefusedKey(status) {
  return status === 401 || status === 403;
}
