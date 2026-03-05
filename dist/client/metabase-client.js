/**
 * Metabase API Client
 * Handles all API interactions with Metabase
 */
import axios from "axios";
import { ErrorCode, McpError } from "../types/errors.js";
export class MetabaseClient {
    axiosInstance;
    sessionToken = null;
    config;
    constructor(config) {
        this.config = config;
        this.axiosInstance = axios.create({
            baseURL: config.url,
            headers: {
                "Content-Type": "application/json",
            },
            timeout: 600000, // 10 minute timeout for long-running queries
        });
        if (config.apiKey) {
            this.logInfo("Using Metabase API Key for authentication.");
            this.axiosInstance.defaults.headers.common["X-API-Key"] = config.apiKey;
            this.sessionToken = "api_key_used";
        }
        else if (config.username && config.password) {
            this.logInfo("Using Metabase username/password for authentication.");
        }
        else {
            this.logError("Metabase authentication credentials not configured properly.", {});
            throw new Error("Metabase authentication credentials not provided or incomplete.");
        }
        // Add request interceptor to handle authentication automatically
        this.axiosInstance.interceptors.request.use(async (config) => {
            // Skip authentication for the session endpoint itself
            if (config.url === "/api/session") {
                return config;
            }
            // Ensure authentication before making any API call
            await this.ensureAuthenticated();
            return config;
        }, (error) => {
            return Promise.reject(error);
        });
    }
    logInfo(message, _data) {
        console.error(`INFO: ${message}`);
    }
    logError(message, error) {
        const errorObj = error;
        console.error(`ERROR: ${message} - ${errorObj.message || "Unknown error"}`);
    }
    /**
     * Get Metabase session token for username/password authentication
     */
    async getSessionToken() {
        if (this.sessionToken) {
            return this.sessionToken;
        }
        this.logInfo("Authenticating with Metabase using username/password...");
        try {
            const response = await this.axiosInstance.post("/api/session", {
                username: this.config.username,
                password: this.config.password,
            });
            this.sessionToken = response.data.id;
            // Set default request headers
            this.axiosInstance.defaults.headers.common["X-Metabase-Session"] =
                this.sessionToken;
            this.logInfo("Successfully authenticated with Metabase");
            return this.sessionToken;
        }
        catch (error) {
            this.logError("Authentication failed", error);
            throw new McpError(ErrorCode.InternalError, "Failed to authenticate with Metabase");
        }
    }
    /**
     * Ensure authentication is ready
     */
    async ensureAuthenticated() {
        if (!this.config.apiKey) {
            await this.getSessionToken();
        }
    }
    // Dashboard operations
    async getDashboards() {
        const response = await this.axiosInstance.get("/api/dashboard");
        return response.data;
    }
    async getDashboard(id) {
        const response = await this.axiosInstance.get(`/api/dashboard/${id}`);
        return response.data;
    }
    async createDashboard(dashboard) {
        const response = await this.axiosInstance.post("/api/dashboard", dashboard);
        return response.data;
    }
    async updateDashboard(id, updates) {
        const response = await this.axiosInstance.put(`/api/dashboard/${id}`, updates);
        return response.data;
    }
    async deleteDashboard(id, hardDelete = false) {
        if (hardDelete) {
            await this.axiosInstance.delete(`/api/dashboard/${id}`);
        }
        else {
            await this.axiosInstance.put(`/api/dashboard/${id}`, { archived: true });
        }
    }
    async getDashboardRelatedEntities(id) {
        const response = await this.axiosInstance.get(`/api/dashboard/${id}/related`);
        return response.data;
    }
    async getDashboardRevisions(id) {
        const response = await this.axiosInstance.get(`/api/dashboard/${id}/revisions`);
        return response.data;
    }
    async getEmbeddableDashboards() {
        const response = await this.axiosInstance.get('/api/dashboard/embeddable');
        return response.data;
    }
    async getPublicDashboards() {
        const response = await this.axiosInstance.get('/api/dashboard/public');
        return response.data;
    }
    async createDashboardPublicLink(id) {
        const response = await this.axiosInstance.post(`/api/dashboard/${id}/public_link`);
        return response.data;
    }
    async deleteDashboardPublicLink(id) {
        await this.axiosInstance.delete(`/api/dashboard/${id}/public_link`);
    }
    async copyDashboard(fromId, copyData = {}) {
        const response = await this.axiosInstance.post(`/api/dashboard/${fromId}/copy`, copyData);
        return response.data;
    }
    async addCardToDashboard(dashboardId, cardData) {
        // Get current dashboard to preserve existing state
        const dashboard = await this.getDashboard(dashboardId);
        const existingDashcards = dashboard.dashcards || [];
        const existingTabs = dashboard.tabs || [];
        // Calculate default position for new card
        const cardWidth = 24; // Full width on Metabase's 24-column grid
        const cardHeight = 8;
        // Build the new dashcard - use id: -1 for new cards per Metabase convention
        const newDashcard = {
            id: -1,
            row: cardData.row !== undefined ? cardData.row : 0,
            col: cardData.col !== undefined ? cardData.col : 0,
            size_x: cardData.size_x || cardData.sizeX || cardWidth,
            size_y: cardData.size_y || cardData.sizeY || cardHeight,
            series: cardData.series || [],
            visualization_settings: cardData.visualization_settings || {},
            parameter_mappings: cardData.parameter_mappings || []
        };
        // Handle card_id - can be null for text/virtual cards
        const cardId = cardData.cardId ?? cardData.card_id;
        if (cardId !== undefined) {
            newDashcard.card_id = cardId;
        }
        // Add dashboard_tab_id if provided (for dashboards with tabs)
        if (cardData.dashboard_tab_id !== undefined) {
            newDashcard.dashboard_tab_id = cardData.dashboard_tab_id;
        }
        // Clean existing dashcards - remove nested 'card' object and other read-only fields
        const cleanedExistingDashcards = existingDashcards.map((dc) => ({
            id: dc.id,
            card_id: dc.card_id,
            row: dc.row,
            col: dc.col,
            size_x: dc.size_x,
            size_y: dc.size_y,
            series: dc.series || [],
            visualization_settings: dc.visualization_settings || {},
            parameter_mappings: dc.parameter_mappings || [],
            ...(dc.dashboard_tab_id !== undefined && { dashboard_tab_id: dc.dashboard_tab_id })
        }));
        // Combine existing dashcards with new dashcard
        const updatedDashcards = [...cleanedExistingDashcards, newDashcard];
        // Use PUT /api/dashboard/:id with dashcards and tabs arrays
        const response = await this.axiosInstance.put(`/api/dashboard/${dashboardId}`, {
            dashcards: updatedDashcards,
            tabs: existingTabs
        });
        return response.data;
    }
    async updateDashboardCards(dashboardId, cards) {
        // Get current dashboard to preserve existing properties
        const dashboard = await this.getDashboard(dashboardId);
        // Replace all dashcards with the provided cards while preserving other properties
        const response = await this.axiosInstance.put(`/api/dashboard/${dashboardId}`, {
            ...dashboard,
            dashcards: cards
        });
        return response.data;
    }
    async updateDashcard(dashboardId, dashcardId, updates) {
        // Get current dashboard to preserve existing properties
        const dashboard = await this.getDashboard(dashboardId);
        const dashcards = dashboard.dashcards || [];
        // Find and update only the specific dashcard
        const updatedDashcards = dashcards.map((dc) => {
            if (dc.id === dashcardId) {
                // Merge updates into the existing dashcard
                return { ...dc, ...updates };
            }
            return dc;
        });
        // Verify the dashcard was found
        const dashcardExists = dashcards.some((dc) => dc.id === dashcardId);
        if (!dashcardExists) {
            throw new Error(`Dashcard with id ${dashcardId} not found in dashboard ${dashboardId}`);
        }
        // Update dashboard with modified dashcards
        const response = await this.axiosInstance.put(`/api/dashboard/${dashboardId}`, {
            ...dashboard,
            dashcards: updatedDashcards
        });
        return response.data;
    }
    async resizeDashboardCard(dashboardId, cardId, updates) {
        const dashboard = await this.getDashboard(dashboardId);
        const dashcards = dashboard.dashcards || [];
        const idx = dashcards.findIndex((dc) => dc.card_id === cardId || dc.id === cardId);
        if (idx === -1) {
            throw new Error(`Card ${cardId} not found on dashboard ${dashboardId}. Available card_ids: ${dashcards.map((dc) => dc.card_id).join(', ')}`);
        }
        if (updates.size_x !== undefined)
            dashcards[idx].size_x = updates.size_x;
        if (updates.size_y !== undefined)
            dashcards[idx].size_y = updates.size_y;
        if (updates.row !== undefined)
            dashcards[idx].row = updates.row;
        if (updates.col !== undefined)
            dashcards[idx].col = updates.col;
        const response = await this.axiosInstance.put(`/api/dashboard/${dashboardId}`, {
            ...dashboard,
            dashcards
        });
        return response.data;
    }
    async removeCardsFromDashboard(dashboardId, dashcardIds) {
        // Get current dashboard to preserve existing properties
        const dashboard = await this.getDashboard(dashboardId);
        const existingDashcards = dashboard.dashcards || [];
        // Filter out the dashcards to be removed by their dashcard id (not card_id)
        const filteredDashcards = existingDashcards.filter((dashcard) => !dashcardIds.includes(dashcard.id));
        // Update dashboard with filtered dashcards while preserving other properties
        const response = await this.axiosInstance.put(`/api/dashboard/${dashboardId}`, {
            ...dashboard,
            dashcards: filteredDashcards
        });
        return response.data;
    }
    async favoriteDashboard(id) {
        const response = await this.axiosInstance.post(`/api/dashboard/${id}/favorite`);
        return response.data;
    }
    async unfavoriteDashboard(id) {
        const response = await this.axiosInstance.delete(`/api/dashboard/${id}/favorite`);
        return response.data;
    }
    async revertDashboard(id, revisionId) {
        const response = await this.axiosInstance.post(`/api/dashboard/${id}/revert`, {
            revision_id: revisionId
        });
        return response.data;
    }
    async saveDashboard(dashboard) {
        const response = await this.axiosInstance.post('/api/dashboard/save', dashboard);
        return response.data;
    }
    async saveDashboardToCollection(parentCollectionId, dashboard) {
        const response = await this.axiosInstance.post(`/api/dashboard/save/collection/${parentCollectionId}`, dashboard);
        return response.data;
    }
    // Card operations
    async getCards(options = {}) {
        const params = new URLSearchParams();
        if (options.f !== undefined) {
            params.append('f', options.f);
        }
        if (options.model_id !== undefined) {
            params.append('model_id', options.model_id.toString());
        }
        const url = params.toString() ? `/api/card?${params.toString()}` : '/api/card';
        const response = await this.axiosInstance.get(url);
        return response.data;
    }
    async getCard(id) {
        const response = await this.axiosInstance.get(`/api/card/${id}`);
        return response.data;
    }
    async createCard(card) {
        const response = await this.axiosInstance.post("/api/card", card);
        return response.data;
    }
    async updateCard(id, updates, queryParams) {
        let url = `/api/card/${id}`;
        if (queryParams && Object.keys(queryParams).length > 0) {
            const searchParams = new URLSearchParams();
            Object.entries(queryParams).forEach(([key, value]) => {
                if (value !== undefined && value !== null) {
                    searchParams.append(key, value.toString());
                }
            });
            url += `?${searchParams.toString()}`;
        }
        const response = await this.axiosInstance.put(url, updates);
        return response.data;
    }
    async deleteCard(id, hardDelete = false) {
        if (hardDelete) {
            await this.axiosInstance.delete(`/api/card/${id}`);
        }
        else {
            await this.axiosInstance.put(`/api/card/${id}`, { archived: true });
        }
    }
    async executeCard(id, options = {}) {
        const requestBody = {
            ignore_cache: options.ignore_cache || false,
        };
        if (options.collection_preview !== undefined) {
            requestBody.collection_preview = options.collection_preview;
        }
        if (options.dashboard_id !== undefined) {
            requestBody.dashboard_id = options.dashboard_id;
        }
        const response = await this.axiosInstance.post(`/api/card/${id}/query`, requestBody);
        return response.data;
    }
    async moveCards(cardIds, collectionId, dashboardId) {
        const data = { card_ids: cardIds };
        if (collectionId) {
            data.collection_id = collectionId;
        }
        if (dashboardId) {
            data.dashboard_id = dashboardId;
        }
        const response = await this.axiosInstance.post("/api/cards/move", data);
        return response.data;
    }
    // Card collection operations
    async moveCardsToCollection(cardIds, collectionId) {
        const requestBody = { card_ids: cardIds };
        if (collectionId !== undefined) {
            requestBody.collection_id = collectionId;
        }
        const response = await this.axiosInstance.post("/api/card/collections", requestBody);
        return response.data;
    }
    // Card embeddable operations
    async getEmbeddableCards() {
        const response = await this.axiosInstance.get("/api/card/embeddable");
        return response.data;
    }
    // Card pivot query operations
    async executePivotCardQuery(cardId, parameters = {}) {
        const response = await this.axiosInstance.post(`/api/card/pivot/${cardId}/query`, parameters);
        return response.data;
    }
    // Card public operations
    async getPublicCards() {
        const response = await this.axiosInstance.get("/api/card/public");
        return response.data;
    }
    // Card parameter operations
    async getCardParamValues(cardId, paramKey) {
        const response = await this.axiosInstance.get(`/api/card/${cardId}/params/${paramKey}/values`);
        return response.data;
    }
    async searchCardParamValues(cardId, paramKey, query) {
        const response = await this.axiosInstance.get(`/api/card/${cardId}/params/${paramKey}/search/${query}`);
        return response.data;
    }
    async getCardParamRemapping(cardId, paramKey, value) {
        const response = await this.axiosInstance.get(`/api/card/${cardId}/params/${paramKey}/remapping?value=${encodeURIComponent(value)}`);
        return response.data;
    }
    // Card public link operations
    async createCardPublicLink(cardId) {
        const response = await this.axiosInstance.post(`/api/card/${cardId}/public_link`);
        return response.data;
    }
    async deleteCardPublicLink(cardId) {
        await this.axiosInstance.delete(`/api/card/${cardId}/public_link`);
        return { success: true };
    }
    // Card query operations
    async executeCardQueryWithFormat(cardId, exportFormat, parameters = {}) {
        const response = await this.axiosInstance.post(`/api/card/${cardId}/query/${exportFormat}`, parameters);
        return response.data;
    }
    // Card copy operations
    async copyCard(cardId) {
        const response = await this.axiosInstance.post(`/api/card/${cardId}/copy`);
        return response.data;
    }
    // Card dashboard operations
    async getCardDashboards(cardId) {
        const response = await this.axiosInstance.get(`/api/card/${cardId}/dashboards`);
        return response.data;
    }
    // Card metadata operations
    async getCardQueryMetadata(cardId) {
        const response = await this.axiosInstance.get(`/api/card/${cardId}/query_metadata`);
        return response.data;
    }
    // Card series operations
    async getCardSeries(cardId, options = {}) {
        const params = new URLSearchParams();
        if (options.last_cursor !== undefined) {
            params.append('last_cursor', options.last_cursor.toString());
        }
        if (options.query !== undefined && options.query !== '') {
            params.append('query', options.query);
        }
        if (options.exclude_ids !== undefined && Array.isArray(options.exclude_ids)) {
            options.exclude_ids.forEach((id) => {
                params.append('exclude_ids', id.toString());
            });
        }
        const url = params.toString() ? `/api/card/${cardId}/series?${params.toString()}` : `/api/card/${cardId}/series`;
        const response = await this.axiosInstance.get(url);
        return response.data;
    }
    // Database operations
    async getDatabases() {
        const response = await this.axiosInstance.get("/api/database");
        return response.data;
    }
    async getDatabase(id) {
        const response = await this.axiosInstance.get(`/api/database/${id}`);
        return response.data;
    }
    async createDatabase(payload) {
        const response = await this.axiosInstance.post("/api/database", payload);
        return response.data;
    }
    async updateDatabase(id, updates) {
        const response = await this.axiosInstance.put(`/api/database/${id}`, updates);
        return response.data;
    }
    async deleteDatabase(id) {
        await this.axiosInstance.delete(`/api/database/${id}`);
    }
    async validateDatabase(engine, details) {
        const response = await this.axiosInstance.post(`/api/database/validate`, { engine, details });
        return response.data;
    }
    async addSampleDatabase() {
        const response = await this.axiosInstance.post(`/api/database/sample_database`);
        return response.data;
    }
    async checkDatabaseHealth(id) {
        const response = await this.axiosInstance.get(`/api/database/${id}/healthcheck`);
        return response.data;
    }
    async getDatabaseMetadata(id) {
        const response = await this.axiosInstance.get(`/api/database/${id}/metadata`);
        return response.data;
    }
    async getDatabaseSchemas(id) {
        const response = await this.axiosInstance.get(`/api/database/${id}/schemas`);
        return response.data;
    }
    async getDatabaseSchema(id, schema) {
        const response = await this.axiosInstance.get(`/api/database/${id}/schema/${encodeURIComponent(schema)}`);
        return response.data;
    }
    async syncDatabaseSchema(id) {
        const response = await this.axiosInstance.post(`/api/database/${id}/sync_schema`);
        return response.data;
    }
    async executeQuery(databaseId, query, parameters = []) {
        const queryData = {
            type: "native",
            native: {
                query: query,
                template_tags: {},
            },
            parameters: parameters,
            database: databaseId,
        };
        const response = await this.axiosInstance.post("/api/dataset", queryData);
        return response.data;
    }
    // Collection operations
    async getCollections(archived = false) {
        const params = archived ? { archived: true } : {};
        const response = await this.axiosInstance.get("/api/collection", {
            params,
        });
        return response.data;
    }
    async getCollection(id) {
        const response = await this.axiosInstance.get(`/api/collection/${id}`);
        return response.data;
    }
    async createCollection(collection) {
        const response = await this.axiosInstance.post("/api/collection", collection);
        return response.data;
    }
    async updateCollection(id, updates) {
        const response = await this.axiosInstance.put(`/api/collection/${id}`, updates);
        return response.data;
    }
    async deleteCollection(id) {
        await this.axiosInstance.delete(`/api/collection/${id}`);
    }
    // User operations
    async getUsers(includeDeactivated = false) {
        const params = includeDeactivated ? { include_deactivated: true } : {};
        const response = await this.axiosInstance.get("/api/user", { params });
        return response.data;
    }
    async getUser(id) {
        const response = await this.axiosInstance.get(`/api/user/${id}`);
        return response.data;
    }
    async createUser(user) {
        const response = await this.axiosInstance.post("/api/user", user);
        return response.data;
    }
    async updateUser(id, updates) {
        const response = await this.axiosInstance.put(`/api/user/${id}`, updates);
        return response.data;
    }
    async deleteUser(id) {
        await this.axiosInstance.delete(`/api/user/${id}`);
    }
    // Permission operations
    async getPermissionGroups() {
        const response = await this.axiosInstance.get("/api/permissions/group");
        return response.data;
    }
    async createPermissionGroup(name) {
        const response = await this.axiosInstance.post("/api/permissions/group", {
            name,
        });
        return response.data;
    }
    async updatePermissionGroup(id, name) {
        const response = await this.axiosInstance.put(`/api/permissions/group/${id}`, { name });
        return response.data;
    }
    async deletePermissionGroup(id) {
        await this.axiosInstance.delete(`/api/permissions/group/${id}`);
    }
    // Activity operations
    async getMostRecentlyViewedDashboard() {
        const response = await this.axiosInstance.get("/api/activity/most_recently_viewed_dashboard");
        return response.data;
    }
    async getPopularItems() {
        const response = await this.axiosInstance.get("/api/activity/popular_items");
        return response.data;
    }
    async getRecentViews() {
        const response = await this.axiosInstance.get("/api/activity/recent_views");
        return response.data;
    }
    async getRecents(context, includeMetadata = false) {
        const params = new URLSearchParams();
        context.forEach(ctx => {
            params.append('context', ctx);
        });
        params.append('include_metadata', includeMetadata.toString());
        const response = await this.axiosInstance.get(`/api/activity/recents?${params.toString()}`);
        return response.data;
    }
    async postRecents(data) {
        const response = await this.axiosInstance.post("/api/activity/recents", data);
        return response.data;
    }
    async executeQueryExport(exportFormat, query, formatRows = false, pivotResults = false, visualizationSettings = {}) {
        const data = {
            format_rows: formatRows,
            pivot_results: pivotResults,
            query,
            visualization_settings: visualizationSettings
        };
        const response = await this.axiosInstance.post(`/api/dataset/${exportFormat}`, data);
        return response.data;
    }
    // Table operations
    async getTables(ids) {
        const params = ids ? { ids: ids.join(',') } : {};
        const response = await this.axiosInstance.get("/api/table", { params });
        return response.data;
    }
    async updateTables(ids, updates) {
        const data = { ids, ...updates };
        const response = await this.axiosInstance.put("/api/table", data);
        return response.data;
    }
    async getCardTableFks(cardId) {
        const response = await this.axiosInstance.get(`/api/table/card__${cardId}/fks`);
        return response.data;
    }
    async getCardTableQueryMetadata(cardId) {
        const response = await this.axiosInstance.get(`/api/table/card__${cardId}/query_metadata`);
        return response.data;
    }
    async getTable(id, options = {}) {
        const params = new URLSearchParams();
        if (options.include_sensitive_fields !== undefined) {
            params.append('include_sensitive_fields', options.include_sensitive_fields.toString());
        }
        if (options.include_hidden_fields !== undefined) {
            params.append('include_hidden_fields', options.include_hidden_fields.toString());
        }
        if (options.include_editable_data_model !== undefined) {
            params.append('include_editable_data_model', options.include_editable_data_model.toString());
        }
        const url = params.toString() ? `/api/table/${id}?${params.toString()}` : `/api/table/${id}`;
        const response = await this.axiosInstance.get(url);
        return response.data;
    }
    async updateTable(id, updateData) {
        const response = await this.axiosInstance.put(`/api/table/${id}`, updateData);
        return response.data;
    }
    async appendCsvToTable(id, filename, fileContent) {
        const formData = new FormData();
        const blob = new Blob([fileContent], { type: 'text/csv' });
        formData.append('file', blob, filename);
        const response = await this.axiosInstance.post(`/api/table/${id}/append-csv`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        return response.data;
    }
    async discardTableFieldValues(id) {
        const response = await this.axiosInstance.post(`/api/table/${id}/discard_values`);
        return response.data;
    }
    async reorderTableFields(id, fieldOrder) {
        const response = await this.axiosInstance.put(`/api/table/${id}/fields/order`, fieldOrder);
        return response.data;
    }
    async getTableFks(id) {
        const response = await this.axiosInstance.get(`/api/table/${id}/fks`);
        return response.data;
    }
    async getTableQueryMetadata(id, options = {}) {
        const params = new URLSearchParams();
        if (options.include_sensitive_fields !== undefined) {
            params.append('include_sensitive_fields', options.include_sensitive_fields.toString());
        }
        if (options.include_hidden_fields !== undefined) {
            params.append('include_hidden_fields', options.include_hidden_fields.toString());
        }
        if (options.include_editable_data_model !== undefined) {
            params.append('include_editable_data_model', options.include_editable_data_model.toString());
        }
        const url = params.toString() ? `/api/table/${id}/query_metadata?${params.toString()}` : `/api/table/${id}/query_metadata`;
        const response = await this.axiosInstance.get(url);
        return response.data;
    }
    async getFieldByName(tableId, columnName) {
        const metadata = await this.getTableQueryMetadata(tableId);
        const fields = metadata.fields || [];
        // Search by exact name match first, then display_name
        const lowerColumnName = columnName.toLowerCase();
        const field = fields.find((f) => f.name?.toLowerCase() === lowerColumnName ||
            f.display_name?.toLowerCase() === lowerColumnName);
        if (!field) {
            // Provide helpful error with available field names
            const availableFields = fields.map((f) => f.name).slice(0, 20);
            throw new Error(`Field '${columnName}' not found in table ${tableId}. ` +
                `Available fields: ${availableFields.join(', ')}${fields.length > 20 ? '...' : ''}`);
        }
        return {
            field_id: field.id,
            name: field.name,
            display_name: field.display_name,
            base_type: field.base_type,
            semantic_type: field.semantic_type,
            table_id: tableId,
        };
    }
    async getTableRelated(id) {
        const response = await this.axiosInstance.get(`/api/table/${id}/related`);
        return response.data;
    }
    async replaceTableCsv(id, csvFile) {
        const formData = new FormData();
        formData.append('csv_file', csvFile);
        const response = await this.axiosInstance.post(`/api/table/${id}/replace-csv`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        return response.data;
    }
    async rescanTableFieldValues(id) {
        const response = await this.axiosInstance.post(`/api/table/${id}/rescan_values`);
        return response.data;
    }
    async syncTableSchema(id) {
        const response = await this.axiosInstance.post(`/api/table/${id}/sync_schema`);
        return response.data;
    }
    async getTableData(tableId, limit) {
        const params = new URLSearchParams();
        if (limit !== undefined) {
            params.append('limit', limit.toString());
        }
        else {
            params.append('limit', '1000');
        }
        const url = `/api/table/${tableId}/data?${params.toString()}`;
        const response = await this.axiosInstance.get(url);
        return response.data;
    }
    // Generic API method for other operations
    async apiCall(method, endpoint, data) {
        const response = await this.axiosInstance.request({
            method,
            url: endpoint,
            data,
        });
        return response.data;
    }
}
