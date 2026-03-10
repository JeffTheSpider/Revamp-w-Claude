// ============================================================
// File Logger
// ============================================================
// Simple file-based logger with daily rotation. Writes to
// LOG_DIR (default: ./logs). Keeps last 7 days of logs.
// ============================================================

const fs = require('fs');
const path = require('path');

class FileLogger {
  constructor(logDir = './logs', maxDays = 7) {
    this.logDir = path.resolve(logDir);
    this.maxDays = maxDays;
    this.currentDate = '';
    this.stream = null;

    // Ensure log directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    // Intercept console methods
    this._origLog = console.log;
    this._origError = console.error;
    this._origWarn = console.warn;

    console.log = (...args) => this.write('INFO', args);
    console.error = (...args) => this.write('ERROR', args);
    console.warn = (...args) => this.write('WARN', args);

    // Clean old logs on startup
    this._cleanOldLogs();
  }

  write(level, args) {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toISOString().slice(11, 19);
    const message = args.map(a =>
      typeof a === 'object' ? JSON.stringify(a) : String(a)
    ).join(' ');

    const line = `${dateStr} ${timeStr} [${level}] ${message}\n`;

    // Rotate file if date changed
    if (dateStr !== this.currentDate) {
      if (this.stream) this.stream.end();
      this.currentDate = dateStr;
      const filePath = path.join(this.logDir, `hub-${dateStr}.log`);
      this.stream = fs.createWriteStream(filePath, { flags: 'a' });
    }

    // Write to file
    if (this.stream) this.stream.write(line);

    // Also write to original console
    if (level === 'ERROR') this._origError(...args);
    else if (level === 'WARN') this._origWarn(...args);
    else this._origLog(...args);
  }

  _cleanOldLogs() {
    try {
      const files = fs.readdirSync(this.logDir);
      const cutoff = Date.now() - this.maxDays * 86400000;
      for (const file of files) {
        if (!file.startsWith('hub-') || !file.endsWith('.log')) continue;
        const filePath = path.join(this.logDir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
        }
      }
    } catch (_) {}
  }

  close() {
    if (this.stream) this.stream.end();
    console.log = this._origLog;
    console.error = this._origError;
    console.warn = this._origWarn;
  }
}

module.exports = FileLogger;
