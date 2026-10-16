import { Injectable, type PipeTransform } from "@nestjs/common";
import { fieldErrorsFromZod, ValidationError } from "@ua/error-handling";
import type { z } from "zod";

/**
 * Validates one argument against a `@ua/contracts` schema (docs/planning/07 §1).
 *
 * Applied per parameter (`@Body(new ZodValidationPipe(LoginRequest))`) so the
 * schema is visible at the route it guards; there is no global pipe that could
 * validate the wrong shape.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new ValidationError(fieldErrorsFromZod(parsed.error));
    }
    return parsed.data;
  }
}
