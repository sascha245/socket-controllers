import { ClassTransformOptions } from "class-transformer";

export interface MessageBodyOptions {
    classTransformOptions?: ClassTransformOptions;
    validate?: boolean;
}
