import SocketIO from "socket.io";
import Player from "./Player";
import Room from "./Room";

const players: { [index: string]: Player } = {};
const rooms: { [index: string]: Room } = {};

export default function(socket: SocketIO.Socket) {
  const player = new Player(socket);
  players[socket.id] = player;

  socket.on("disconnect", () => {
    if (player.inRoom) {
      rooms[player.roomId].removePlayer(player);
    }

    delete players[socket.id];
  });

  socket.on("join-room", (roomId) => {
    if (roomId.length !== 7) return;

    // get room
    const room = rooms[roomId];
    if (!room || room.players.length === 4 || room.started) return;

    const player = players[socket.id];
    if (player.inRoom) return;

    room.addPlayer(player);
  });

  socket.on("leave-room", () => {
    if (!player.inRoom) return;

    rooms[player.roomId].removePlayer(player);
  });

  socket.on("start-game", () => {
    if (!player.inRoom) return;

    const room = rooms[player.roomId];
    if (room.started || room.host.id !== player.id) return;

    room.startGame();
  });
}