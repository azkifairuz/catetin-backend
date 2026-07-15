type LogStatus = number | string;

export type ServiceLogInput<TData = unknown> = {
  timestamp: string;
  status: LogStatus;
  message: string;
  data: TData;
};

const maxLogEntries = 500;
const logEntries: ServiceLogInput[] = [];

export const logService = <TData>(input: ServiceLogInput<TData>) => {
  logEntries.unshift(input);

  if (logEntries.length > maxLogEntries) {
    logEntries.length = maxLogEntries;
  }

  console.log(JSON.stringify(input));
};

export const logApiEvent = <TData>(
  status: LogStatus,
  message: string,
  data: TData,
) => {
  logService({
    timestamp: new Date().toISOString(),
    status,
    message,
    data,
  });
};

export const getLogEntries = () => logEntries;
