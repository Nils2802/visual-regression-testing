export class ApiError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409 | 422 | 500 | 502,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
