const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const COLORS = { error: '\x1b[31m', warn: '\x1b[33m', info: '\x1b[36m', debug: '\x1b[90m' };
const RESET = '\x1b[0m';

const currentLevel = LEVELS[process.env.LOG_LEVEL || 'info'] ?? LEVELS.info;

function log(level, tag, msg, data) {
  if ((LEVELS[level] ?? 3) > currentLevel) return;
  const ts = new Date().toISOString().slice(11, 23);
  const color = COLORS[level] || '';
  const prefix = `${color}[${ts}]${RESET} ${color}[${level.toUpperCase()}]${RESET} ${tag ? `[${tag}] ` : ''}`;
  if (data !== undefined) {
    console[level === 'error' ? 'error' : 'log'](`${prefix}${msg}`, data);
  } else {
    console[level === 'error' ? 'error' : 'log'](`${prefix}${msg}`);
  }
}

module.exports = {
  error: (tag, msg, data) => log('error', tag, msg, data),
  warn:  (tag, msg, data) => log('warn', tag, msg, data),
  info:  (tag, msg, data) => log('info', tag, msg, data),
  debug: (tag, msg, data) => log('debug', tag, msg, data),
  LEVELS,
};
