import http from "node:http";

const PORT = Number(process.env.PORT || 8080);

const routes = {
  "GET /health": () => ({ status: 200, body: { ok: true, service: "sistema-de-mel-api" } }),
  "GET /api/v1": () => ({
    status: 200,
    body: {
      name: "Sistema de MEL API",
      version: "v1",
      resources: ["programs", "indicators", "reports", "forms", "submissions", "concept-papers", "actions"],
    },
  }),
};

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const key = `${request.method} ${pathname}`;
  const handler = routes[key];

  if (!handler) {
    sendJson(response, 404, { error: "Route not found" });
    return;
  }

  const result = handler();
  sendJson(response, result.status, result.body);
});

server.listen(PORT, () => {
  console.log(`Sistema de MEL API listening on http://localhost:${PORT}`);
});
