import { classToPlain, ClassTransformOptions, plainToClass } from "class-transformer";
import { validate } from "class-validator";

import { ValidationException } from "./error";
import { ParameterParseJsonError } from "./error/ParameterParseJsonError";
import { MetadataBuilder } from "./metadata-builder/MetadataBuilder";
import { ActionMetadata } from "./metadata/ActionMetadata";
import { ControllerMetadata } from "./metadata/ControllerMetadata";
import { ParamMetadata } from "./metadata/ParamMetadata";
import { ActionTypes } from "./metadata/types/ActionTypes";
import { ParamTypes } from "./metadata/types/ParamTypes";
import { MessageBodyOptions } from "./options/MessageBodyOptions";

/**
 * Registers controllers and actions in the given server framework.
 */
export class SocketControllerExecutor {
    // -------------------------------------------------------------------------
    // Public properties
    // -------------------------------------------------------------------------

    /**
     * Indicates if class-transformer package should be used to perform message body serialization / deserialization.
     * By default its enabled.
     */
    useClassTransformer: boolean;

    /**
     * Global class transformer options passed to class-transformer during classToPlain operation.
     * This operation is being executed when server returns response to user.
     */
    classToPlainTransformOptions: ClassTransformOptions;

    /**
     * Global class transformer options passed to class-transformer during plainToClass operation.
     * This operation is being executed when parsing user parameters.
     */
    plainToClassTransformOptions: ClassTransformOptions;

    /**
     * Validate parameter
     */
    validate: boolean;

    // -------------------------------------------------------------------------
    // Private properties
    // -------------------------------------------------------------------------

    private metadataBuilder: MetadataBuilder;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(private io: any) {
        this.metadataBuilder = new MetadataBuilder();
    }

    // -------------------------------------------------------------------------
    // Public Methods
    // -------------------------------------------------------------------------

    execute() {
        this.registerControllers();
        this.registerMiddlewares();
    }

    // -------------------------------------------------------------------------
    // Private Methods
    // -------------------------------------------------------------------------

    /**
     * Registers middlewares.
     */
    private registerMiddlewares(classes?: Function[]): this {
        const middlewares = this.metadataBuilder.buildMiddlewareMetadata(classes);

        middlewares
            .sort((middleware1, middleware2) => middleware1.priority - middleware2.priority)
            .forEach(middleware => {
                this.io.use((socket: any, next: (err?: any) => any) => {
                    middleware.instance.use(socket, next);
                });
            });

        return this;
    }

    /**
     * Registers controllers.
     */
    private registerControllers(classes?: Function[]): this {
        const controllers = this.metadataBuilder.buildControllerMetadata(classes);
        const controllersWithoutNamespaces = controllers.filter(ctrl => !ctrl.namespace);
        const controllersWithNamespaces = controllers.filter(ctrl => !!ctrl.namespace);

        // register controllers without namespaces
        this.io.on("connection", (socket: any) => this.handleConnection(controllersWithoutNamespaces, socket));

        // register controllers with namespaces
        controllersWithNamespaces.forEach(controller => {
            this.io
                .of(controller.namespace)
                .on("connection", (socket: any) => this.handleConnection([controller], socket));
        });

        return this;
    }

    private handleConnection(controllers: ControllerMetadata[], socket: any) {
        controllers.forEach(controller => {
            controller.actions.forEach(action => {
                if (action.type === ActionTypes.CONNECT) {
                    this.handleAction(action, { socket: socket })
                        .then(result => this.handleSuccessResult(result, action, socket, null))
                        .catch(error => this.handleFailResult(error, action, socket));
                } else if (action.type === ActionTypes.DISCONNECT) {
                    socket.on("disconnect", () => {
                        this.handleAction(action, { socket: socket })
                            .then(result => this.handleSuccessResult(result, action, socket, null))
                            .catch(error => this.handleFailResult(error, action, socket));
                    });
                } else if (action.type === ActionTypes.MESSAGE) {
                    socket.on(action.name, (data: any, fn: Function) => {
                        this.handleAction(action, { socket: socket, data: data })
                            .then(result => this.handleSuccessResult(result, action, socket, fn))
                            .catch(error => this.handleFailResult(error, action, socket));
                    });
                }
            });
        });
    }

    private handleAction(action: ActionMetadata, options: { socket?: any; data?: any }): Promise<any> {
        // compute all parameters
        const paramsPromises = action.params.sort((param1, param2) => param1.index - param2.index).map(param => {
            if (param.type === ParamTypes.CONNECTED_SOCKET) {
                return options.socket;
            } else if (param.type === ParamTypes.SOCKET_IO) {
                return this.io;
            } else if (param.type === ParamTypes.SOCKET_QUERY_PARAM) {
                return options.socket.handshake.query[param.value];
            } else if (param.type === ParamTypes.SOCKET_ID) {
                return options.socket.id;
            } else if (param.type === ParamTypes.SOCKET_REQUEST) {
                return options.socket.request;
            } else if (param.type === ParamTypes.SOCKET_ROOMS) {
                return options.socket.rooms;
            } else {
                return this.handleParam(param, options);
            }
        });

        // after all parameters are computed
        const paramsPromise = Promise.all(paramsPromises).catch(error => {
            // console.log("Error during computation params of the socket controller: ", error);
            throw error;
        });
        return paramsPromise.then(params => {
            return action.executeAction(params);
        });
    }

    private async handleParam(param: ParamMetadata, options: { socket?: any; data?: any }): Promise<any> {
        let value = options.data;
        if (value !== null && value !== undefined && value !== "") value = await this.handleParamFormat(value, param);

        // if transform function is given for this param then apply it
        if (param.transform) value = param.transform(value, options.socket);

        return value;
    }

    private async handleParamFormat(value: any, param: ParamMetadata): Promise<any> {
        const format = param.reflectedType;
        const formatName =
            format instanceof Function && format.name ? format.name : format instanceof String ? format : "";
        switch (formatName.toLowerCase()) {
            case "number":
                return +value;

            case "string":
                return value;

            case "boolean":
                if (value === "true") {
                    return true;
                } else if (value === "false") {
                    return false;
                }
                return !!value;

            default:
                const isObjectFormat = format instanceof Function || formatName.toLowerCase() === "object";
                if (value && isObjectFormat) value = await this.parseParamValue(value, param);
        }
        return value;
    }

    private async parseParamValue(value: any, paramMetadata: ParamMetadata): Promise<any> {
        let parseValue;
        try {
            parseValue = typeof value === "string" ? JSON.parse(value) : value;
        } catch (er) {
            throw new ParameterParseJsonError(value);
        }

        if (paramMetadata.reflectedType !== Object && paramMetadata.reflectedType && this.useClassTransformer) {
            const classTransformOptions = paramMetadata.classTransformOptions || this.plainToClassTransformOptions;
            const instance = plainToClass(paramMetadata.reflectedType, parseValue, classTransformOptions);
            const options = paramMetadata.value as MessageBodyOptions | undefined;
            let validateInstance = this.validate;
            if (options && options.validate !== undefined) {
                validateInstance = options.validate;
            }
            if (validateInstance) {
                const errors = await validate(instance, {
                    validationError: { target: false }
                });
                if (errors && errors.length > 0) {
                    throw new ValidationException(errors);
                }
            }
            return instance;
        } else {
            return parseValue;
        }
    }

    private handleSuccessResult(result: any, action: ActionMetadata, socket: any, clientCallback: Function) {
        if (result !== null && result !== undefined && action.emitOnSuccess) {
            const transformOptions = action.emitOnSuccess.classTransformOptions || this.classToPlainTransformOptions;
            let transformedResult =
                this.useClassTransformer && result instanceof Object ? classToPlain(result, transformOptions) : result;
            socket.emit(action.emitOnSuccess.value, transformedResult);
        } else if ((result === null || result === undefined) && action.emitOnSuccess && !action.skipEmitOnEmptyResult) {
            socket.emit(action.emitOnSuccess.value);
        } else if (result !== null && result !== undefined && clientCallback) {
            clientCallback(result);
        } else if ((result === null || result === undefined) && clientCallback) {
            clientCallback("received");
        }
    }

    private handleFailResult(error: any, action: ActionMetadata, socket: any) {
        if (error !== null && error !== undefined && (action.emitOnFail || action.emitOnFailFor)) {
            const transformOptions = action.emitOnSuccess.classTransformOptions || this.classToPlainTransformOptions;
            let transformedResult =
                this.useClassTransformer && error instanceof Object ? classToPlain(error, transformOptions) : error;

            if (
                action.emitOnFailFor &&
                action.emitOnFailFor.errorType &&
                this.errorMatchesType(action.emitOnFailFor.errorType, error)
            ) {
                socket.emit(action.emitOnFailFor.value, transformedResult);
            } else if (action.emitOnFail) {
                if (error instanceof Error && !Object.keys(transformedResult).length) {
                    transformedResult = error.toString();
                }
                socket.emit(action.emitOnFail.value, transformedResult);
            }
        } else if ((error === null || error === undefined) && !action.skipEmitOnEmptyResult) {
            if (action.emitOnFail) {
                socket.emit(action.emitOnFail.value);
            } else if (action.emitOnFailFor) {
                socket.emit(action.emitOnFailFor.value);
            }
        }
    }

    private errorMatchesType(expectedType: Function | string, actualType: any): boolean {
        return actualType.constructor.name === (<any>expectedType).name;
    }
}
