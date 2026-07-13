export class ApiError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
