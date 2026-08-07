import { getLogEntries } from "../../lib/log-service";
export const getFilteredLogs = (searchText?: string) => {
  const search = searchText?.trim().toLowerCase();
  const logs = getLogEntries();
  return search ? logs.filter((log) => JSON.stringify(log).toLowerCase().includes(search)) : logs;
};
