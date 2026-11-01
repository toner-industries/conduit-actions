// A stand-in for the memory engine's three routes the citation scripts use. Nothing reaches a network.
export function fakeEngine({ searches = {}, memories = [], status = {} } = {}) {
  const held = new Set(memories);
  const requests = [];
  const reviewed = new Set();
  async function fetchImpl(url, init = {}) {
    const path = new URL(url).pathname;
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    requests.push({ method: init.method ?? 'GET', path, body, authorization: init.headers?.authorization });
    if (status[path] === 'unreachable') throw new TypeError('fetch failed');
    if (status[path] !== undefined) return Response.json({ error: 'scripted' }, { status: status[path] });
    const search = /^\/v1\/retrievals\/(.+)$/.exec(path);
    if (search) return searches[search[1]] ? Response.json({ id: search[1], memoryIds: searches[search[1]] }) : notFound();
    const memory = /^\/v1\/memories\/(.+)$/.exec(path);
    if (memory) return held.has(memory[1]) ? Response.json({ id: memory[1], content: `text of ${memory[1]}`, memoryType: 'spo' }) : notFound();
    if (path === '/v1/feedback') {
      if (reviewed.has(body.retrievalId)) return Response.json({ error: 'a review outcome was already recorded' }, { status: 409 });
      reviewed.add(body.retrievalId);
      return Response.json({ kind: body.kind, updates: [] });
    }
    return notFound();
  }
  return { fetchImpl, requests, reviewed };
}

function notFound() {
  return Response.json({ error: 'not found' }, { status: 404 });
}
