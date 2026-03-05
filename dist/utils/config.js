/**
 * Configuration utilities for the Metabase MCP Server
 */
/**
 * Load configuration from environment variables
 */
export function loadConfig() {
    const url = process.env.METABASE_URL;
    const username = process.env.METABASE_USERNAME;
    const password = process.env.METABASE_PASSWORD;
    const apiKey = process.env.METABASE_API_KEY;
    if (!url) {
        throw new Error("METABASE_URL environment variable is required");
    }
    if (!apiKey && (!username || !password)) {
        throw new Error("Either (METABASE_URL and METABASE_API_KEY) or (METABASE_URL, METABASE_USERNAME, and METABASE_PASSWORD) environment variables are required");
    }
    return {
        url,
        username,
        password,
        apiKey,
    };
}
/**
 * Validate configuration
 */
export function validateConfig(config) {
    if (!config.url) {
        throw new Error("Metabase URL is required");
    }
    if (!config.apiKey && (!config.username || !config.password)) {
        throw new Error("Either API key or username/password combination is required");
    }
    // Validate URL format
    try {
        new URL(config.url);
    }
    catch (error) {
        throw new Error("Invalid Metabase URL format");
    }
}
