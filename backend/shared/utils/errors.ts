export class AppError extends Error {
  constructor(public message: string, public status = 500, public code?: string) {
    super(message);
  }
}
export class NotFound extends AppError { constructor(m = "Not found") { super(m, 404, "NOT_FOUND"); } }
export class Forbidden extends AppError { constructor(m = "Forbidden") { super(m, 403, "FORBIDDEN"); } }
export class Unauthorized extends AppError { constructor(m = "Unauthorized") { super(m, 401, "UNAUTHORIZED"); } }
export class BadRequest extends AppError { constructor(m = "Bad request") { super(m, 400, "BAD_REQUEST"); } }
export class Conflict extends AppError { constructor(m = "Conflict") { super(m, 409, "CONFLICT"); } }
