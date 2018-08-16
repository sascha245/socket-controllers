import { ValidationError } from "class-validator";

import { Exception } from "./Exception";

export class ValidationException extends Exception {
    constructor(public readonly errors: ValidationError[]) {
        super("Validation failed");
    }
}
