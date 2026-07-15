import { Elysia, t } from "elysia";

import { getLogEntries } from "../../lib/log-service";

const logsHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Service Logs</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      color: #111;
      background: #fff;
    }
    main {
      width: min(1100px, calc(100% - 32px));
      margin: 32px auto;
    }
    header {
      display: flex;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }
    h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 700;
    }
    .controls {
      display: flex;
      gap: 8px;
      width: min(520px, 100%);
    }
    input, button {
      border: 1px solid #111;
      background: #fff;
      color: #111;
      font: inherit;
      height: 40px;
    }
    input {
      flex: 1;
      padding: 0 12px;
    }
    button {
      padding: 0 14px;
      cursor: pointer;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #111;
    }
    th, td {
      border-bottom: 1px solid #111;
      padding: 10px;
      text-align: left;
      vertical-align: top;
      font-size: 14px;
    }
    th {
      background: #111;
      color: #fff;
      font-weight: 700;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .empty {
      padding: 24px;
      border: 1px solid #111;
      text-align: center;
    }
    @media (max-width: 720px) {
      header { align-items: stretch; flex-direction: column; }
      .controls { width: 100%; }
      th:nth-child(1), td:nth-child(1) { display: none; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Service Logs</h1>
      <div class="controls">
        <input id="search" type="search" placeholder="Search logs" />
        <button id="refresh" type="button">Refresh</button>
      </div>
    </header>
    <div id="content" class="empty">Loading...</div>
  </main>
  <script>
    const content = document.getElementById('content');
    const search = document.getElementById('search');
    const refresh = document.getElementById('refresh');
    let logs = [];

    const render = () => {
      const keyword = search.value.trim().toLowerCase();
      const filtered = logs.filter((log) =>
        JSON.stringify(log).toLowerCase().includes(keyword)
      );

      if (!filtered.length) {
        content.className = 'empty';
        content.textContent = 'No logs found';
        return;
      }

      content.className = '';
      content.innerHTML = '<table><thead><tr><th>Timestamp</th><th>Status</th><th>Message</th><th>Data</th></tr></thead><tbody></tbody></table>';
      const tbody = content.querySelector('tbody');

      for (const log of filtered) {
        const row = document.createElement('tr');
        row.innerHTML =
          '<td></td><td></td><td></td><td><pre></pre></td>';
        row.children[0].textContent = log.timestamp;
        row.children[1].textContent = log.status;
        row.children[2].textContent = log.message;
        row.querySelector('pre').textContent = JSON.stringify(log.data, null, 2);
        tbody.appendChild(row);
      }
    };

    const loadLogs = async () => {
      content.className = 'empty';
      content.textContent = 'Loading...';
      const response = await fetch('/logs/data');
      const result = await response.json();
      logs = result.data ?? [];
      render();
    };

    refresh.addEventListener('click', loadLogs);
    search.addEventListener('input', render);
    loadLogs();
  </script>
</body>
</html>`;

export const logRoutes = new Elysia({ prefix: "/logs" })
  .get("/", ({ set }) => {
    set.headers["content-type"] = "text/html; charset=utf-8";
    return logsHtml;
  })
  .get(
    "/data",
    ({ query }) => {
      const search = query.search?.trim().toLowerCase();
      const logs = getLogEntries();
      const filteredLogs = search
        ? logs.filter((log) => JSON.stringify(log).toLowerCase().includes(search))
        : logs;

      return {
        success: true,
        message: "Logs fetched",
        data: filteredLogs,
        error: null,
      };
    },
    {
      query: t.Object({
        search: t.Optional(t.String()),
      }),
    },
  );
