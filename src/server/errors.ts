/** A rule the user broke, with a message key the UI can translate. */
export class RuleError extends Error {
  readonly status = 422;
  constructor(readonly code: string, message?: string) {
    super(message ?? code);
  }
}
