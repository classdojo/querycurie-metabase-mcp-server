/**
 * Error types and classes for the Metabase MCP Server
 */
export var ErrorCode;
(function (ErrorCode) {
    ErrorCode["InternalError"] = "internal_error";
    ErrorCode["InvalidRequest"] = "invalid_request";
    ErrorCode["InvalidParams"] = "invalid_params";
    ErrorCode["MethodNotFound"] = "method_not_found";
})(ErrorCode || (ErrorCode = {}));
export class McpError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "McpError";
    }
}
