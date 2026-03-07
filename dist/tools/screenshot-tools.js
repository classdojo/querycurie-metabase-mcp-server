import { z } from "zod";
import { takeScreenshot, closeBrowser } from "../services/browser.js";
export function addScreenshotTools(server, metabaseClient) {
    const metabaseUrl = process.env.METABASE_URL || "https://metabase.internal.classdojo.com";
    const username = process.env.METABASE_USERNAME;
    const password = process.env.METABASE_PASSWORD;
    if (!username || !password) {
        console.error("INFO: METABASE_USERNAME/METABASE_PASSWORD not set — screenshot tools will not be registered");
        return;
    }
    /**
     * Screenshot a Metabase card (saved question)
     *
     * Captures a PNG screenshot of a card's visualization by logging in
     * with session-cookie auth and navigating to the card URL.
     */
    server.addTool({
        name: "screenshot_card",
        description: "Take a PNG screenshot of a Metabase card's visualization (chart, table, etc.) — use this to visually inspect query results, verify chart rendering, or see what a saved question looks like",
        metadata: { isRead: true },
        parameters: z
            .object({
            card_id: z.number().describe("Card ID to screenshot"),
            width: z
                .number()
                .optional()
                .describe("Viewport width in pixels (default 1200)"),
            height: z
                .number()
                .optional()
                .describe("Viewport height in pixels (default 900)"),
        })
            .strict(),
        execute: async (args) => {
            try {
                const screenshot = await takeScreenshot({
                    metabaseUrl,
                    username: username,
                    password: password,
                    resourceType: "question",
                    resourceId: args.card_id,
                    width: args.width,
                    height: args.height,
                });
                return {
                    content: [
                        {
                            type: "image",
                            data: screenshot.toString("base64"),
                            mimeType: "image/png",
                        },
                    ],
                };
            }
            catch (error) {
                throw new Error(`Failed to screenshot card ${args.card_id}: ${error instanceof Error ? error.message : "Unknown error"}`);
            }
        },
    });
    /**
     * Screenshot a Metabase dashboard
     *
     * Captures a full-page PNG screenshot of a dashboard by logging in
     * with session-cookie auth and navigating to the dashboard URL.
     */
    server.addTool({
        name: "screenshot_dashboard",
        description: "Take a full-page PNG screenshot of a Metabase dashboard — use this to visually inspect dashboard layout, verify card arrangement, or see what a dashboard looks like",
        metadata: { isRead: true },
        parameters: z
            .object({
            dashboard_id: z.number().describe("Dashboard ID to screenshot"),
            width: z
                .number()
                .optional()
                .describe("Viewport width in pixels (default 1200)"),
            height: z
                .number()
                .optional()
                .describe("Viewport height in pixels (default 900)"),
        })
            .strict(),
        execute: async (args) => {
            try {
                const screenshot = await takeScreenshot({
                    metabaseUrl,
                    username: username,
                    password: password,
                    resourceType: "dashboard",
                    resourceId: args.dashboard_id,
                    width: args.width,
                    height: args.height,
                });
                return {
                    content: [
                        {
                            type: "image",
                            data: screenshot.toString("base64"),
                            mimeType: "image/png",
                        },
                    ],
                };
            }
            catch (error) {
                throw new Error(`Failed to screenshot dashboard ${args.dashboard_id}: ${error instanceof Error ? error.message : "Unknown error"}`);
            }
        },
    });
    // Cleanup browser on process exit
    process.on("beforeExit", () => {
        closeBrowser();
    });
}
