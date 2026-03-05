/**
 * Tool filtering utilities for --write, --essential, and --all flags
 */
/**
 * Parse command line arguments for tool filtering options
 * Default mode is 'essential' unless another flag is specified
 */
export function parseToolFilterOptions() {
    const args = process.argv.slice(2);
    // Check for explicit mode flags in priority order
    if (args.includes('--all')) {
        return { mode: 'all' };
    }
    if (args.includes('--write')) {
        return { mode: 'write' };
    }
    if (args.includes('--essential')) {
        return { mode: 'essential' };
    }
    // Default to essential mode
    return { mode: 'essential' };
}
