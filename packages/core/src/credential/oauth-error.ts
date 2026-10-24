/** Safe authentication failure; raw provider payloads never become loggable causes. */
export class OAuthError extends Error {
  constructor(readonly terminal: boolean) {
    super(
      terminal ? "Session revoked or expired; sign in again" : "Authentication temporarily unavailable; retry later",
    )
    this.name = "OAuthError"
  }
}
