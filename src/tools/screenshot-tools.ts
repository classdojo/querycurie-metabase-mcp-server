import { z } from "zod";
import { MetabaseClient } from "../client/metabase-client.js";
import { takeScreenshot, closeBrowser } from "../services/browser.js";

export function addScreenshotTools(
  server: any,
  metabaseClient: MetabaseClient
) {
  const metabaseUrl =
    process.env.METABASE_URL || "https://metabase.internal.classdojo.com";
  const username = process.env.METABASE_USERNAME;
  const password = process.env.METABASE_PASSWORD;

  if (!username || !password) {
    console.error(
      "INFO: METABASE_USERNAME/METABASE_PASSWORD not set — screenshot tools will not be registered"
    );
    return;
  }

  /**
   * Screenshot a Metabase card (saved question)
   */
  server.addTool({
    name: "screenshot_card",
    description:
      "Take a PNG screenshot of a Metabase card's visualization (chart, table, etc.) — use this to visually inspect query results, verify chart rendering, or see what a saved question looks like",
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
    execute: async (args: {
      card_id: number;
      width?: number;
      height?: number;
    }) => {
      try {
        const screenshots = await takeScreenshot({
          metabaseUrl,
          username: username!,
          password: password!,
          resourceType: "question",
          resourceId: args.card_id,
          width: args.width,
          height: args.height,
        });

        return {
          content: screenshots.map((buf) => ({
            type: "image" as const,
            data: buf.toString("base64"),
            mimeType: "image/png",
          })),
        };
      } catch (error) {
        throw new Error(
          `Failed to screenshot card ${args.card_id}: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    },
  });

  /**
   * Screenshot a Metabase dashboard
   *
   * For long dashboards, scrolls through the page and returns multiple
   * viewport-sized screenshots to capture all content.
   */
  server.addTool({
    name: "screenshot_dashboard",
    description:
      "Take PNG screenshot(s) of a Metabase dashboard — scrolls through long dashboards and returns multiple images. Use this to visually inspect dashboard layout, verify card arrangement, or see what a dashboard looks like",
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
    execute: async (args: {
      dashboard_id: number;
      width?: number;
      height?: number;
    }) => {
      try {
        const screenshots = await takeScreenshot({
          metabaseUrl,
          username: username!,
          password: password!,
          resourceType: "dashboard",
          resourceId: args.dashboard_id,
          width: args.width,
          height: args.height,
        });

        return {
          content: screenshots.map((buf) => ({
            type: "image" as const,
            data: buf.toString("base64"),
            mimeType: "image/png",
          })),
        };
      } catch (error) {
        throw new Error(
          `Failed to screenshot dashboard ${args.dashboard_id}: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    },
  });

  // Cleanup browser on process exit
  process.on("beforeExit", () => {
    closeBrowser();
  });
}
