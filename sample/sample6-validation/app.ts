import "reflect-metadata";
import "./MessageController";

// import { useContainer } from "class-validator";
// import { Container } from "typedi";
import { createSocketServer } from "../../src/index";

// useContainer(Container);

createSocketServer(3001); // creates socket.io server and registers all controllers there

console.log("Socket.io is up and running on port 3001. Send messages via socket-io client.");
