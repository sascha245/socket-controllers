import { plainToClass } from "class-transformer";

import {
    ConnectedSocket, EmitOnFail, EmitOnFailFor, EmitOnSuccess, MessageBody, OnConnect, OnDisconnect,
    OnMessage, SocketController, ValidationException
} from "../../src";
import { CreateMessageDto } from "./CreateMessage";
import { Message } from "./Message";

@SocketController()
export class MessageController {
    @OnConnect()
    connection(@ConnectedSocket() socket: any) {
        console.log("client connected");
    }

    @OnDisconnect()
    disconnect(@ConnectedSocket() socket: any) {
        console.log("client disconnected");
    }

    @OnMessage("authenticate")
    auth(@ConnectedSocket() socket: any, @MessageBody() message: any) {
        socket.isAuthorized = true;
        return true;
    }

    @OnMessage("save")
    @EmitOnFailFor("save/validation_error", () => ValidationException)
    @EmitOnFail("save/error")
    @EmitOnSuccess("save/success")
    save(@ConnectedSocket() socket: any, @MessageBody() message: CreateMessageDto) {
        console.log("setting id to the message and sending it back to the client");
        // do whatever you want
        const newMsg = plainToClass(Message, message);
        newMsg.id = 1;
        return newMsg;
    }
}
