import { Exception } from "./Exception";

/**
 * Caused when user parameter is given, but is invalid and cannot be parsed.
 */
export class ParameterParseJsonError extends Exception {
    constructor(value: any) {
        super("Parameter is invalid. Value (" + JSON.stringify(value) + ") cannot be parsed to JSON");
    }
}
