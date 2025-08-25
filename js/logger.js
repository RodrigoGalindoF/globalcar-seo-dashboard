// ===== Simple Console Logger =====
export class Logger {
    constructor() {
        // Simplified constructor - no unused parameters needed
    }

    log(level, message, data = null) {
        const timestamp = new Date().toISOString();
        
        // Console output only - no internal storage needed
        const consoleMessage = `[${timestamp}] [${level}] ${message}`;
        if (data) {
            console.log(consoleMessage, data);
        } else {
            console.log(consoleMessage);
        }
    }

    info(message, data = null) {
        this.log('INFO', message, data);
    }

    error(message, data = null) {
        this.log('ERROR', message, data);
    }

    warn(message, data = null) {
        this.log('WARN', message, data);
    }

    debug(message, data = null) {
        this.log('DEBUG', message, data);
    }
}

// Create and export a default logger instance
export const logger = new Logger(); 