const { Server } = require("socket.io");
const io = new Server();

io.on("connection", (socket) => {
    socket.on('message', (message) => {
        socket.emit('message', "hello");
    });
});

io.listen(8080);
