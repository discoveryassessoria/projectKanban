const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { Server } = require("socket.io");

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = 3000;

// when using middleware `hostname` and `port` must be provided below
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer(handle);

  const io = new Server(httpServer, {
    path: "/api/socket_io",
    addTrailingSlash: false,
  });

  io.on("connection", (socket) => {
    console.log(`[Socket.IO] Novo cliente conectado: ${socket.id}`);

    socket.on("join-tree-room", (arvoreId) => {
      socket.join(`tree-${arvoreId}`);
      console.log(`[Socket.IO] Cliente ${socket.id} entrou na sala da árvore ${arvoreId}`);
    });

    socket.on("disconnect", () => {
      console.log(`[Socket.IO] Cliente desconectado: ${socket.id}`);
    });
  });

  httpServer
    .once("error", (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
});