const http = require("http");
const server = http.createServer((req, res) => {
	res.writeHead(200);
    res.end("<html>Hello world</html>");
});
server.listen(8080, "0.0.0.0", () => {
    console.log(`Server is running`);
});