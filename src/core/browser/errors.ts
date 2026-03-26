export class RuntimeBrowserNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeBrowserNotFoundError';
  }
}

export class RuntimeBrowserValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeBrowserValidationError';
  }
}
