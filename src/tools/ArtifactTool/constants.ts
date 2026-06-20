export const ARTIFACT_TOOL_NAME = 'Artifact'

export const ARTIFACT_SERVER_PORT_RANGE = { min: 9000, max: 9999 }
export const ARTIFACT_SERVER_FALLBACK_PORT = 9090

export const MAX_ARTIFACTS_PER_SESSION = 50
export const MAX_ARTIFACT_CONTENT_CHARS = 500_000

export const CSP_HEADER = [
  "default-src 'self'",
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'none'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join('; ')
