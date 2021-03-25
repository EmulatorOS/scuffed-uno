import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

import setupSocket from "./socket";

const app = express();
const http = createServer(app);
const io = new Server(http, {
  cors: {
    origin: process.env.NODE_ENV === "production" ? [/\.scuffeduno\.online$/, "https://uno-freddie.netlify.com"] : "http://localhost:8080",
    methods: ["GET", "POST"],
  },
});

io.on("connection", setupSocket);

const port = process.env.PORT || 3000;
http.listen(port, () => {
  console.log("Server listening on port " + port);
});
