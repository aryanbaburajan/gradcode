const messages = {
  "antigravity-native":
    "Antigravity CLI failed. Install agy, dbus-run-session, gnome-keyring-daemon, secret-tool and script on Linux, then retry login. Native CLI output is withheld to protect credentials.",
} as const

/** Safe authentication failure; raw provider payloads never become loggable causes. */
export class OAuthError extends Error {
  constructor(
    readonly terminal: boolean,
    readonly issue?: keyof typeof messages,
  ) {
    super(
      issue
        ? messages[issue]
        : terminal
          ? "Session revoked or expired; sign in again"
          : "Authentication temporarily unavailable; retry later",
    )
    this.name = "OAuthError"
  }
}
