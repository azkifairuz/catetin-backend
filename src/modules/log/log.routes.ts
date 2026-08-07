import { Elysia, t } from "elysia";
import { getFilteredLogs } from "./log.service";
import { logsHtml } from "./log.view";

export const logRoutes = new Elysia({ prefix: "/logs" })
  .get("/", ({ set }) => {
    set.headers["content-type"] = "text/html; charset=utf-8";
    return logsHtml;
  })
  .get(
    "/data",
    ({ query }) => {
      return {
        success: true,
        message: "Logs fetched",
        data: getFilteredLogs(query.search),
        error: null,
      };
    },
    {
      query: t.Object({
        search: t.Optional(t.String()),
      }),
    },
  );
