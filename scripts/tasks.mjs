// Keep the same telemetry policy in PowerShell, cmd and POSIX shells.
process.env.TURBO_TELEMETRY_DISABLED = '1';
process.env.DO_NOT_TRACK = '1';
await import('turbo');
