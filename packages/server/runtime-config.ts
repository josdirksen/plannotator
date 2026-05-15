function getRuntimeRoomBaseUrl(): string | undefined {
  return process.env.PLANNOTATOR_ROOM_BASE_URL || process.env.VITE_ROOM_BASE_URL;
}

function scriptJson(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function injectRuntimeConfig(htmlContent: string): string {
  const roomBaseUrl = getRuntimeRoomBaseUrl();
  if (!roomBaseUrl) return htmlContent;

  const script = `<script>window.__ROOM_BASE_URL=${scriptJson(roomBaseUrl)};</script>`;
  const headMatch = /<head\b[^>]*>/i.exec(htmlContent);
  if (headMatch?.index !== undefined) {
    const insertAt = headMatch.index + headMatch[0].length;
    return `${htmlContent.slice(0, insertAt)}${script}${htmlContent.slice(insertAt)}`;
  }
  return `${script}${htmlContent}`;
}
