import { NextResponse } from "next/server";
import { getAuditStats, queryAuditEntries } from "@omniroute/open-sse/mcp-server/audit";
import {
  isMcpHeartbeatOnline,
  isProcessAlive,
  readMcpHeartbeat,
  resolveMcpHeartbeatPath,
} from "@omniroute/open-sse/mcp-server/runtimeHeartbeat";

export async function GET() {
  try {
    const [heartbeat, stats, lastCallPage] = await Promise.all([
      readMcpHeartbeat(),
      getAuditStats(),
      queryAuditEntries({ limit: 1, offset: 0 }),
    ]);

    const online = isMcpHeartbeatOnline(heartbeat, { requireLivePid: true });
    const lastCall = lastCallPage.entries[0] || null;
    const now = Date.now();
    const lastHeartbeatAtMs = heartbeat ? new Date(heartbeat.lastHeartbeatAt).getTime() : null;
    const startedAtMs = heartbeat ? new Date(heartbeat.startedAt).getTime() : null;
    const heartbeatAgeMs =
      typeof lastHeartbeatAtMs === "number" && Number.isFinite(lastHeartbeatAtMs)
        ? Math.max(0, now - lastHeartbeatAtMs)
        : null;
    const uptimeMs =
      typeof startedAtMs === "number" && Number.isFinite(startedAtMs)
        ? Math.max(0, now - startedAtMs)
        : null;

    return NextResponse.json({
      status: online ? "online" : "offline",
      online,
      heartbeatPath: resolveMcpHeartbeatPath(),
      heartbeat: heartbeat
        ? {
            ...heartbeat,
            pidAlive: isProcessAlive(heartbeat.pid),
            heartbeatAgeMs,
            uptimeMs,
          }
        : null,
      activity: {
        totalCalls24h: stats.totalCalls,
        successRate: stats.successRate,
        avgDurationMs: stats.avgDurationMs,
        topTools: stats.topTools,
        lastCallAt: lastCall?.createdAt || null,
        lastCallTool: lastCall?.toolName || null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load MCP status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
