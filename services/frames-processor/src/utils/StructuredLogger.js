import util from 'util';

const LOGGER_STATE_KEY = Symbol.for('samsar.structured_logger');
const MAX_DEPTH = 5;
const MAX_ITEMS = 25;
const MAX_STRING_LENGTH = 8000;

function getLoggerState() {
  if (!globalThis[LOGGER_STATE_KEY]) {
    globalThis[LOGGER_STATE_KEY] = {
      installed: false,
      originalConsole: {
        debug: console.debug.bind(console),
        info: console.info.bind(console),
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
      },
    };
  }

  return globalThis[LOGGER_STATE_KEY];
}

function truncateString(value, maxLength = MAX_STRING_LENGTH) {
  if (typeof value !== 'string') {
    return value;
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}... [truncated ${value.length - maxLength} chars]`;
}

function tryParseJson(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function isErrorLike(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return value instanceof Error || typeof value.message === 'string' || typeof value.stack === 'string';
}

function sanitizeValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return truncateString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }

  if (Buffer.isBuffer(value)) {
    return `[Buffer length=${value.length}]`;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (isErrorLike(value)) {
    return serializeError(value, depth, seen);
  }

  if (depth >= MAX_DEPTH) {
    return `[${Object.prototype.toString.call(value)}]`;
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);

    if (Array.isArray(value)) {
      return value.slice(0, MAX_ITEMS).map((entry) => sanitizeValue(entry, depth + 1, seen));
    }

    const output = {};
    for (const [key, entry] of Object.entries(value).slice(0, MAX_ITEMS)) {
      output[key] = sanitizeValue(entry, depth + 1, seen);
    }

    return output;
  }

  return truncateString(String(value));
}

function serializeError(error, depth = 0, seen = new WeakSet()) {
  if (!error || typeof error !== 'object') {
    return {
      message: truncateString(String(error)),
    };
  }

  if (seen.has(error)) {
    return '[CircularError]';
  }

  seen.add(error);

  const serialized = {
    name: error.name || 'Error',
    message: truncateString(error.message || String(error)),
    stack: truncateString(error.stack || null, 16000),
  };

  for (const key of ['code', 'status', 'statusCode', 'errno', 'syscall', 'path', 'method', 'requestId']) {
    if (error[key] !== undefined && error[key] !== null) {
      serialized[key] = sanitizeValue(error[key], depth + 1, seen);
    }
  }

  if (error.response) {
    serialized.response = sanitizeValue({
      status: error.response.status,
      statusText: error.response.statusText,
      data: error.response.data,
    }, depth + 1, seen);
  }

  if (error.cause) {
    serialized.cause = sanitizeValue(error.cause, depth + 1, seen);
  }

  return serialized;
}

function formatConsoleArgs(args) {
  return truncateString(args.map((arg) => {
    if (arg instanceof Error) {
      return arg.stack || `${arg.name}: ${arg.message}`;
    }

    if (typeof arg === 'string') {
      return arg;
    }

    return util.inspect(arg, {
      depth: 5,
      breakLength: Infinity,
      maxArrayLength: 20,
      compact: true,
    });
  }).join(' '));
}

function isPreformattedStructuredLog(value) {
  const parsed = tryParseJson(value);
  return Boolean(parsed && parsed.level && parsed.timestamp);
}

function buildContext(args, errorArg) {
  const relevantArgs = (typeof args[0] === 'string' ? args.slice(1) : args)
    .filter((entry) => entry !== errorArg);

  if (!relevantArgs.length) {
    return undefined;
  }

  const serializedArgs = relevantArgs.map((entry) => sanitizeValue(entry));
  return serializedArgs.length === 1 ? serializedArgs[0] : serializedArgs;
}

function emitStructuredConsoleEntry(method, level, args, options) {
  const state = getLoggerState();
  const originalMethod = state.originalConsole[method] || state.originalConsole.log;

  if (args.length === 1 && isPreformattedStructuredLog(args[0])) {
    originalMethod(args[0]);
    return;
  }

  const errorArg = args.find((entry) => isErrorLike(entry));
  const entry = {
    level,
    service: options.serviceName,
    component: options.component || null,
    timestamp: new Date().toISOString(),
    message: formatConsoleArgs(args),
  };

  const context = buildContext(args, errorArg);
  if (context !== undefined) {
    entry.context = context;
  }

  if (errorArg) {
    const serializedError = serializeError(errorArg);
    entry.error = serializedError;
    entry.errorName = serializedError.name || null;
    entry.errorMessage = serializedError.message || null;
    entry.errorStack = serializedError.stack || null;
    if (serializedError.code !== undefined) {
      entry.errorCode = serializedError.code;
    }
  }

  originalMethod(JSON.stringify(entry));
}

export function installStructuredLogger(options = {}) {
  const state = getLoggerState();
  if (state.installed) {
    return;
  }

  const serviceName = options.serviceName || process.env.SERVICE_NAME || 'unknown_service';
  const component = options.component || process.env.SERVICE_COMPONENT || null;

  console.error = (...args) => emitStructuredConsoleEntry('error', 'error', args, { serviceName, component });
  console.warn = (...args) => emitStructuredConsoleEntry('warn', 'warn', args, { serviceName, component });
  console.info = (...args) => emitStructuredConsoleEntry('info', 'info', args, { serviceName, component });
  console.debug = (...args) => emitStructuredConsoleEntry('debug', 'debug', args, { serviceName, component });

  state.installed = true;
  state.serviceName = serviceName;
  state.component = component;
}
